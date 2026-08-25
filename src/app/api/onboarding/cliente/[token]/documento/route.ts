import { autorizar } from "@/lib/api";
import { corpoMultipart, respostaUpload } from "@/lib/api-documento";
import { carregarDocumento } from "@/features/onboarding/documentos";

/**
 * Anexa um documento ao registo do cliente.
 *
 * `multipart/form-data` com `ficheiro` e `tipo`, e chama a mesma
 * `carregarDocumento` do campo de anexos — com a mesma allowlist de tipos, o
 * mesmo limite de 4 MB e a mesma verificação de magic bytes. Um ficheiro que se
 * diga PDF e não seja é recusado aqui exatamente como é no browser.
 */
export async function POST(
  pedido: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const auth = autorizar(pedido);
  if (!auth.ok) return auth.resposta;

  const corpo = await corpoMultipart(pedido);
  if (!corpo.ok) return corpo.resposta;

  return respostaUpload(await carregarDocumento((await params).token, corpo.formData));
}
