import { NextResponse } from "next/server";
import { autorizar, corpoJson } from "@/lib/api";
import { concluirConvite } from "@/features/convites/acoes";

/**
 * Cria a conta — o último passo do registo de uma pessoa da equipa.
 *
 * Chama a mesma `concluirConvite` do botão, com as mesmas verificações dos
 * cinco passos anteriores: documentos anexados, sigilo declarado, articulado
 * aceite. Nenhuma delas é dispensada por o pedido vir de um bot, e é para isso
 * que elas estão na Server Action e não no ecrã — um caminho programático que
 * as saltasse era uma conta criada sem nada do que a antecede.
 *
 * A palavra-passe atravessa este endpoint em claro dentro do corpo, como
 * atravessa qualquer formulário de registo: é HTTPS que a protege em trânsito,
 * e do lado de cá ela é convertida em hash (scrypt, `better-auth/crypto`) antes
 * de qualquer escrita. **Não é registada em lado nenhum** — nem em `email_log`,
 * nem em `evento_auditoria`, nem nas linhas de consola.
 */
export async function POST(
  pedido: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const auth = autorizar(pedido);
  if (!auth.ok) return auth.resposta;

  const corpo = await corpoJson(pedido);
  if (!corpo.ok) return corpo.resposta;

  const r = await concluirConvite((await params).token, corpo.dados);

  if (!r.ok) {
    return NextResponse.json(
      { ok: false, erros: r.erros ?? {}, mensagem: r.mensagem },
      { status: 422 },
    );
  }

  return NextResponse.json({ ok: true, email: r.email });
}
