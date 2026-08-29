import "server-only";
import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { organizacao } from "@/db/schema/organizacao";
import { documentoOrganizacao } from "@/db/schema/sociedade";
import { registarEvento } from "@/features/auditoria/registar";
import { TERMOS_CONDICOES, VERSAO_TERMOS, type SeccaoTermos } from "./termos";

/**
 * Que Termos e Condições estão em vigor para uma sociedade.
 *
 * Este é o ponto 2 da revisão do cliente, e a razão por que ele esperou até
 * aqui: «os termos e condições são os da sociedade, ou seja, os mesmos de
 * advogado para advogado, e teríamos de garantir que, aquando do onboarding dos
 * utilizadores, estes também nos enviam os T&C». As duas metades são a mesma —
 * o articulado tem de vir da sociedade, e cada pessoa que se junta a ela tem de
 * o aceitar. Sem o onboarding da sociedade não havia de onde vir o documento, e
 * sem o onboarding de utilizadores não havia quem o aceitasse.
 *
 * Duas formas, e o consumidor tem de saber qual está a receber:
 *
 *   · `plataforma` — o texto de `src/lib/termos.ts`, em secções. É o que está a
 *     correr hoje e continua a ser servido enquanto a sociedade não entregar o
 *     dela. A leitura até ao fim é medida no próprio elemento (D30), e é essa
 *     medição que dá valor probatório à aceitação.
 *
 *   · `documento` — o PDF que a sociedade submeteu. Aqui **perde-se a medição
 *     da D30**, exatamente como aconteceu com a proposta comercial anexada
 *     (D52): o `X-Frame-Options: DENY` do `next.config.ts` recusa o próprio
 *     domínio, um `<iframe>` daria um retângulo em branco, e medir o scroll de
 *     um PDF que abre noutro separador não é possível. A caixa destranca ao
 *     **abrir** o documento em vez de ao chegar ao fim. Fingir a medição era
 *     pior do que dizer que ali ela não existe.
 *
 * A versão viaja sempre, nas duas formas, porque é ela que fica gravada junto
 * do consentimento (D3) e é por ela que se procura (D38).
 */
export type TermosEmVigor =
  | { forma: "plataforma"; versao: string; seccoes: SeccaoTermos[] }
  | {
      forma: "documento";
      versao: string;
      documentoId: string;
      nome: string;
      atualizadoEm: Date | null;
    };

/**
 * Resolve os T&C de uma organização.
 *
 * O recuo para o texto da plataforma acontece em três casos, e não só no óbvio:
 * a sociedade nunca entregou nada; entregou e o documento foi entretanto
 * apagado; entregou e falta-lhe a versão. Os dois últimos são o que uma
 * verificação só a `termos_documento_ref != null` deixava passar — e o que
 * saía do outro lado era um passo 7 a apontar para um ficheiro que não abre,
 * com a caixa de aceitação trancada para sempre.
 */
export async function termosEmVigor(organizacaoId: string): Promise<TermosEmVigor> {
  const plataforma: TermosEmVigor = {
    forma: "plataforma",
    versao: VERSAO_TERMOS,
    seccoes: TERMOS_CONDICOES,
  };

  const [org] = await db()
    .select({
      ref: organizacao.termosDocumentoRef,
      versao: organizacao.termosVersao,
      atualizadoEm: organizacao.termosAtualizadoEm,
    })
    .from(organizacao)
    .where(eq(organizacao.id, organizacaoId))
    .limit(1);

  if (!org?.ref || !org.versao) return plataforma;

  const [doc] = await db()
    .select({ id: documentoOrganizacao.id, nome: documentoOrganizacao.nomeOriginal })
    .from(documentoOrganizacao)
    .where(
      and(
        eq(documentoOrganizacao.id, org.ref),
        eq(documentoOrganizacao.organizacaoId, organizacaoId),
        isNull(documentoOrganizacao.apagadoEm),
      ),
    )
    .limit(1);

  if (!doc) return plataforma;

  return {
    forma: "documento",
    versao: org.versao,
    documentoId: doc.id,
    nome: doc.nome,
    atualizadoEm: org.atualizadoEm,
  };
}

/**
 * A versão em vigor, sozinha.
 *
 * Serve quem só precisa de comparar — o portal do advogado, a perguntar se a
 * aceitação que aquela pessoa tem é da versão que está de pé. Puxar o documento
 * inteiro para responder a isso seria uma consulta a mais em cada carregamento
 * de página.
 */
export async function versaoTermosEmVigor(organizacaoId: string): Promise<string> {
  const [org] = await db()
    .select({ versao: organizacao.termosVersao })
    .from(organizacao)
    .where(eq(organizacao.id, organizacaoId))
    .limit(1);

  return org?.versao ?? VERSAO_TERMOS;
}

/**
 * O PDF do articulado em vigor, servido às quatro rotas que o expõem
 * (`advogado/termos`, `gestao/sociedade/termos`, `onboarding/[token]/termos`,
 * `convite/[token]/termos`) — mesma consulta, mesmos cabeçalhos, mesma prova
 * de auditoria; só o texto do 404 sem articulado e os dados do evento variam
 * por chamador. Uma correção de segurança feita aqui chega às quatro.
 */
export async function servirDocumentoOrganizacao({
  organizacaoId,
  termos,
  mensagemSemTermos,
  acao,
  atorId,
  processoId,
  valorNovo,
  ip,
  userAgent,
}: {
  organizacaoId: string;
  termos: TermosEmVigor;
  mensagemSemTermos: string;
  acao: string;
  atorId?: string | null;
  processoId?: string | null;
  /** Recebe o nome do ficheiro, a versão em vigor e o tamanho em bytes — todos só existem depois de confirmado `termos.forma === "documento"`. */
  valorNovo: (doc: { nome: string }, versao: string, bytesLength: number) => Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
}): Promise<Response> {
  if (termos.forma !== "documento") {
    return NextResponse.json({ erro: mensagemSemTermos }, { status: 404 });
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
        eq(documentoOrganizacao.organizacaoId, organizacaoId),
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

  await registarEvento({
    organizacaoId,
    processoId,
    atorId,
    acao,
    entidade: "documento_organizacao",
    entidadeId: doc.id,
    valorNovo: valorNovo({ nome: doc.nome }, termos.versao, bytes.length),
    ip,
    userAgent,
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
