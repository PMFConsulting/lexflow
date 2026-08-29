import { NextResponse } from "next/server";
import { acessoPorToken } from "@/features/onboarding/dados";
import { termosEmVigor, servirDocumentoOrganizacao } from "@/lib/termos-sociedade";

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

  /*
   * Que o cliente abriu os T&C é facto do dossier, não estatística.
   *
   * O passo 7 pede-lhe que declare ter lido o documento, e num articulado
   * servido em PDF a medição de leitura até ao fim não existe (ver
   * `lib/termos-sociedade.ts`). Este evento é o que resta como prova do lado da
   * plataforma: o momento em que o documento saiu daqui para ele, com a versão
   * à frente. Numa validação jurídica é isto que responde a "foi-lhe mostrado?".
   */
  return servirDocumentoOrganizacao({
    organizacaoId: processo.organizacaoId,
    termos: await termosEmVigor(processo.organizacaoId),
    mensagemSemTermos: "Esta sociedade ainda não submeteu o articulado dela.",
    acao: "termos.abertos_pelo_cliente",
    processoId: processo.id,
    valorNovo: (doc, versao, bytesLength) => ({ nome: doc.nome, versao, bytes: bytesLength }),
    ip: pedido.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: pedido.headers.get("user-agent") ?? null,
  });
}
