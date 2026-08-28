"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { notificacao, notificacoesPendentes } from "@/db/schema/notificacao";
import { organizacao } from "@/db/schema/organizacao";
import {
  eSuperAdmin,
  exigirSessao,
  exigirSocietyAdmin,
} from "@/lib/sessao";
import { registarEvento } from "@/features/auditoria/registar";

async function contexto() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
  };
}

/**
 * Cria uma notificação in-app (visível no badge/sino e na página /notificacoes).
 *
 * Nunca propaga exceção para não interromper a operação principal caso a escrita falhe.
 */
export async function registarNotificacao({
  organizacaoId,
  paraPapel,
  titulo,
  corpo,
  link,
}: {
  organizacaoId?: string | null;
  paraPapel?: string | null;
  titulo: string;
  corpo: string;
  link?: string | null;
}): Promise<void> {
  try {
    await db().insert(notificacao).values({
      organizacaoId: organizacaoId ?? null,
      paraPapel: paraPapel ?? null,
      titulo,
      corpo,
      link: link ?? null,
    });
  } catch (e) {
    console.error("[notificacoes] falha ao registar notificação in-app:", e);
  }
}

/**
 * Enfileira uma notificação pendente para o Resumo Diário do Dono da plataforma.
 *
 * Nunca propaga exceção para não interromper a operação principal.
 */
export async function enfileirarNotificacaoPendente({
  tipo,
  organizacaoId,
  dados,
}: {
  tipo: string;
  organizacaoId?: string | null;
  dados: Record<string, unknown>;
}): Promise<void> {
  try {
    await db().insert(notificacoesPendentes).values({
      tipo,
      organizacaoId: organizacaoId ?? null,
      dados,
    });
  } catch (e) {
    console.error("[notificacoes] falha ao enfileirar notificação pendente:", e);
  }
}

/**
 * Marca uma notificação individual como lida.
 */
export async function marcarNotificacaoComoLida(id: string): Promise<{ ok: boolean }> {
  const { eu } = await exigirSessao();
  const superAdmin = eSuperAdmin(eu.papel);

  try {
    if (superAdmin) {
      await db()
        .update(notificacao)
        .set({ lidaEm: new Date() })
        .where(and(eq(notificacao.id, id), isNull(notificacao.lidaEm)));
    } else if (eu.organizacaoId) {
      await db()
        .update(notificacao)
        .set({ lidaEm: new Date() })
        .where(
          and(
            eq(notificacao.id, id),
            isNull(notificacao.lidaEm),
            or(
              eq(notificacao.organizacaoId, eu.organizacaoId),
              isNull(notificacao.organizacaoId),
            ),
          ),
        );
    }

    revalidatePath("/notificacoes");
    revalidatePath("/admin/notificacoes");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    console.error("[notificacoes] erro ao marcar notificação como lida:", e);
    return { ok: false };
  }
}

/**
 * Marca todas as notificações do utilizador como lidas.
 */
export async function marcarTodasComoLidas(): Promise<{ ok: boolean }> {
  const { eu } = await exigirSessao();
  const superAdmin = eSuperAdmin(eu.papel);

  try {
    if (superAdmin) {
      await db()
        .update(notificacao)
        .set({ lidaEm: new Date() })
        .where(isNull(notificacao.lidaEm));
    } else if (eu.organizacaoId) {
      await db()
        .update(notificacao)
        .set({ lidaEm: new Date() })
        .where(
          and(
            isNull(notificacao.lidaEm),
            or(
              eq(notificacao.organizacaoId, eu.organizacaoId),
              isNull(notificacao.organizacaoId),
            ),
          ),
        );
    }

    revalidatePath("/notificacoes");
    revalidatePath("/admin/notificacoes");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    console.error("[notificacoes] erro ao marcar todas as notificações como lidas:", e);
    return { ok: false };
  }
}

/**
 * Altera a preferência da sociedade sobre receber email por cada processo submetido.
 * Só pode ser chamado pelo society_admin.
 */
export async function alterarPreferenciaNotificacaoSubmissoes(
  ativar: boolean,
): Promise<{ ok: boolean; valor: boolean }> {
  const { eu } = await exigirSocietyAdmin();
  const { ip, userAgent } = await contexto();

  const [orgAnterior] = await db()
    .select({ notificarSubmissoesEmail: organizacao.notificarSubmissoesEmail })
    .from(organizacao)
    .where(eq(organizacao.id, eu.organizacaoId))
    .limit(1);

  await db()
    .update(organizacao)
    .set({ notificarSubmissoesEmail: ativar })
    .where(eq(organizacao.id, eu.organizacaoId));

  await registarEvento({
    organizacaoId: eu.organizacaoId,
    atorId: eu.id,
    acao: "sociedade.notificacoes_email_alteradas",
    entidade: "organizacao",
    entidadeId: eu.organizacaoId,
    valorAnterior: { notificarSubmissoesEmail: orgAnterior?.notificarSubmissoesEmail ?? false },
    valorNovo: { notificarSubmissoesEmail: ativar },
    ip,
    userAgent,
  });

  revalidatePath("/configuracao");
  revalidatePath("/configuracao/emails");
  revalidatePath("/gestao/sociedade");

  return { ok: true, valor: ativar };
}
