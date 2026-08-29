import "server-only";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizacao } from "@/db/schema/organizacao";
import { registarEvento } from "@/features/auditoria/registar";
import {
  MAX_TAMANHO_LOGOTIPO,
  assinaturaLogotipoConfere,
  esquemaLogotipo,
  normalizarMimeLogotipo,
} from "@/features/administracao/logotipo-validador";

/**
 * O que a gestão do logótipo (`administracao/logotipo.ts`) e o logótipo do
 * onboarding de sociedade (`sociedade/logotipo-onboarding.ts`) partilham:
 * validar o ficheiro, escrever as quatro colunas, registar a auditoria e
 * invalidar a cache. O que os distingue — de onde vem a identidade (sessão
 * versus token), que caminhos revalidar, a forma de erro que cada um devolve
 * — fica em cada chamador.
 */

async function obterContexto() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
  };
}

export type FicheiroLogotipoValido = {
  mime: string;
  nome: string;
  base64: string;
  tamanhoBytes: number;
};

export type ResultadoValidacaoLogotipo =
  | { ok: true; ficheiro: FicheiroLogotipoValido }
  | { ok: false; erros: Record<string, string[]>; mensagem: string };

/** As mesmas cinco verificações, na mesma ordem, para os dois fluxos que carregam um logótipo. */
export async function validarFicheiroLogotipo(
  formData: FormData,
): Promise<ResultadoValidacaoLogotipo> {
  const ficheiro = formData.get("logotipo") ?? formData.get("ficheiro");
  if (!(ficheiro instanceof File) || ficheiro.size === 0) {
    return {
      ok: false,
      erros: { logotipo: ["Escolha um ficheiro de imagem para o logótipo."] },
      mensagem: "Falta o ficheiro do logótipo.",
    };
  }

  if (ficheiro.size > MAX_TAMANHO_LOGOTIPO) {
    const mb = (ficheiro.size / 1024 / 1024).toFixed(1);
    return {
      ok: false,
      erros: { logotipo: [`O ficheiro tem ${mb} MB. O tamanho máximo permitido são 2 MB.`] },
      mensagem: "O ficheiro é demasiado grande.",
    };
  }

  const mime = normalizarMimeLogotipo(ficheiro.name, ficheiro.type);
  if (!mime) {
    return {
      ok: false,
      erros: {
        logotipo: [
          `«${ficheiro.name}» tem um formato não suportado. Aceitamos ficheiros PNG, JPEG, WEBP ou SVG.`,
        ],
      },
      mensagem: "Formato de imagem não suportado.",
    };
  }

  const parseResult = esquemaLogotipo.safeParse({
    nome: ficheiro.name,
    mime,
    tamanhoBytes: ficheiro.size,
  });

  if (!parseResult.success) {
    const erros: Record<string, string[]> = {};
    for (const problema of parseResult.error.issues) {
      const campo = problema.path.join(".") || "logotipo";
      (erros[campo] ??= []).push(problema.message);
    }
    return { ok: false, erros, mensagem: "Dados do logótipo inválidos." };
  }

  // O nome que se grava é o que o Zod devolve, e não o `ficheiro.name` em
  // bruto: é o mesmo valor com o `trim` aplicado.
  const nome = parseResult.data.nome;
  const arrayBuffer = await ficheiro.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  if (!assinaturaLogotipoConfere(mime, bytes)) {
    return {
      ok: false,
      erros: {
        logotipo: [
          `O conteúdo de «${nome}» não corresponde ao formato de imagem anunciado.`,
        ],
      },
      mensagem: "O conteúdo do ficheiro não corresponde a uma imagem válida.",
    };
  }

  const base64 = Buffer.from(arrayBuffer).toString("base64");
  return { ok: true, ficheiro: { mime, nome, base64, tamanhoBytes: ficheiro.size } };
}

export type LogotipoAtual = {
  nome: string | null;
  mime: string | null;
  atualizadoEm: Date | null;
};

export async function logotipoAtualDaOrganizacao(
  organizacaoId: string,
): Promise<LogotipoAtual | null> {
  const [org] = await db()
    .select({
      logotipoNome: organizacao.logotipoNome,
      logotipoMime: organizacao.logotipoMime,
      logotipoAtualizadoEm: organizacao.logotipoAtualizadoEm,
    })
    .from(organizacao)
    .where(eq(organizacao.id, organizacaoId))
    .limit(1);

  if (!org) return null;
  return { nome: org.logotipoNome, mime: org.logotipoMime, atualizadoEm: org.logotipoAtualizadoEm };
}

/**
 * Grava (ou remove, com `campos` a `null`) o logótipo e regista a auditoria.
 * `revalidar` corre dentro do seu próprio `try/catch` — falhar a invalidação
 * de cache não pode transformar uma escrita bem-sucedida numa mensagem de
 * erro (D46). Era isto que divergia entre os dois fluxos: o de administração
 * deixava o `revalidatePath` desprotegido.
 */
export async function aplicarAlteracaoLogotipo({
  organizacaoId,
  atorId,
  acao,
  anterior,
  campos,
  valorNovo,
  revalidar,
}: {
  organizacaoId: string;
  atorId?: string | null;
  acao: "sociedade.logotipo_alterado" | "sociedade.logotipo_removido";
  anterior: LogotipoAtual;
  campos: {
    logotipoDados: string | null;
    logotipoMime: string | null;
    logotipoNome: string | null;
    logotipoAtualizadoEm: Date | null;
  };
  valorNovo: Record<string, unknown> | null;
  revalidar: () => void;
}): Promise<void> {
  await db().update(organizacao).set(campos).where(eq(organizacao.id, organizacaoId));

  try {
    const { ip, userAgent } = await obterContexto();
    await registarEvento({
      organizacaoId,
      atorId,
      acao,
      entidade: "organizacao",
      entidadeId: organizacaoId,
      valorAnterior: { nome: anterior.nome, mime: anterior.mime, atualizadoEm: anterior.atualizadoEm },
      valorNovo,
      ip,
      userAgent,
    });
  } catch (e) {
    console.error("[logotipo] audit write failed", { erro: String(e) });
  }

  try {
    revalidar();
  } catch (e) {
    console.error("[logotipo] revalidate failed", { erro: String(e) });
  }
}
