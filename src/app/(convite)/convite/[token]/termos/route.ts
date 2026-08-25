import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { documentoOrganizacao } from "@/db/schema/sociedade";
import { acessoConvitePorToken } from "@/features/convites/dados";
import { registarEvento } from "@/features/auditoria/registar";
import { termosEmVigor } from "@/lib/termos-sociedade";

/**
 * O articulado da sociedade, para quem se está a registar o poder ler.
 *
 * Irmã da rota `/onboarding/[token]/termos`, e serve o mesmo ficheiro: quem
 * trabalha na sociedade aceita exatamente o articulado que os clientes dela
 * aceitam, que é o ponto 2 da revisão. A autorização é o próprio convite.
 */
export async function GET(
  pedido: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const acesso = await acessoConvitePorToken((await params).token);
  if (acesso.estado !== "ok") {
    return NextResponse.json({ erro: "Documento não encontrado." }, { status: 404 });
  }

  const { convite, org } = acesso;
  const termos = await termosEmVigor(org.id);

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

  // Num articulado servido em PDF a medição de leitura até ao fim não existe
  // (ver `lib/termos-sociedade.ts`); este evento é o que resta como prova do
  // lado da plataforma de que o documento foi mostrado, e com que versão.
  await registarEvento({
    organizacaoId: org.id,
    acao: "termos.abertos_pelo_utilizador",
    entidade: "documento_organizacao",
    entidadeId: doc.id,
    valorNovo: { email: convite.email, versao: termos.versao, bytes: bytes.length },
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
