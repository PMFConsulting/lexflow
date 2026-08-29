import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { organizacao } from "@/db/schema/organizacao";
import {
  FORMATOS_MIME_LOGOTIPO,
  type MimeLogotipo,
} from "@/features/administracao/logotipo-validador";
import { sessaoAtual } from "@/lib/sessao";

/**
 * Serve o ficheiro de imagem do logótipo da sociedade.
 *
 * Acesso protegido: exige sessão ativa de utilizador pertencente à sociedade
 * (ou super_admin a inspecionar uma sociedade específica via ?sociedadeId).
 *
 * O logótipo é servido com o MIME original guardado na base de dados e com
 * cabeçalho de cache privado de curta duração.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mimeSeguro(valor: string | null): MimeLogotipo | null {
  const encontrado = FORMATOS_MIME_LOGOTIPO.find((m) => m === valor);
  return encontrado ?? null;
}

export async function GET(pedido: Request) {
  const sessao = await sessaoAtual();
  if (!sessao?.eu) {
    return NextResponse.json({ erro: "Sessão não autenticada." }, { status: 401 });
  }

  const url = new URL(pedido.url);
  const sociedadeIdParam = url.searchParams.get("sociedadeId");

  if (sociedadeIdParam && !UUID.test(sociedadeIdParam)) {
    return NextResponse.json({ erro: "Identificador de sociedade inválido." }, { status: 400 });
  }

  let organizacaoId: string | null = null;

  if (sociedadeIdParam) {
    if (sessao.eu.papel === "super_admin" || sessao.eu.organizacaoId === sociedadeIdParam) {
      organizacaoId = sociedadeIdParam;
    } else {
      return NextResponse.json({ erro: "Acesso não autorizado." }, { status: 403 });
    }
  } else {
    organizacaoId = sessao.eu.organizacaoId ?? null;
  }

  if (!organizacaoId || !UUID.test(organizacaoId)) {
    return NextResponse.json({ erro: "Organização não identificada." }, { status: 404 });
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

  /*
   * SVG é código. Um `<script>` lá dentro não corre num `<img>`, mas corre se
   * alguém abrir este endereço diretamente — na origem da app, com o cookie de
   * sessão. `nosniff` não ajuda (o MIME declarado é mesmo `image/svg+xml`), e a
   * CSP global tem `script-src 'unsafe-inline'` (`next.config.ts`).
   *
   * O upload é feito com o link mágico do registo da sociedade, nem sempre uma
   * conta autenticada.
   *
   * Duas travas que não estragam o `<img>`: CSP de resposta só para este
   * documento, e `Content-Disposition: attachment`, que torna a navegação
   * direta uma transferência (um `<img src>` ignora este cabeçalho).
   */
  const eSvg = mime === "image/svg+xml";

  return new Response(bytes, {
    headers: {
      "Content-Type": mime,
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": eSvg
        ? "attachment"
        : `inline; filename="${encodeURIComponent(org.logotipoNome ?? "logotipo")}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
      ...(eSvg
        ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" }
        : {}),
    },
  });
}
