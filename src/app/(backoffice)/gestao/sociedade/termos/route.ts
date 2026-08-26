import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { documentoOrganizacao } from "@/db/schema/sociedade";
import { registarEvento } from "@/features/auditoria/registar";
import { exigirAdministracao } from "@/lib/sessao";
import { termosEmVigor } from "@/lib/termos-sociedade";

/**
 * O articulado em vigor, para quem administra o poder rever.
 *
 * Autorizado pela sessão e não por token — é uma rota do back-office. Serve-se
 * `inline` porque isto é para ser lido, e o `nosniff` fica: o MIME está fixado
 * em `application/pdf` desde a entrada, porque `publicarTermosSociedade` não
 * deixa entrar outra coisa.
 */
export async function GET(pedido: Request) {
  const { eu } = await exigirAdministracao();

  const termos = await termosEmVigor(eu.organizacaoId);
  if (termos.forma !== "documento") {
    return NextResponse.json(
      { erro: "Ainda não há Termos e Condições publicados." },
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
        eq(documentoOrganizacao.organizacaoId, eu.organizacaoId),
        isNull(documentoOrganizacao.apagadoEm),
      ),
    )
    .limit(1);

  if (!doc?.dados) {
    return NextResponse.json({ erro: "Documento não encontrado." }, { status: 404 });
  }

  const bytes = new Uint8Array(Buffer.from(doc.dados, "base64"));

  await registarEvento({
    organizacaoId: eu.organizacaoId,
    atorId: eu.id,
    acao: "termos.consultados",
    entidade: "documento_organizacao",
    entidadeId: doc.id,
    valorNovo: { versao: termos.versao },
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
