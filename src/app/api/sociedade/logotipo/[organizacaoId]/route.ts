import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { organizacao } from "@/db/schema/organizacao";
import {
  FORMATOS_MIME_LOGOTIPO,
  type MimeLogotipo,
} from "@/features/administracao/logotipo-validador";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mimeSeguro(valor: string | null): MimeLogotipo | null {
  const encontrado = FORMATOS_MIME_LOGOTIPO.find((m) => m === valor);
  return encontrado ?? null;
}

/**
 * Serve publicamente o ficheiro de logótipo da sociedade por `organizacaoId`.
 *
 * Endpoint público: acessível sem sessão para que clientes de email (ex.: Gmail Mobile)
 * possam transferir a imagem via URL estável com cache de longa duração.
 */
export async function GET(
  _pedido: Request,
  { params }: { params: Promise<{ organizacaoId: string }> },
) {
  const { organizacaoId } = await params;

  if (!organizacaoId || !UUID.test(organizacaoId)) {
    return NextResponse.json({ erro: "Identificador de sociedade inválido." }, { status: 404 });
  }

  const [org] = await db()
    .select({
      logotipoDados: organizacao.logotipoDados,
      logotipoMime: organizacao.logotipoMime,
      logotipoNome: organizacao.logotipoNome,
    })
    .from(organizacao)
    .where(and(eq(organizacao.id, organizacaoId), isNull(organizacao.apagadoEm)))
    .limit(1);

  const mime = mimeSeguro(org?.logotipoMime ?? null);

  if (!org?.logotipoDados || !mime) {
    return NextResponse.json(
      { erro: "Esta sociedade não tem logótipo configurado." },
      { status: 404 },
    );
  }

  const bytes = Buffer.from(org.logotipoDados, "base64");
  const eSvg = mime === "image/svg+xml";

  return new Response(bytes, {
    headers: {
      "Content-Type": mime,
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": eSvg
        ? "attachment"
        : `inline; filename="${encodeURIComponent(org.logotipoNome ?? "logotipo")}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=86400, immutable",
      ...(eSvg
        ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" }
        : {}),
    },
  });
}
