import { redirect } from "next/navigation";

/**
 * Fusão de "Configuração" em "Administração" (BUG3-011).
 *
 * Esta página não tinha nada que não estivesse já noutro sítio: o bloco
 * "Conta" duplicava `/advogado` (nome, email, papel, data de criação — os
 * mesmos quatro campos), o bloco "Sociedade" duplicava `/gestao/sociedade`
 * (que tem mais campos, não menos) e o link "Modelos de Email" passou a
 * viver como cartão em `/gestao`. Não havia um único dado ou ação aqui que
 * justificasse uma terceira entrada na barra lateral ao lado das duas que já
 * cobriam o mesmo território — pessoal («A minha conta») e de sociedade
 * («Administração»).
 *
 * O redirecionamento fica em vez de apagar a rota: é a única forma de um
 * marcador ou um link antigo (nos favoritos de alguém, ou no email de um
 * modelo já enviado) continuar a abrir nalgum lado em vez de dar 404.
 */
export default function Configuracao() {
  redirect("/gestao");
}
