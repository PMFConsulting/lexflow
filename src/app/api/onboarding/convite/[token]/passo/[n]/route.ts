import { corpoJson, autorizar, respostaErro, respostaPasso } from "@/lib/api";
import { guardarPassoConvite } from "@/features/convites/acoes";
import { passoConvitePorNumero, TOTAL_PASSOS_CONVITE } from "@/features/convites/passos";

/**
 * Grava um passo do registo de uma pessoa da equipa.
 *
 * O passo 6 **não** passa por aqui: ele cria uma conta com palavra-passe, que é
 * uma transação e não uma gravação de campos, e vive em `POST /concluir`. Um
 * `POST /passo/6` responde 409 com essa indicação em vez de gravar nada — o
 * `guardarPassoConvite` devolveria `ok` sem ter criado conta nenhuma, e o bot
 * ficaria convencido de que tinha acabado.
 */
export async function POST(
  pedido: Request,
  { params }: { params: Promise<{ token: string; n: string }> },
) {
  const auth = autorizar(pedido);
  if (!auth.ok) return auth.resposta;

  const { token, n: bruto } = await params;
  const n = Number(bruto);
  if (!Number.isInteger(n) || !passoConvitePorNumero(n)) {
    return respostaErro("passo_invalido", "Esse passo não existe.", 404);
  }

  if (n === TOTAL_PASSOS_CONVITE) {
    return respostaErro(
      "usar_concluir",
      `O passo ${TOTAL_PASSOS_CONVITE} cria a conta. Use POST /api/onboarding/convite/{token}/concluir, com password e confirmacao.`,
      409,
    );
  }

  const corpo = await corpoJson(pedido);
  if (!corpo.ok) return corpo.resposta;

  return respostaPasso(await guardarPassoConvite(token, n, corpo.dados));
}
