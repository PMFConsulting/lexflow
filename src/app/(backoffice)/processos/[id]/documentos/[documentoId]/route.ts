import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { documento } from "@/db/schema/documentos";
import { processoOnboarding } from "@/db/schema/processo";
import { exigirSessao } from "@/lib/sessao";

/**
 * Descarrega um documento anexado a um processo.
 *
 * Enquanto não há object storage, o ficheiro vive em base64 na base de dados
 * (`documento.dados`) e esta rota serve-o diretamente — é o que permite ao
 * painel ver o que o cliente carregou sem depender do armazenamento dedicado.
 * Quando `dados` estiver vazio (ficheiro só no bucket), a rota devolve 404 com
 * a indicação de que o download passa pelo URL assinado do armazenamento.
 *
 * Autorização: só um utilizador da mesma organização do processo descarrega.
 */
export async function GET(
  _pedido: Request,
  { params }: { params: Promise<{ id: string; documentoId: string }> },
) {
  const { id, documentoId } = await params;
  const { eu } = await exigirSessao();
  const base = db();

  const [processo] = await base
    .select({ organizacaoId: processoOnboarding.organizacaoId })
    .from(processoOnboarding)
    .where(eq(processoOnboarding.id, id));

  if (!processo || processo.organizacaoId !== eu.organizacaoId) {
    return NextResponse.json({ erro: "Processo não encontrado." }, { status: 404 });
  }

  const [doc] = await base
    .select({
      nome: documento.nomeOriginal,
      mime: documento.mime,
      dados: documento.dados,
    })
    .from(documento)
    .where(
      and(
        eq(documento.id, documentoId),
        eq(documento.processoId, id),
        isNull(documento.apagadoEm),
      ),
    );

  if (!doc) {
    return NextResponse.json({ erro: "Documento não encontrado." }, { status: 404 });
  }
  if (!doc.dados) {
    return NextResponse.json(
      { erro: "O documento só está acessível no armazenamento dedicado." },
      { status: 404 },
    );
  }

  const buffer = Buffer.from(doc.dados, "base64");
  const nomeSeguro = doc.nome.replace(/["\\]/g, "_");
  return new Response(buffer, {
    headers: {
      "Content-Type": doc.mime || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${nomeSeguro}"`,
      "Content-Length": String(buffer.length),
    },
  });
}
