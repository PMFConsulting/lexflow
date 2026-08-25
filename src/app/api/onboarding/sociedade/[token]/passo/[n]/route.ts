import { corpoJson, autorizar, respostaErro, respostaPasso } from "@/lib/api";
import { guardarPassoSociedade } from "@/features/sociedade/acoes";
import { passoSociedadePorNumero } from "@/features/sociedade/passos";

/**
 * Grava um passo do registo da sociedade — pela mesma função que o formulário
 * chama, com o mesmo Zod e a mesma revalidação de token.
 *
 * Os passos 3 e 4 pedem documentos, e documentos não entram em JSON: sobem por
 * `POST /documento`, que é multipart. Um passo 3 gravado sem a certidão anexada
 * volta em `erros.documentos`, e é essa a mensagem que diz o que fazer.
 */
export async function POST(
  pedido: Request,
  { params }: { params: Promise<{ token: string; n: string }> },
) {
  const auth = autorizar(pedido);
  if (!auth.ok) return auth.resposta;

  const { token, n: bruto } = await params;
  const n = Number(bruto);
  if (!Number.isInteger(n) || !passoSociedadePorNumero(n)) {
    return respostaErro("passo_invalido", "Esse passo não existe.", 404);
  }

  const corpo = await corpoJson(pedido);
  if (!corpo.ok) return corpo.resposta;

  return respostaPasso(await guardarPassoSociedade(token, n, corpo.dados));
}
