import { autorizar } from "@/lib/api";
import { corpoMultipart, respostaUpload } from "@/lib/api-documento";
import { carregarDocumentoConvite } from "@/features/convites/documentos";

/**
 * Anexa um documento ao registo de uma pessoa da equipa — identificação ou
 * cédula profissional.
 *
 * Mesma função do formulário. O documento fica pendurado no convite e não na
 * sociedade, que é o que impede o cartão de cidadão de um advogado de aparecer
 * na lista de documentos da sociedade inteira.
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
    await carregarDocumentoConvite((await params).token, corpo.formData),
  );
}
