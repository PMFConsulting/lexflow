"use server";

import { revalidatePath } from "next/cache";
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
import { acessoSociedadePorToken } from "./dados";

/**
 * Logótipo da sociedade durante o onboarding.
 *
 * O fluxo da página de gestão (`administracao/logotipo.ts`) autentica pela
 * sessão (`exigirAdministracao`). Aqui não há conta ainda — quem preenche o
 * registo entra pelo link mágico. A identidade vem do token, por isso a
 * validação usa `acessoSociedadePorToken` e a escrita é feita na organização
 * do token. A validação do ficheiro (mime, tamanho, assinatura binária) é a
 * mesma do módulo partilhado `logotipo-validador`, para não haver duas regras.
 *
 * Isolamento: o `org.id` vem do `innerJoin` que o próprio token resolve, e é o
 * único valor que entra no `where` do UPDATE. Não há nenhum identificador de
 * organização vindo do cliente — que é a diferença entre autenticar por token e
 * aceitar um `organizacaoId` no `FormData`.
 */

async function obterContexto() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
  };
}

export type ResultadoLogotipoOnboarding =
  | { ok: true; mensagem: string; nome: string | null }
  | { ok: false; erros: Record<string, string[]>; mensagem: string };

export async function guardarLogotipoOnboarding(
  token: string,
  formData: FormData,
): Promise<ResultadoLogotipoOnboarding> {
  const acesso = await acessoSociedadePorToken(token);
  if (acesso.estado !== "ok") {
    return {
      ok: false,
      erros: {},
      mensagem:
        acesso.estado === "concluido"
          ? "Este registo já foi submetido. Para trocar o logótipo, entre na área de Administração."
          : "Este link de registo já não é válido.",
    };
  }
  // O token normalizado, e não o que veio do cliente: é ele que forma o caminho
  // do `revalidatePath` lá em baixo, e um token com lixo colado nas pontas
  // (D47) revalidava um caminho que não existe.
  const { org, token: tokenLimpo } = acesso;
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
      erros: {
        logotipo: [`O ficheiro tem ${mb} MB. O tamanho máximo permitido são 2 MB.`],
      },
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

  // O nome que se grava é o que o Zod devolve, e não o `ficheiro.name` em bruto:
  // é o mesmo valor com o `trim` aplicado, e gravar o outro deitava fora a
  // única normalização que o esquema faz.
  const nome = parseResult.data.nome;

  const arrayBuffer = await ficheiro.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  // O nome e o MIME vêm os dois do browser. Os primeiros bytes vêm do ficheiro,
  // e são a única coisa aqui que quem carrega não escolheu.
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

  const [orgAtual] = await base
    .select({
      id: organizacao.id,
      logotipoNome: organizacao.logotipoNome,
      logotipoMime: organizacao.logotipoMime,
      logotipoAtualizadoEm: organizacao.logotipoAtualizadoEm,
    })
    .from(organizacao)
    .where(eq(organizacao.id, org.id))
    .limit(1);

  if (!orgAtual) {
    return { ok: false, erros: {}, mensagem: "Sociedade não encontrada." };
  }

  const agora = new Date();

  await base
    .update(organizacao)
    .set({
      logotipoDados: base64,
      logotipoMime: mime,
      logotipoNome: nome,
      logotipoAtualizadoEm: agora,
    })
    .where(eq(organizacao.id, org.id));

  /*
   * A partir daqui o logótipo já está gravado, e nada do que falta pode desfazer
   * isso (D46).
   *
   * `headers()`, o `registarEvento` e o `revalidatePath` não têm nada que ver
   * com guardar uma imagem, e qualquer um deles a lançar devolvia ao ecrã «o
   * servidor não respondeu» sobre uma escrita que correu bem — e a pessoa
   * carregava o ficheiro outra vez.
   */
  try {
    const { ip, userAgent } = await obterContexto();
    await registarEvento({
      organizacaoId: org.id,
      acao: "sociedade.logotipo_alterado",
      entidade: "organizacao",
      entidadeId: org.id,
      valorAnterior: {
        nome: orgAtual.logotipoNome,
        mime: orgAtual.logotipoMime,
        atualizadoEm: orgAtual.logotipoAtualizadoEm,
      },
      valorNovo: { nome, mime, tamanhoBytes: ficheiro.size, atualizadoEm: agora },
      ip,
      userAgent,
    });
  } catch (e) {
    console.error("[logotipo-onboarding] audit write failed", { erro: String(e) });
  }

  try {
    // A mesma forma que `documentos.ts` usa, e pela mesma razão: o passo 1 é
    // quem mostra o logótipo, mas a lombada e o cabeçalho vivem no layout.
    revalidatePath(`/sociedade/${tokenLimpo}`, "layout");
  } catch (e) {
    console.error("[logotipo-onboarding] revalidate failed", { erro: String(e) });
  }

  return { ok: true, mensagem: "Logótipo guardado.", nome };
}

export async function removerLogotipoOnboarding(
  token: string,
): Promise<ResultadoLogotipoOnboarding> {
  const acesso = await acessoSociedadePorToken(token);
  if (acesso.estado !== "ok") {
    return {
      ok: false,
      erros: {},
      mensagem:
        acesso.estado === "concluido"
          ? "Este registo já foi submetido. Para remover o logótipo, entre na área de Administração."
          : "Este link de registo já não é válido.",
    };
  }
  const { org, token: tokenLimpo } = acesso;
  const base = db();

  const [orgAtual] = await base
    .select({
      id: organizacao.id,
      logotipoNome: organizacao.logotipoNome,
      logotipoMime: organizacao.logotipoMime,
      logotipoAtualizadoEm: organizacao.logotipoAtualizadoEm,
    })
    .from(organizacao)
    .where(eq(organizacao.id, org.id))
    .limit(1);

  if (!orgAtual) {
    return { ok: false, erros: {}, mensagem: "Sociedade não encontrada." };
  }

  /*
   * Sem logótipo não há nada para remover — e dizer «Logótipo removido» sobre
   * uma sociedade que nunca teve nenhum é uma confirmação a mentir. Pior: o
   * evento de auditoria ficava com `valorAnterior` todo a `null`, e um registo
   * que a lei manda guardar sete anos não se enche de remoções que não
   * removeram nada.
   */
  if (!orgAtual.logotipoNome && !orgAtual.logotipoMime) {
    return { ok: true, mensagem: "Não havia logótipo para remover.", nome: null };
  }

  /*
   * As quatro colunas ficam a `null`, incluindo a data.
   *
   * É o que o esquema diz que `null` significa — «esta sociedade usa o logótipo
   * padrão» —, e uma data de atualização sozinha, sem imagem nenhuma do outro
   * lado, é um estado que nenhuma leitura sabe interpretar.
   */
  await base
    .update(organizacao)
    .set({
      logotipoDados: null,
      logotipoMime: null,
      logotipoNome: null,
      logotipoAtualizadoEm: null,
    })
    .where(eq(organizacao.id, org.id));

  try {
    const { ip, userAgent } = await obterContexto();
    await registarEvento({
      organizacaoId: org.id,
      acao: "sociedade.logotipo_removido",
      entidade: "organizacao",
      entidadeId: org.id,
      valorAnterior: {
        nome: orgAtual.logotipoNome,
        mime: orgAtual.logotipoMime,
        atualizadoEm: orgAtual.logotipoAtualizadoEm,
      },
      valorNovo: null,
      ip,
      userAgent,
    });
  } catch (e) {
    console.error("[logotipo-onboarding] audit write failed", { erro: String(e) });
  }

  try {
    revalidatePath(`/sociedade/${tokenLimpo}`, "layout");
  } catch (e) {
    console.error("[logotipo-onboarding] revalidate failed", { erro: String(e) });
  }

  return { ok: true, mensagem: "Logótipo removido.", nome: null };
}
