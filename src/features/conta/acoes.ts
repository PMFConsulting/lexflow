"use server";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { utilizador } from "@/db/schema/organizacao";
import { registarEvento } from "@/features/auditoria/registar";
import { exigirEquipaDaSociedade } from "@/lib/sessao";

/**
 * Liga uma conta acabada de criar ao utilizador de domínio.
 *
 * Só emails que já existam em `utilizador` podem entrar. É esta a lista de
 * convidados do back-office: sem ela, qualquer pessoa se registava e via
 * declarações de PPE de clientes.
 *
 * O `organizacaoId` é opcional porque quem chama nem sempre o sabe — esta
 * função corre a seguir a um registo e não há sessão nenhuma para o dizer. Mas
 * o email **não** é único na plataforma: o índice é `[organizacao_id, email]`,
 * e o mesmo endereço pode legitimamente estar convidado em duas sociedades. O
 * `limit(1)` que aqui estava escolhia uma delas pela ordem que o Postgres
 * quisesse devolver — e ligar a conta à sociedade errada dá acesso aos
 * processos de clientes de terceiros sem ninguém dar por nada. Quando a
 * sociedade é conhecida, filtra-se por ela; quando não é e o email existe em
 * mais do que uma, **recusa-se**, porque não há resposta certa a adivinhar.
 */
export async function ligarConta(email: string, authUserId: string, organizacaoId?: string) {
  const base = db();
  const limpo = email.trim().toLowerCase();

  const candidatos = await base
    .select()
    .from(utilizador)
    .where(
      and(
        eq(utilizador.email, limpo),
        isNull(utilizador.apagadoEm),
        organizacaoId ? eq(utilizador.organizacaoId, organizacaoId) : undefined,
      ),
    );

  if (candidatos.length > 1) {
    return {
      ok: false as const,
      erro: "Este email está registado em mais do que uma sociedade. Peça a um administrador para o resolver.",
    };
  }

  const [eu] = candidatos;

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

/**
 * Emails que ainda podem criar conta, **na sociedade de quem pergunta**.
 *
 * Isto é uma Server Action, ou seja, um endpoint público: qualquer pessoa a
 * podia invocar sem sessão nenhuma. E o que devolvia era a lista de endereços e
 * papéis de **todas** as sociedades da plataforma — quem trabalha em cada casa,
 * com que grau de acesso, e quais dessas contas ainda não têm palavra-passe, que
 * é exactamente a lista por onde se começa a atacar. Um `where` que só filtrava
 * `apagado_em` não é um filtro de acesso: descreve a linha, não descreve quem a
 * pode ler.
 *
 * Passa a exigir sessão e a devolver só a própria sociedade. O `super_admin`
 * fica de fora de propósito — as contas dele não pertencem a sociedade nenhuma
 * e o portal delas é outro.
 */
export async function emailsPorRegistar() {
  const { eu } = await exigirEquipaDaSociedade();

  const linhas = await db()
    .select({ email: utilizador.email, papel: utilizador.papel, ligado: utilizador.authUserId })
    .from(utilizador)
    .where(
      and(
        isNull(utilizador.apagadoEm),
        eq(utilizador.organizacaoId, eu.organizacaoId),
      ),
    );

  return linhas
    .filter((l) => !l.ligado)
    .map((l) => ({ email: l.email, papel: l.papel }));
}
