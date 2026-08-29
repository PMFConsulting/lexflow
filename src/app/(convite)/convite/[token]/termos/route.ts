import { NextResponse } from "next/server";
import { acessoConvitePorToken } from "@/features/convites/dados";
import { termosEmVigor, servirDocumentoOrganizacao } from "@/lib/termos-sociedade";

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

  // Num articulado servido em PDF a medição de leitura até ao fim não existe
  // (ver `lib/termos-sociedade.ts`); este evento é o que resta como prova do
  // lado da plataforma de que o documento foi mostrado, e com que versão.
  return servirDocumentoOrganizacao({
    organizacaoId: org.id,
    termos: await termosEmVigor(org.id),
    mensagemSemTermos: "Esta sociedade ainda não submeteu o articulado dela.",
    acao: "termos.abertos_pelo_utilizador",
    valorNovo: (_doc, versao, bytesLength) => ({ email: convite.email, versao, bytes: bytesLength }),
    ip: pedido.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: pedido.headers.get("user-agent") ?? null,
  });
}
