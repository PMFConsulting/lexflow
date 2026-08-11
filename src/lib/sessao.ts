import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { utilizador } from "@/db/schema/organizacao";
import { auth } from "./auth";

/**
 * Sessão do back-office.
 *
 * Devolve o utilizador de domínio — o que tem papel e organização — e não o
 * registo do Better Auth. É esse que interessa para decidir o que se pode ver.
 */
export async function sessaoAtual() {
  const sessao = await auth().api.getSession({ headers: await headers() });
  if (!sessao?.user) return null;

  const [eu] = await db()
    .select()
    .from(utilizador)
    .where(eq(utilizador.authUserId, sessao.user.id))
    .limit(1);

  if (!eu || !eu.ativo || eu.apagadoEm) return null;
  return { conta: sessao.user, eu };
}

/**
 * Exige sessão. Sem ela, vai para o ecrã de entrada.
 *
 * Chamada em todas as páginas do back-office: um sistema que guarda declarações
 * de PPE e documentos de identificação não pode ter uma única página aberta por
 * esquecimento.
 */
export async function exigirSessao() {
  const s = await sessaoAtual();
  if (!s) redirect("/entrar");
  return s;
}

/** O papel `assistente` não vê PPE nem origem de fundos — §6 do brief. */
export function podeVerPpe(papel: string) {
  return papel !== "assistente";
}

/**
 * Quem pode aprovar ou rejeitar um processo.
 *
 * Mesma fronteira do PPE: um `assistente` recolhe e organiza, mas a decisão
 * sobre um cliente — que dispara o email de boas-vindas ou uma rejeição — é de
 * quem tem responsabilidade sobre o processo (`admin`, `socio`, `advogado`).
 */
export function podeAprovarProcesso(papel: string) {
  return papel !== "assistente";
}

/**
 * O diário de emails é de administração.
 *
 * A lista mostra para quem é que a sociedade escreveu e quando — endereços de
 * clientes, lado a lado, numa página só. É de diagnóstico, não de trabalho
 * diário, e não há razão para estar ao alcance de quem preenche processos.
 */
export function podeVerEmails(papel: string) {
  return papel === "admin";
}

/**
 * Exige sessão *e* o papel de administrador.
 *
 * Um não-administrador vai para o painel, e não para o ecrã de entrada: já tem
 * sessão válida, e mandá-lo autenticar-se outra vez sugeria que o problema era
 * a sessão. O guard tem de ficar na página e não só na navegação — esconder a
 * entrada da barra lateral não fecha o endereço a quem o escreva à mão.
 */
export async function exigirAdmin() {
  const s = await exigirSessao();
  if (!podeVerEmails(s.eu.papel)) redirect("/");
  return s;
}
