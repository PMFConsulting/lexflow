import { exigirAdministracao } from "@/lib/sessao";
import { termosEmVigor, servirDocumentoOrganizacao } from "@/lib/termos-sociedade";

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

  return servirDocumentoOrganizacao({
    organizacaoId: eu.organizacaoId,
    termos: await termosEmVigor(eu.organizacaoId),
    mensagemSemTermos: "Ainda não há Termos e Condições publicados.",
    acao: "termos.consultados",
    atorId: eu.id,
    valorNovo: (_doc, versao) => ({ versao }),
    ip: pedido.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: pedido.headers.get("user-agent") ?? null,
  });
}
