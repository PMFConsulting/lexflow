"use server";

import { revalidatePath } from "next/cache";
import {
  aplicarAlteracaoLogotipo,
  logotipoAtualDaOrganizacao,
  validarFicheiroLogotipo,
} from "@/lib/logotipo-organizacao";
import { acessoSociedadePorToken } from "./dados";

/**
 * Logótipo da sociedade durante o onboarding.
 *
 * O fluxo da página de gestão (`administracao/logotipo.ts`) autentica pela
 * sessão (`exigirAdministracao`). Aqui não há conta ainda — quem preenche o
 * registo entra pelo link mágico. A identidade vem do token, por isso a
 * validação usa `acessoSociedadePorToken` e a escrita é feita na organização
 * do token. A validação do ficheiro, a escrita e a auditoria são as mesmas dos
 * dois fluxos, partilhadas em `@/lib/logotipo-organizacao`.
 *
 * Isolamento: o `org.id` vem do `innerJoin` que o próprio token resolve, e é o
 * único valor que entra no `where` do UPDATE. Não há nenhum identificador de
 * organização vindo do cliente — que é a diferença entre autenticar por token e
 * aceitar um `organizacaoId` no `FormData`.
 */

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

  const validado = await validarFicheiroLogotipo(formData);
  if (!validado.ok) return validado;

  const anterior = await logotipoAtualDaOrganizacao(org.id);
  if (!anterior) {
    return { ok: false, erros: {}, mensagem: "Sociedade não encontrada." };
  }

  const agora = new Date();
  const { ficheiro } = validado;

  await aplicarAlteracaoLogotipo({
    organizacaoId: org.id,
    acao: "sociedade.logotipo_alterado",
    anterior,
    campos: {
      logotipoDados: ficheiro.base64,
      logotipoMime: ficheiro.mime,
      logotipoNome: ficheiro.nome,
      logotipoAtualizadoEm: agora,
    },
    valorNovo: {
      nome: ficheiro.nome,
      mime: ficheiro.mime,
      tamanhoBytes: ficheiro.tamanhoBytes,
      atualizadoEm: agora,
    },
    // A mesma forma que `documentos.ts` usa, e pela mesma razão: o passo 1 é
    // quem mostra o logótipo, mas a lombada e o cabeçalho vivem no layout.
    revalidar: () => revalidatePath(`/sociedade/${tokenLimpo}`, "layout"),
  });

  return { ok: true, mensagem: "Logótipo guardado.", nome: ficheiro.nome };
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

  const anterior = await logotipoAtualDaOrganizacao(org.id);
  if (!anterior) {
    return { ok: false, erros: {}, mensagem: "Sociedade não encontrada." };
  }

  /*
   * Sem logótipo não há nada para remover — e dizer «Logótipo removido» sobre
   * uma sociedade que nunca teve nenhum é uma confirmação a mentir. Pior: o
   * evento de auditoria ficava com `valorAnterior` todo a `null`, e um registo
   * que a lei manda guardar sete anos não se enche de remoções que não
   * removeram nada.
   */
  if (!anterior.nome && !anterior.mime) {
    return { ok: true, mensagem: "Não havia logótipo para remover.", nome: null };
  }

  await aplicarAlteracaoLogotipo({
    organizacaoId: org.id,
    acao: "sociedade.logotipo_removido",
    anterior,
    campos: {
      logotipoDados: null,
      logotipoMime: null,
      logotipoNome: null,
      logotipoAtualizadoEm: null,
    },
    valorNovo: null,
    revalidar: () => revalidatePath(`/sociedade/${tokenLimpo}`, "layout"),
  });

  return { ok: true, mensagem: "Logótipo removido.", nome: null };
}
