import { exigirEquipaDaSociedade } from "@/lib/sessao";
import { termosEmVigor, servirDocumentoOrganizacao } from "@/lib/termos-sociedade";

/**
 * O articulado em vigor, para quem trabalha na sociedade o poder ler.
 *
 * Autorizada por sessão e sem exigir administração: é o documento que **esta
 * pessoa** tem de aceitar, e um articulado que só quem administra pudesse abrir
 * seria uma aceitação pedida às cegas.
 */
export async function GET(pedido: Request) {
  const { eu } = await exigirEquipaDaSociedade();

  return servirDocumentoOrganizacao({
    organizacaoId: eu.organizacaoId,
    termos: await termosEmVigor(eu.organizacaoId),
    mensagemSemTermos: "A sociedade ainda não publicou articulado.",
    acao: "termos.abertos_pelo_utilizador",
    atorId: eu.id,
    valorNovo: (_doc, versao) => ({ email: eu.email, versao }),
    ip: pedido.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: pedido.headers.get("user-agent") ?? null,
  });
}
