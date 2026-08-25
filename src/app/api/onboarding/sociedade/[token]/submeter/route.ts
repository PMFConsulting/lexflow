import { NextResponse } from "next/server";
import { autorizar } from "@/lib/api";
import { submeterSociedade } from "@/features/sociedade/acoes";

/**
 * Submete o registo da sociedade.
 *
 * Devolve `emailEnviado` e o endereço do administrador, e não só `ok`: a
 * submissão cria um convite para essa pessoa, e o bot que a acompanha tem de
 * poder dizer «foi enviado para X» ou «o convite existe mas o email não saiu».
 * Um `ok: true` sozinho tornava esses dois casos indistinguíveis, que é
 * exatamente o defeito que a D44 fechou do lado do cliente.
 */
export async function POST(
  pedido: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const auth = autorizar(pedido);
  if (!auth.ok) return auth.resposta;

  const r = await submeterSociedade((await params).token);

  if (!r.ok) {
    return NextResponse.json({ ok: false, mensagem: r.mensagem }, { status: 422 });
  }

  return NextResponse.json({
    ok: true,
    adminEmail: r.adminEmail,
    emailEnviado: r.emailEnviado,
    erroEmail: r.erroEmail ?? null,
  });
}
