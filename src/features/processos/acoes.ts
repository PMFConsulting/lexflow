"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contadorReferencia, organizacao } from "@/db/schema/organizacao";
import { processoOnboarding } from "@/db/schema/processo";
import { registarEvento } from "@/features/auditoria/registar";
import { expiraDaquiA, gerarToken, hashToken } from "@/lib/token";

/**
 * Cria um processo e devolve o link mágico.
 *
 * O token em claro é devolvido uma única vez, aqui — depois disto só existe o
 * hash na base de dados. Quem perder o link pede outro; ninguém o recupera.
 */
export async function criarProcesso(tipoCliente: "particular" | "empresa" = "particular") {
  const base = db();

  const [org] = await base.select().from(organizacao).limit(1);
  if (!org) {
    return { ok: false as const, erro: "Não há organização criada. Corra `pnpm db:seed`." };
  }

  const ano = new Date().getFullYear();

  // Sequencial atómico: um UPDATE ... RETURNING não deixa dois processos
  // apanharem o mesmo número, ao contrário de um SELECT max()+1.
  await base
    .insert(contadorReferencia)
    .values({ organizacaoId: org.id, ano, ultimo: 0 })
    .onConflictDoNothing({ target: [contadorReferencia.organizacaoId, contadorReferencia.ano] });

  const [contador] = await base
    .update(contadorReferencia)
    .set({ ultimo: sql`${contadorReferencia.ultimo} + 1` })
    .where(
      and(eq(contadorReferencia.organizacaoId, org.id), eq(contadorReferencia.ano, ano)),
    )
    .returning({ ultimo: contadorReferencia.ultimo });

  const referencia = `${org.prefixoReferencia}-${ano}-${String(contador.ultimo).padStart(4, "0")}`;
  const token = gerarToken();

  const [processo] = await base
    .insert(processoOnboarding)
    .values({
      organizacaoId: org.id,
      referencia,
      tipoCliente,
      tokenAcessoHash: hashToken(token),
      expiraEm: expiraDaquiA(30),
    })
    .returning();

  const h = await headers();
  await registarEvento({
    organizacaoId: org.id,
    processoId: processo.id,
    acao: "processo.criado",
    entidade: "processo_onboarding",
    entidadeId: processo.id,
    valorNovo: { referencia, tipoCliente },
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
  });

  revalidatePath("/");
  return { ok: true as const, referencia, token, processoId: processo.id };
}
