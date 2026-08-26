import { redirect } from "next/navigation";
import { FormularioNovaPalavraPasse } from "@/features/conta/componentes/FormularioNovaPalavraPasse";
import { portalDoPapel, sessaoAtual } from "@/lib/sessao";

export const metadata = { title: "Definir palavra-passe" };

/**
 * O ecrã onde uma conta criada por um administrador começa.
 *
 * Vive no grupo `(auth)` e não no back-office, e isso é a decisão: o layout do
 * back-office traz barra lateral, navegação e dados da sociedade — ou seja, a
 * plataforma — e quem está aqui ainda não pode lá entrar. Com o layout de
 * autenticação, o ecrã tem o logótipo e mais nada, que é a leitura certa: isto
 * é a continuação do início de sessão.
 *
 * **`sessaoAtual()` e não `exigirSessao()`**, e é obrigatório que seja: o guard
 * manda para aqui quem tem `deve_redefinir_password`, e chamá-lo nesta página
 * era mandá-la para si própria em ciclo. As duas saídas ficam explícitas —
 * sem sessão, `/entrar`; sem marca, o portal do papel, porque quem já definiu
 * a palavra-passe não tem nada a fazer neste ecrã e escrever o endereço à mão
 * não deve dar uma segunda hipótese de a trocar sem passar pelo caminho normal.
 */
export default async function DefinirPalavraPasse() {
  const sessao = await sessaoAtual();
  if (!sessao) redirect("/entrar");
  if (!sessao.eu.deveRedefinirPassword) redirect(portalDoPapel(sessao.eu.papel));

  return <FormularioNovaPalavraPasse email={sessao.eu.email} />;
}
