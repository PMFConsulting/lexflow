import { autorizar } from "@/lib/api";
import { corpoMultipart, respostaUpload } from "@/lib/api-documento";
import { carregarDocumentoSociedade } from "@/features/sociedade/documentos";

/**
 * Anexa um documento ao registo da sociedade — certidão permanente ou o PDF dos
 * Termos e Condições.
 *
 * Mesma função do formulário, incluindo a regra de que os T&C só entram em PDF:
 * é o documento que vai ser apresentado a cada cliente, e uma fotografia de um
 * contrato não é um contrato legível.
 */
export async function POST(
  pedido: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const auth = autorizar(pedido);
  if (!auth.ok) return auth.resposta;

  const corpo = await corpoMultipart(pedido);
  if (!corpo.ok) return corpo.resposta;

  return respostaUpload(
    await carregarDocumentoSociedade((await params).token, corpo.formData),
  );
}
