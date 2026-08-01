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

/** Risco elevado só é aprovado por sócio ou admin. Não é configurável. */
export function podeAprovarRiscoElevado(papel: string) {
  return papel === "socio" || papel === "admin";
}
