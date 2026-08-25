import { corpoJson, autorizar, respostaErro, respostaPasso } from "@/lib/api";
import { guardarPasso } from "@/features/onboarding/acoes";
import { passoPorNumero } from "@/features/onboarding/passos";

/**
 * Grava um passo do registo do cliente.
 *
 * Chama `guardarPasso` — **a mesma função que o formulário chama**, com a mesma
 * revalidação do token e o mesmo Zod do lado do servidor. Não há aqui uma
 * segunda validação nem uma segunda regra: se houvesse, seria essa a divergir.
 *
 * O corpo é o mesmo objeto que o formulário monta em `carga(n, fd)`. Os campos
 * e as regras de cada passo estão em `features/onboarding/schemas.ts`, e um
 * campo em falta volta em `erros`, por nome, com a mensagem que a pessoa veria
 * no ecrã.
 */
export async function POST(
  pedido: Request,
  { params }: { params: Promise<{ token: string; n: string }> },
) {
  const auth = autorizar(pedido);
  if (!auth.ok) return auth.resposta;

  const { token, n: bruto } = await params;
  const n = Number(bruto);
  if (!Number.isInteger(n) || !passoPorNumero(n)) {
    return respostaErro("passo_invalido", "Esse passo não existe.", 404);
  }

  const corpo = await corpoJson(pedido);
  if (!corpo.ok) return corpo.resposta;

  return respostaPasso(await guardarPasso(token, n, corpo.dados));
}
