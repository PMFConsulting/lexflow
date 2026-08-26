"use server";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { utilizador } from "@/db/schema/organizacao";
import { registarEvento } from "@/features/auditoria/registar";

/**
 * Liga uma conta acabada de criar ao utilizador de domínio.
 *
 * Só emails que já existam em `utilizador` podem entrar. É esta a lista de
 * convidados do back-office: sem ela, qualquer pessoa se registava e via
 * declarações de PPE de clientes.
 */
export async function ligarConta(email: string, authUserId: string) {
  const base = db();
  const limpo = email.trim().toLowerCase();

  const [eu] = await base
    .select()
    .from(utilizador)
    .where(and(eq(utilizador.email, limpo), isNull(utilizador.apagadoEm)))
    .limit(1);

  if (!eu) {
    return {
      ok: false as const,
      erro: "Este email não está autorizado. Peça a um administrador para o adicionar.",
    };
  }

  if (eu.authUserId && eu.authUserId !== authUserId) {
    return { ok: false as const, erro: "Já existe uma conta para este email." };
  }

  await base
    .update(utilizador)
    .set({ authUserId })
    .where(eq(utilizador.id, eu.id));

  /**
   * A auditoria é encadeada **por organização** (D6), e desde a `0016` há uma
   * conta que não tem nenhuma: o `super_admin`. Pendurá-la numa sociedade
   * qualquer para o registo poder existir seria pior do que não o registar —
   * introduzia na cadeia dessa sociedade um evento que não é dela, e a cadeia é
   * exatamente aquilo cuja leitura tem de ser confiável.
   *
   * O que fica no lugar é uma linha no console. As operações de plataforma não
   * têm hoje um registo próprio; quando tiverem, é para lá que isto passa.
   */
  if (eu.organizacaoId) {
    await registarEvento({
      organizacaoId: eu.organizacaoId,
      atorId: eu.id,
      acao: "conta.ligada",
      entidade: "utilizador",
      entidadeId: eu.id,
      valorNovo: { email: limpo, papel: eu.papel },
    });
  } else {
    console.info(`[plataforma] conta de ${eu.papel} ligada: ${limpo}`);
  }

  return { ok: true as const, papel: eu.papel };
}

/** Emails que ainda podem criar conta — para o ecrã de registo ajudar. */
export async function emailsPorRegistar() {
  const linhas = await db()
    .select({ email: utilizador.email, papel: utilizador.papel, ligado: utilizador.authUserId })
    .from(utilizador)
    .where(isNull(utilizador.apagadoEm));

  return linhas
    .filter((l) => !l.ligado)
    .map((l) => ({ email: l.email, papel: l.papel }));
}
