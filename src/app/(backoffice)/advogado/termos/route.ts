import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { documentoOrganizacao } from "@/db/schema/sociedade";
import { registarEvento } from "@/features/auditoria/registar";
import { exigirEquipaDaSociedade } from "@/lib/sessao";
import { termosEmVigor } from "@/lib/termos-sociedade";

/**
 * O articulado em vigor, para quem trabalha na sociedade o poder ler.
 *
 * Autorizada por sessão e sem exigir administração: é o documento que **esta
 * pessoa** tem de aceitar, e um articulado que só quem administra pudesse abrir
 * seria uma aceitação pedida às cegas.
 */
export async function GET(pedido: Request) {
  const { eu } = await exigirEquipaDaSociedade();

  const termos = await termosEmVigor(eu.organizacaoId);
  if (termos.forma !== "documento") {
    return NextResponse.json(
      { erro: "A sociedade ainda não publicou articulado." },
      { status: 404 },
    );
  }

  const [doc] = await db()
    .select({
      id: documentoOrganizacao.id,
      dados: documentoOrganizacao.dados,
    })
    .from(documentoOrganizacao)
    .where(
      and(
        eq(documentoOrganizacao.id, termos.documentoId),
        eq(documentoOrganizacao.organizacaoId, eu.organizacaoId),
        isNull(documentoOrganizacao.apagadoEm),
      ),
    )
    .limit(1);

  if (!doc?.dados) {
    return NextResponse.json({ erro: "Documento não encontrado." }, { status: 404 });
  }

  const bytes = new Uint8Array(Buffer.from(doc.dados, "base64"));

  // Num articulado em PDF não há medição de leitura até ao fim; este evento é o
  // que resta como prova de que o documento foi mostrado, e com que versão.
  await registarEvento({
    organizacaoId: eu.organizacaoId,
    atorId: eu.id,
    acao: "termos.abertos_pelo_utilizador",
    entidade: "documento_organizacao",
    entidadeId: doc.id,
    valorNovo: { email: eu.email, versao: termos.versao },
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
