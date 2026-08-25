import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { utilizador } from "@/db/schema/organizacao";
import { auth } from "./auth";

/**
 * Back-office session.
 *
 * Returns the domain user — the one with a role and an organisation — and not
 * the Better Auth record. That is the one that matters for deciding what can be
 * seen.
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
 * Requires a session. Without one, it goes to the login screen.
 *
 * Called on every back-office page: a system holding PEP declarations and
 * identification documents cannot have a single page left open by oversight.
 */
export async function exigirSessao() {
  const s = await sessaoAtual();
  if (!s) redirect("/entrar");
  return s;
}

/** The `assistente` role sees neither PEP nor source of funds — §6 of the brief. */
export function podeVerPpe(papel: string) {
  return papel !== "assistente";
}

/**
 * Who can approve or reject a matter.
 *
 * Same boundary as the PEP one: an `assistente` collects and organises, but the
 * decision about a client — which fires the welcome email or a rejection —
 * belongs to whoever has responsibility for the matter (`admin`, `socio`,
 * `advogado`).
 */
export function podeAprovarProcesso(papel: string) {
  return papel !== "assistente";
}

/**
 * The email log is for administration.
 *
 * The list shows who the firm wrote to and when — client addresses, side by
 * side, on a single page. It is for diagnosis, not for daily work, and there is
 * no reason for it to be within reach of whoever fills in matters.
 */
export function podeVerEmails(papel: string) {
  return papel === "admin";
}

/**
 * Requires a session *and* the administrator role.
 *
 * A non-administrator goes to the dashboard, and not to the login screen: they
 * already have a valid session, and sending them to authenticate again would
 * suggest the problem was the session. The guard has to sit on the page and not
 * only in the navigation — hiding the sidebar entry does not close the address
 * to anyone typing it by hand.
 */
export async function exigirAdmin() {
  const s = await exigirSessao();
  if (!podeVerEmails(s.eu.papel)) redirect("/");
  return s;
}

/**
 * Quem administra a sociedade.
 *
 * Não é o mesmo que `podeVerEmails`, apesar de hoje darem a mesma resposta, e a
 * diferença não é de gosto: `/emails` é restrito por ser um ecrã de diagnóstico
 * com endereços de clientes lado a lado; a administração é restrita por decidir
 * quem entra na plataforma, com que perfil, e qual é o articulado que vincula os
 * clientes da sociedade. São duas razões diferentes para a mesma resposta, e
 * escrevê-las como uma só significa que o dia em que uma mudar leva a outra
 * atrás sem ninguém reparar.
 */
export function podeAdministrar(papel: string) {
  return papel === "admin";
}

/**
 * Requer sessão **e** o papel de administrador.
 *
 * Chamada no início de cada página e de cada Server Action da administração, e
 * não só na navegação: esconder a entrada da barra lateral é cortesia, não
 * segurança — o endereço continua a responder a quem o escreva à mão, e uma
 * Server Action é um endpoint público como qualquer outro (D35).
 *
 * Um não-administrador vai para o painel e não para a entrada: já tem sessão
 * válida, e mandá-lo autenticar-se outra vez sugeria que o problema era a
 * sessão.
 */
export async function exigirAdministracao() {
  const s = await exigirSessao();
  if (!podeAdministrar(s.eu.papel)) redirect("/");
  return s;
}
