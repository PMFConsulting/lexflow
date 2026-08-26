"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizacao } from "@/db/schema/organizacao";
import { registarEvento } from "@/features/auditoria/registar";
import { exigirAdministracao } from "@/lib/sessao";
import {
  MAX_TAMANHO_LOGOTIPO,
  assinaturaLogotipoConfere,
  esquemaLogotipo,
  normalizarMimeLogotipo,
} from "./logotipo-validador";

/**
 * Gestão do logótipo próprio da sociedade (whitelabel).
 *
 * Permite que cada sociedade personalize a sua marca no portal em vez de usar
 * o logótipo genérico "LexFlow".
 *
 * Regras:
 * - Só o `society_admin` da sociedade (`exigirAdministracao()`).
 * - Formatos aceites: PNG, JPEG, WEBP, SVG (`image/png`, `image/jpeg`, `image/webp`, `image/svg+xml`).
 * - Tamanho máximo: 2 MB.
 * - Isolamento estrito: a atualização afeta unicamente a organização da sessão autenticada.
 * - Toda a alteração fica registada na auditoria com a ação `sociedade.logotipo_alterado`.
 */

async function obterContexto() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
  };
}

export type ResultadoGuardarLogotipo =
  | { ok: true; mensagem?: string }
  | { ok: false; erros?: Record<string, string[]>; mensagem: string };

export type ResultadoRemoverLogotipo =
  | { ok: true; mensagem?: string }
  | { ok: false; mensagem: string };

/**
 * Guarda o logótipo da sociedade a partir de um FormData.
 */
export async function guardarLogotipo(formData: FormData): Promise<ResultadoGuardarLogotipo> {
  const { eu } = await exigirAdministracao();
  const base = db();

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
    return {
      ok: false,
      erros,
      mensagem: "Dados do logótipo inválidos.",
    };
  }

  const arrayBuffer = await ficheiro.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  if (!assinaturaLogotipoConfere(mime, bytes)) {
    return {
      ok: false,
      erros: {
        logotipo: [
          `O conteúdo de «${ficheiro.name}» não corresponde ao formato de imagem anunciado.`,
        ],
      },
      mensagem: "O conteúdo do ficheiro não corresponde a uma imagem válida.",
    };
  }

  const base64 = Buffer.from(arrayBuffer).toString("base64");

  const [orgAtual] = await base
    .select({
      id: organizacao.id,
      logotipoNome: organizacao.logotipoNome,
      logotipoMime: organizacao.logotipoMime,
      logotipoAtualizadoEm: organizacao.logotipoAtualizadoEm,
    })
    .from(organizacao)
    .where(eq(organizacao.id, eu.organizacaoId))
    .limit(1);

  if (!orgAtual) {
    return { ok: false, mensagem: "Sociedade não encontrada." };
  }

  const agora = new Date();

  await base
    .update(organizacao)
    .set({
      logotipoDados: base64,
      logotipoMime: mime,
      logotipoNome: ficheiro.name,
      logotipoAtualizadoEm: agora,
    })
    .where(eq(organizacao.id, eu.organizacaoId));

  const { ip, userAgent } = await obterContexto();
  await registarEvento({
    organizacaoId: eu.organizacaoId,
    atorId: eu.id,
    acao: "sociedade.logotipo_alterado",
    entidade: "organizacao",
    entidadeId: eu.organizacaoId,
    valorAnterior: {
      nome: orgAtual.logotipoNome,
      mime: orgAtual.logotipoMime,
      atualizadoEm: orgAtual.logotipoAtualizadoEm,
    },
    valorNovo: {
      nome: ficheiro.name,
      mime,
      tamanhoBytes: ficheiro.size,
      atualizadoEm: agora,
    },
    ip,
    userAgent,
  }).catch((e) => console.error("[logotipo] audit write failed", { erro: String(e) }));

  revalidatePath("/gestao/sociedade");
  revalidatePath("/", "layout");

  return { ok: true, mensagem: "Logótipo atualizado com sucesso." };
}

/**
 * Remove o logótipo da sociedade, revertendo para o padrão "LexFlow".
 */
export async function removerLogotipo(): Promise<ResultadoRemoverLogotipo> {
  const { eu } = await exigirAdministracao();
  const base = db();

  const [orgAtual] = await base
    .select({
      id: organizacao.id,
      logotipoNome: organizacao.logotipoNome,
      logotipoMime: organizacao.logotipoMime,
      logotipoAtualizadoEm: organizacao.logotipoAtualizadoEm,
    })
    .from(organizacao)
    .where(eq(organizacao.id, eu.organizacaoId))
    .limit(1);

  if (!orgAtual) {
    return { ok: false, mensagem: "Sociedade não encontrada." };
  }

  /*
   * As quatro colunas ficam a `null`, a data incluída.
   *
   * É o que o esquema diz que `null` significa — «esta sociedade usa o logótipo
   * padrão». Uma data de atualização sozinha, sem imagem do outro lado, é um
   * estado que nenhuma leitura sabe interpretar: o `LogotipoSociedade` usa-a
   * para furar a cache de uma imagem que já não existe.
   */
  await base
    .update(organizacao)
    .set({
      logotipoDados: null,
      logotipoMime: null,
      logotipoNome: null,
      logotipoAtualizadoEm: null,
    })
    .where(eq(organizacao.id, eu.organizacaoId));

  const { ip, userAgent } = await obterContexto();
  await registarEvento({
    organizacaoId: eu.organizacaoId,
    atorId: eu.id,
    acao: "sociedade.logotipo_alterado",
    entidade: "organizacao",
    entidadeId: eu.organizacaoId,
    valorAnterior: {
      nome: orgAtual.logotipoNome,
      mime: orgAtual.logotipoMime,
      atualizadoEm: orgAtual.logotipoAtualizadoEm,
    },
    valorNovo: null,
    ip,
    userAgent,
  }).catch((e) => console.error("[logotipo] audit write failed", { erro: String(e) }));

  revalidatePath("/gestao/sociedade");
  revalidatePath("/", "layout");

  return { ok: true, mensagem: "Logótipo removido. O portal passa a usar o LexFlow." };
}
