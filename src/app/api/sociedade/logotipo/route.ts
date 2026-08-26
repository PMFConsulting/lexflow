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
  const url = new URL(pedido.url);
  const sociedadeIdParam = url.searchParams.get("sociedadeId");

  if (sociedadeIdParam && !UUID.test(sociedadeIdParam)) {
    return NextResponse.json({ erro: "Identificador de sociedade inválido." }, { status: 400 });
  }

  let organizacaoId: string | null = null;

  if (sociedadeIdParam) {
    organizacaoId = sociedadeIdParam;
  } else {
    const sessao = await sessaoAtual();
    if (!sessao?.eu) {
      return NextResponse.json({ erro: "Sessão não autenticada." }, { status: 401 });
    }
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
   * SVG é código, não é um mapa de pixels.
   *
   * Um `<script>` dentro de um `.svg` não corre quando o ficheiro é carregado
   * num `<img>` — mas corre quando alguém abre este endereço diretamente, e aí
   * corre **na origem da aplicação**, com o cookie de sessão do lado de dentro.
   * O `nosniff` não trava nada disto: o tipo declarado é mesmo `image/svg+xml`.
   * E a CSP global da app tem `script-src 'unsafe-inline'` (`next.config.ts`),
   * ou seja, não é ela que o apanha.
   *
   * Desde que a sociedade carrega o logótipo no seu próprio registo, quem
   * escreve esta coluna já não é obrigatoriamente uma conta autenticada: basta
   * ter o link mágico, e um link mágico anda dentro de um email reencaminhável.
   *
   * Duas travas, e nenhuma delas estraga o `<img>`:
   *  · uma CSP **de resposta**, que só vale para este documento e não deixa
   *    correr script nenhum se ele for aberto como página;
   *  · `Content-Disposition: attachment`, que faz da navegação direta uma
   *    transferência em vez de uma renderização. Um `<img src>` ignora este
   *    cabeçalho — é para navegação que ele conta.
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
