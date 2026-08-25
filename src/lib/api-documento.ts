import "server-only";
import { NextResponse } from "next/server";
import { respostaErro } from "./api";

/**
 * O corpo `multipart/form-data` de um upload pela API.
 *
 * Os anexos não cabem em JSON, e um base64 dentro de um objeto JSON — que é a
 * alternativa habitual — cresce 33% e obriga a decidir um limite de corpo
 * diferente do que o resto da API tem. Multipart é o que o formulário já usa, e
 * a Server Action de upload recebe exatamente o mesmo `FormData` das duas
 * origens: nem sequer sabe qual delas é.
 */
export type Multipart =
  | { ok: true; formData: FormData }
  | { ok: false; resposta: NextResponse };

export async function corpoMultipart(pedido: Request): Promise<Multipart> {
  const tipo = pedido.headers.get("content-type") ?? "";
  if (!tipo.toLowerCase().includes("multipart/form-data")) {
    return {
      ok: false,
      resposta: respostaErro(
        "corpo_invalido",
        "Envie o ficheiro em multipart/form-data, com os campos «ficheiro» e «tipo».",
        415,
      ),
    };
  }

  try {
    return { ok: true, formData: await pedido.formData() };
  } catch {
    return {
      ok: false,
      resposta: respostaErro(
        "corpo_invalido",
        "Não foi possível ler o corpo multipart do pedido.",
        400,
      ),
    };
  }
}

/** A resposta de um upload, na forma que os três percursos partilham. */
export function respostaUpload(
  r: { ok: true; id: string; nome: string } | { ok: false; erro: string },
) {
  if (r.ok) return NextResponse.json({ ok: true, id: r.id, nome: r.nome });
  // 422 e não 400: o corpo chegou bem formado; o que falhou foi a regra —
  // formato recusado, ficheiro grande demais, conteúdo que não bate com a
  // extensão. Um bot que distinga os dois sabe quando reformular e quando
  // pedir outro ficheiro à pessoa.
  return NextResponse.json({ ok: false, erro: r.erro }, { status: 422 });
}
