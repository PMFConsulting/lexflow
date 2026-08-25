import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { documentoOrganizacao } from "@/db/schema/sociedade";
import { acessoPorToken } from "@/features/onboarding/dados";
import { registarEvento } from "@/features/auditoria/registar";
import { termosEmVigor } from "@/lib/termos-sociedade";

/**
 * O articulado de Termos e Condições da sociedade, para o cliente ler no fecho.
 *
 * Irmã da rota `/proposta`, e pelas mesmas razões: a autorização é o próprio
 * link mágico — o mesmo token que abre os sete passos abre o documento que se
 * lhe pede para aceitar —, serve-se `inline` porque isto é para ser lido, e um
 * token que não resolva responde 404 sem dizer porquê (a distinção entre
 * expirado, arquivado e desconhecido é trabalho das páginas, que a fazem em
 * português e com saída para cada caso).
 *
 * Quando a sociedade **não** entregou articulado nenhum, isto responde 404 e
 * não um PDF genérico: nesse caso o passo 7 nem sequer aponta para aqui — está
 * a servir o texto da plataforma, renderizado no próprio leitor, e um ficheiro
 * inventado seria uma segunda versão do mesmo documento a circular.
 */
export async function GET(
  pedido: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const acesso = await acessoPorToken((await params).token);
  if (acesso.estado !== "ok") {
    return NextResponse.json({ erro: "Documento não encontrado." }, { status: 404 });
  }

  const { processo } = acesso;
  const termos = await termosEmVigor(processo.organizacaoId);

  if (termos.forma !== "documento") {
    return NextResponse.json(
      { erro: "Esta sociedade ainda não submeteu o articulado dela." },
      { status: 404 },
    );
  }

  const [doc] = await db()
    .select({
      id: documentoOrganizacao.id,
      nome: documentoOrganizacao.nomeOriginal,
      dados: documentoOrganizacao.dados,
    })
    .from(documentoOrganizacao)
    .where(
      and(
        eq(documentoOrganizacao.id, termos.documentoId),
        isNull(documentoOrganizacao.apagadoEm),
      ),
    )
    .limit(1);

  if (!doc?.dados) {
    return NextResponse.json({ erro: "Documento não encontrado." }, { status: 404 });
  }

  const bytes = new Uint8Array(Buffer.from(doc.dados, "base64"));
  if (bytes.length === 0) {
    return NextResponse.json({ erro: "O ficheiro está vazio ou corrompido." }, { status: 404 });
  }

  /*
   * Que o cliente abriu os T&C é facto do dossier, não estatística.
   *
   * O passo 7 pede-lhe que declare ter lido o documento, e num articulado
   * servido em PDF a medição de leitura até ao fim não existe (ver
   * `lib/termos-sociedade.ts`). Este evento é o que resta como prova do lado da
   * plataforma: o momento em que o documento saiu daqui para ele, com a versão
   * à frente. Numa validação jurídica é isto que responde a "foi-lhe mostrado?".
   */
  await registarEvento({
    organizacaoId: processo.organizacaoId,
    processoId: processo.id,
    acao: "termos.abertos_pelo_cliente",
    entidade: "documento_organizacao",
    entidadeId: doc.id,
    valorNovo: { nome: doc.nome, versao: termos.versao, bytes: bytes.length },
    ip: pedido.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: pedido.headers.get("user-agent") ?? null,
  }).catch((e) => console.error("[termos] audit write failed", { erro: String(e) }));

  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename="termos-condicoes.pdf"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
    },
  });
}
