"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { aceitacaoTermos } from "@/db/schema/sociedade";
import { registarEvento } from "@/features/auditoria/registar";
import { exigirSessao } from "@/lib/sessao";
import { termosEmVigor } from "@/lib/termos-sociedade";

/**
 * Aceitar a versão em vigor do articulado, já com conta criada.
 *
 * Existe porque o articulado muda. Quem entrou na sociedade em 2026 aceitou a
 * versão de 2026; quando a sociedade publicar a de 2027, essa aceitação
 * continua válida **para o que ela aceitou** e deixa de valer para o texto novo
 * — que é exatamente o que a D3 protege. Sem esta ação, a única maneira de
 * pedir a aceitação nova a quem já tem conta era apagar-lhe a conta e voltar a
 * convidá-la.
 *
 * Uma linha por aceitação, nunca atualizada. A antiga continua a dizer o que
 * aquela pessoa aceitou naquele dia.
 */
export type ResultadoAceitacao =
  | { ok: true; versao: string }
  | { ok: false; mensagem: string };

export async function aceitarTermosEmVigor(): Promise<ResultadoAceitacao> {
  const { eu } = await exigirSessao();

  const termos = await termosEmVigor(eu.organizacaoId);
  const base = db();

  const [ja] = await base
    .select({ id: aceitacaoTermos.id })
    .from(aceitacaoTermos)
    .where(
      and(
        eq(aceitacaoTermos.utilizadorId, eu.id),
        eq(aceitacaoTermos.versao, termos.versao),
      ),
    )
    .limit(1);

  // Repetir a aceitação da mesma versão não é erro nem operação: é ruído no
  // registo de prova, e o registo de prova é a última coisa que se deve encher
  // de linhas iguais.
  if (ja) return { ok: true, versao: termos.versao };

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "desconhecido";
  const userAgent = h.get("user-agent") ?? "desconhecido";

  await base.insert(aceitacaoTermos).values({
    organizacaoId: eu.organizacaoId,
    utilizadorId: eu.id,
    versao: termos.versao,
    documentoRef: termos.forma === "documento" ? termos.documentoId : null,
    aceiteEm: new Date(),
    ip,
    userAgent,
  });

  await registarEvento({
    organizacaoId: eu.organizacaoId,
    atorId: eu.id,
    acao: "utilizador.termos_aceites",
    entidade: "aceitacao_termos",
    entidadeId: eu.id,
    valorNovo: { email: eu.email, versao: termos.versao, forma: termos.forma },
    ip,
    userAgent,
  }).catch((e) => console.error("[advogado] audit write failed", { erro: String(e) }));

  revalidatePath("/advogado");
  return { ok: true, versao: termos.versao };
}
