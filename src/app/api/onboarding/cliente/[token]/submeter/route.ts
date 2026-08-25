import { NextResponse } from "next/server";
import { autorizar } from "@/lib/api";
import { submeter } from "@/features/onboarding/acoes";

/**
 * Submete o registo do cliente.
 *
 * A mesma `submeter` do botão do passo 7 — incluindo a verificação por código
 * de email (D57), que **não** é dispensada por o pedido vir de um bot. É a
 * pergunta que separa "o link chegou a alguém" de "a pessoa que assina continua
 * a ter acesso à caixa de correio", e um caminho programático que a saltasse
 * seria uma porta lateral em volta da única prova de identidade que o fecho
 * tem.
 */
export async function POST(
  pedido: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const auth = autorizar(pedido);
  if (!auth.ok) return auth.resposta;

  const r = await submeter((await params).token);

  if (!r.ok) {
    return NextResponse.json(
      { ok: false, erros: r.erros, mensagem: r.mensagem ?? null },
      { status: 422 },
    );
  }

  return NextResponse.json({ ok: true });
}
