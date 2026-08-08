"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contadorReferencia, organizacao } from "@/db/schema/organizacao";
import { processoOnboarding } from "@/db/schema/processo";
import { registarEvento } from "@/features/auditoria/registar";
import { enviarEmail } from "@/lib/email";
import { ASSUNTO_REGISTO, emailRegisto } from "@/lib/emails/jmassano";
import { origemPublica } from "@/lib/origem";
import { expiraDaquiA, gerarToken, hashToken } from "@/lib/token";

/**
 * Cria um processo e devolve o link mágico.
 *
 * O token em claro é devolvido uma única vez, aqui — depois disto só existe o
 * hash na base de dados. Quem perder o link pede outro; ninguém o recupera.
 *
 * Com `emailCliente`, o link segue também por email ("JMASSANO | Registro").
 * O envio nunca faz falhar a criação: o processo já existe e o link continua a
 * ser mostrado no ecrã, que é a forma de o recuperar quando o email não sai.
 */
export async function criarProcesso(
  tipoCliente: "particular" | "empresa" = "particular",
  emailCliente?: string,
  nomeCliente?: string,
) {
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

  const token = gerarToken();

  let processo: typeof processoOnboarding.$inferSelect | undefined;
  let referencia = "";

  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    const [contador] = await base
      .update(contadorReferencia)
      .set({ ultimo: sql`${contadorReferencia.ultimo} + 1` })
      .where(
        and(eq(contadorReferencia.organizacaoId, org.id), eq(contadorReferencia.ano, ano)),
      )
      .returning({ ultimo: contadorReferencia.ultimo });

    referencia = `${org.prefixoReferencia}-${ano}-${String(contador.ultimo).padStart(4, "0")}`;

    try {
      [processo] = await base
        .insert(processoOnboarding)
        .values({
          organizacaoId: org.id,
          referencia,
          tipoCliente,
          tokenAcessoHash: hashToken(token),
          expiraEm: expiraDaquiA(30),
        })
        .returning();
      break;
    } catch (erro) {
      if ((erro as { code?: string }).code === "23505" && tentativa < 5) {
        continue;
      }
      if ((erro as { code?: string }).code === "23505") {
        return {
          ok: false as const,
          erro: "Não foi possível criar o processo. Tente novamente.",
        };
      }
      throw erro;
    }
  }

  if (!processo) {
    return { ok: false as const, erro: "Não foi possível criar o processo. Tente novamente." };
  }

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

  const link = `${await origemPublica()}/onboarding/${token}`;
  let emailEnviado = false;

  if (emailCliente) {
    const r = await enviarEmail({
      para: emailCliente,
      assunto: ASSUNTO_REGISTO,
      html: emailRegisto({ nome: nomeCliente, link }),
      template: "registo",
      organizacaoId: org.id,
      processoId: processo.id,
      // O mesmo hash que ficou em `processo_onboarding.token_acesso_hash`: é o
      // que permite dizer "foi este link que saiu nesta mensagem" sem guardar
      // o token em claro em mais um sítio (D4).
      tokenHash: processo.tokenAcessoHash,
    });
    emailEnviado = r.ok;

    // O envio fica em auditoria mesmo quando falha: um link de acesso a um
    // processo que sai por email é um acontecimento, e saber que não saiu é
    // tão relevante como saber que saiu.
    await registarEvento({
      organizacaoId: org.id,
      processoId: processo.id,
      acao: r.ok ? "link.enviado" : "link.envio_falhou",
      entidade: "processo_onboarding",
      entidadeId: processo.id,
      valorNovo: { para: emailCliente, ...(r.ok ? {} : { erro: r.erro }) },
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: h.get("user-agent") ?? null,
    });
  }

  revalidatePath("/");
  return { ok: true as const, referencia, token, processoId: processo.id, emailEnviado };
}
