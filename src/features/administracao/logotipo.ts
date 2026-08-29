"use server";

import { revalidatePath } from "next/cache";
import { exigirAdministracao } from "@/lib/sessao";
import {
  aplicarAlteracaoLogotipo,
  logotipoAtualDaOrganizacao,
  validarFicheiroLogotipo,
} from "@/lib/logotipo-organizacao";

/**
 * Gestão do logótipo da sociedade (whitelabel), restrito a `society_admin`.
 * PNG/JPEG/WEBP/SVG, máx. 2 MB, sempre com registo em auditoria
 * (`sociedade.logotipo_alterado`).
 *
 * Validação, escrita e auditoria partilhadas com o onboarding de sociedade
 * via `@/lib/logotipo-organizacao` — aqui muda só a origem da identidade
 * (sessão, não token) e os caminhos revalidados.
 */

export type ResultadoGuardarLogotipo =
  | { ok: true; mensagem?: string }
  | { ok: false; erros?: Record<string, string[]>; mensagem: string };

export type ResultadoRemoverLogotipo =
  | { ok: true; mensagem?: string }
  | { ok: false; mensagem: string };

function revalidarLogotipoAdministracao() {
  revalidatePath("/gestao/sociedade");
  revalidatePath("/", "layout");
}

/**
 * Guarda o logótipo da sociedade a partir de um FormData.
 */
export async function guardarLogotipo(formData: FormData): Promise<ResultadoGuardarLogotipo> {
  const { eu } = await exigirAdministracao();

  const validado = await validarFicheiroLogotipo(formData);
  if (!validado.ok) return validado;

  const anterior = await logotipoAtualDaOrganizacao(eu.organizacaoId);
  if (!anterior) {
    return { ok: false, mensagem: "Sociedade não encontrada." };
  }

  const agora = new Date();
  const { ficheiro } = validado;

  await aplicarAlteracaoLogotipo({
    organizacaoId: eu.organizacaoId,
    atorId: eu.id,
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
    revalidar: revalidarLogotipoAdministracao,
  });

  return { ok: true, mensagem: "Logótipo atualizado com sucesso." };
}

/**
 * Remove o logótipo da sociedade, revertendo para o padrão "LexFlow".
 */
export async function removerLogotipo(): Promise<ResultadoRemoverLogotipo> {
  const { eu } = await exigirAdministracao();

  const anterior = await logotipoAtualDaOrganizacao(eu.organizacaoId);
  if (!anterior) {
    return { ok: false, mensagem: "Sociedade não encontrada." };
  }

  await aplicarAlteracaoLogotipo({
    organizacaoId: eu.organizacaoId,
    atorId: eu.id,
    acao: "sociedade.logotipo_removido",
    anterior,
    campos: {
      logotipoDados: null,
      logotipoMime: null,
      logotipoNome: null,
      logotipoAtualizadoEm: null,
    },
    valorNovo: null,
    revalidar: revalidarLogotipoAdministracao,
  });

  return { ok: true, mensagem: "Logótipo removido. O portal passa a usar o LexFlow." };
}
