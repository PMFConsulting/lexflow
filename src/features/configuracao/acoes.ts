"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { armazenamentoSociedade } from "@/db/schema/armazenamento";
import { registarEvento } from "@/features/auditoria/registar";
import { destinoDaOrganizacao } from "@/lib/storage";
import { mensagemSegura } from "@/lib/storage/sanitizacao";
import { exigirSessao } from "@/lib/sessao";

export type ResultadoTeste = { ok: boolean; detalhe: string };

/**
 * Toca no destino sem escrever nada.
 *
 * Existe porque a alternativa é descobrir que o refresh token expirou quando o
 * primeiro cliente submeter — e aí a pasta já não se criou. Fica em auditoria:
 * uma ligação a um arquivo de clientes não se testa anonimamente.
 */
export async function testarLigacao(): Promise<ResultadoTeste> {
  const { eu } = await exigirSessao();

  const ligacao = await destinoDaOrganizacao(eu.organizacaoId);
  if (!ligacao) {
    return {
      ok: false,
      detalhe:
        "Não há ligação ativa. Configure as credenciais com `pnpm armazenamento configurar`.",
    };
  }

  const resultado = await ligacao.destino
    .verificar()
    .catch((e) => ({ ok: false, detalhe: mensagemSegura(e) }));

  await db()
    .update(armazenamentoSociedade)
    .set({ ultimoErro: resultado.ok ? null : resultado.detalhe.slice(0, 300) })
    .where(eq(armazenamentoSociedade.id, ligacao.config.id));

  const h = await headers();
  await registarEvento({
    organizacaoId: eu.organizacaoId,
    atorId: eu.id,
    acao: "armazenamento.testado",
    entidade: "armazenamento_sociedade",
    entidadeId: ligacao.config.id,
    valorNovo: { tipo: ligacao.config.tipo, ok: resultado.ok },
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
  });

  revalidatePath("/configuracao");
  return resultado;
}
