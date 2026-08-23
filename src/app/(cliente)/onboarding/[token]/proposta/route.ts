import { NextResponse } from "next/server";
import { acessoPorToken } from "@/features/onboarding/dados";
import { propostaDoProcesso } from "@/features/processos/consultas";
import { registarEvento } from "@/features/auditoria/registar";

/**
 * A proposta comercial deste processo, para o cliente a ler no fecho.
 *
 * A autorização é o próprio link mágico — o mesmo token que abre os sete passos
 * abre o documento que se lhe pede para aceitar, e não faria sentido que fosse
 * outra coisa. Um token que não resolva responde 404 sem dizer porquê: aqui não
 * há ecrã a desenhar, e a distinção entre expirado, arquivado e desconhecido
 * (D49) é trabalho das páginas, que a fazem em português e com saída para cada
 * caso.
 *
 * Serve-se `inline` e não `attachment`: isto é para ser lido, ao contrário do
 * download do back-office. O `nosniff` fica, e o MIME está fixado em
 * `application/pdf` desde a entrada — `carregarPropostaComercial` não deixa
 * entrar outra coisa.
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
  const proposta = await propostaDoProcesso(processo.id);

  if (!proposta?.dados) {
    return NextResponse.json({ erro: "Não há proposta anexada a este processo." }, { status: 404 });
  }

  const bytes = new Uint8Array(Buffer.from(proposta.dados, "base64"));
  if (bytes.length === 0) {
    return NextResponse.json({ erro: "O ficheiro está vazio ou corrompido." }, { status: 404 });
  }

  /*
   * Que o cliente abriu a proposta é facto do dossier, não estatística.
   *
   * O passo 7 pede-lhe que declare ter lido o documento, e a única prova que a
   * plataforma tem dessa leitura é a caixa que ele próprio marca. Este evento é
   * a segunda metade: o momento em que o documento saiu daqui para ele. Fica
   * antes da entrega, como no download do back-office — um documento entregue
   * sem rasto é pior do que uma entrega que se repete.
   *
   * Sem `atorId`: quem abriu foi o cliente, que não é utilizador do sistema. É
   * a mesma ausência que os eventos dos passos já têm.
   */
  await registarEvento({
    organizacaoId: processo.organizacaoId,
    processoId: processo.id,
    acao: "proposta.aberta_pelo_cliente",
    entidade: "documento",
    entidadeId: proposta.id,
    valorNovo: { nome: proposta.nome, bytes: bytes.length },
    ip: pedido.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: pedido.headers.get("user-agent") ?? null,
  });

  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename="proposta.pdf"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
    },
  });
}
