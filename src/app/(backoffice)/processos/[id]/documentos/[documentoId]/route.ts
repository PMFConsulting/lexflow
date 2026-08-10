import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { documento } from "@/db/schema/documentos";
import { processoOnboarding } from "@/db/schema/processo";
import { registarEvento } from "@/features/auditoria/registar";
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

/**
 * Os `id` são uuidv7 gerados na aplicação (D15). Um segmento que não seja um
 * UUID não é "não encontrado" para o Postgres — é `invalid input syntax for
 * type uuid`, ou seja, um 500 a partir do URL, que é a mesma classe de defeito
 * que a D35 fechou no `/emails`. Recusa-se antes de chegar à consulta.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O `Content-Disposition` de um nome português.
 *
 * O `nomeOriginal` vem do cliente e não é de confiança: uma quebra de linha lá
 * dentro parte o cabeçalho, e as aspas fecham-no a meio. Mas o problema mais
 * banal é o acento — `Documentação.pdf` num `filename=` simples é escrito em
 * latin-1 e chega à pasta do utilizador como `DocumentaÃ§Ã£o.pdf`. Vão os dois
 * parâmetros: o `filename` em ASCII para quem só o entenda a ele, e o
 * `filename*` em UTF-8 (RFC 5987), que é o que os browsers atuais preferem.
 */
function disposicao(nome: string): string {
  const limpo = nome.replace(/[\u0000-\u001f\u007f"\\]/g, "_").trim() || "documento";
  const ascii = limpo.replace(/[^\u0020-\u007e]/g, "_");
  // O `encodeURIComponent` deixa passar `!'()*`, que não são `attr-char`.
  const utf8 = encodeURIComponent(limpo).replace(
    /['()*!]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export async function GET(
  pedido: Request,
  { params }: { params: Promise<{ id: string; documentoId: string }> },
) {
  const { id, documentoId } = await params;
  const { eu } = await exigirSessao();

  if (!UUID.test(id) || !UUID.test(documentoId)) {
    return NextResponse.json({ erro: "Documento não encontrado." }, { status: 404 });
  }

  const base = db();

  const [processo] = await base
    .select({ organizacaoId: processoOnboarding.organizacaoId })
    .from(processoOnboarding)
    .where(and(eq(processoOnboarding.id, id), isNull(processoOnboarding.apagadoEm)))
    .limit(1);

  // Um processo de outra organização responde o mesmo que um processo que não
  // existe: distingui-los seria confirmar a existência da referência a quem não
  // a pode ver.
  if (!processo || processo.organizacaoId !== eu.organizacaoId) {
    return NextResponse.json({ erro: "Processo não encontrado." }, { status: 404 });
  }

  const [doc] = await base
    .select({
      nome: documento.nomeOriginal,
      mime: documento.mime,
      tipo: documento.tipo,
      dados: documento.dados,
    })
    .from(documento)
    .where(
      and(
        eq(documento.id, documentoId),
        eq(documento.processoId, id),
        isNull(documento.apagadoEm),
      ),
    )
    .limit(1);

  if (!doc) {
    return NextResponse.json({ erro: "Documento não encontrado." }, { status: 404 });
  }
  if (!doc.dados) {
    return NextResponse.json(
      { erro: "O documento só está acessível no armazenamento dedicado." },
      { status: 404 },
    );
  }

  const bytes = new Uint8Array(Buffer.from(doc.dados, "base64"));
  if (bytes.length === 0) {
    return NextResponse.json({ erro: "O ficheiro está vazio ou corrompido." }, { status: 404 });
  }

  // Descarregar um documento de identificação é dos acontecimentos mais
  // sensíveis do sistema — o §4 do brief pede-o registado, e o comentário da
  // própria tabela diz que "todo o download fica em auditoria". O registo é
  // deliberadamente anterior à entrega: se ele falhar, o download falha
  // também, porque um documento entregue sem rasto é pior do que um download
  // que se repete.
  await registarEvento({
    organizacaoId: processo.organizacaoId,
    processoId: id,
    atorId: eu.id,
    acao: "documento.descarregado",
    entidade: "documento",
    entidadeId: documentoId,
    valorNovo: { nome: doc.nome, tipo: doc.tipo, bytes: bytes.length },
    ip: pedido.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: pedido.headers.get("user-agent") ?? null,
  });

  return new Response(bytes, {
    headers: {
      // O MIME foi normalizado contra a lista dos aceites à entrada
      // (`formatos.ts`), mas o `nosniff` fecha o caso de um ficheiro antigo,
      // carregado antes dessa regra, ser adivinhado como HTML pelo browser.
      "Content-Type": doc.mime || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": disposicao(doc.nome),
      "Content-Length": String(bytes.length),
      // Um documento de identificação não fica em cache de intermediário
      // nenhum, nem em disco depois de a sessão terminar.
      "Cache-Control": "private, no-store",
    },
  });
}
