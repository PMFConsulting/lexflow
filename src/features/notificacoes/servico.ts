import { db } from "@/db";
import { notificacao, notificacoesPendentes } from "@/db/schema/notificacao";

/**
 * Escrita interna de notificações — chamada por outras Server Actions e por
 * `lib/emails/notificacoes-dono.ts`, nunca diretamente por um pedido de fora.
 *
 * Deliberadamente NÃO fica em `acoes.ts`: aquele ficheiro tem `"use server"` no
 * topo, e o Next regista automaticamente **todas** as funções exportadas de um
 * ficheiro assim como Server Actions públicas — com o próprio id da função a
 * servir de endpoint, sem guarda nenhuma a menos que o código a escreva. Estas
 * duas funções não têm sessão para verificar (são invocadas a meio de outra
 * ação, já autenticada, ou por um envio de email interno) e nunca precisaram de
 * ser alcançáveis por um `POST` anónimo — viverem num módulo sem essa
 * diretiva é o que impede o Next de as expor (R2-01, pentest ronda 2).
 */

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
