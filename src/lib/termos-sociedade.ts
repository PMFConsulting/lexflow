import "server-only";
import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { organizacao } from "@/db/schema/organizacao";
import { documentoOrganizacao } from "@/db/schema/sociedade";
import { registarEvento } from "@/features/auditoria/registar";
import { TERMOS_CONDICOES, VERSAO_TERMOS, type SeccaoTermos } from "./termos";

/**
 * Que T&C estão em vigor para uma sociedade. Duas formas:
 *
 *   · `plataforma` — texto de `src/lib/termos.ts`, servido enquanto a
 *     sociedade não entrega o seu. Leitura até ao fim medida no elemento
 *     (D30), o que dá valor probatório à aceitação.
 *
 *   · `documento` — PDF submetido pela sociedade. Perde-se a medição da D30
 *     (mesmo caso da proposta comercial, D52): `X-Frame-Options: DENY` recusa
 *     um `<iframe>` do próprio domínio, e não há como medir o scroll de um PDF
 *     aberto noutro separador. A caixa destranca ao abrir o documento.
 *
 * A versão viaja sempre nas duas formas — é ela que fica gravada com o
 * consentimento (D3) e por ela que se procura (D38).
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
 * Resolve os T&C de uma organização. Recua para o texto da plataforma em três
 * casos: nunca entregue, entregue e depois apagado, entregue sem versão — os
 * dois últimos escapavam a uma verificação só a `termos_documento_ref != null`,
 * deixando o passo 7 a apontar para um ficheiro que não abre.
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
 * A versão em vigor, sozinha — para quem só precisa de comparar (portal do
 * advogado). Puxar o documento inteiro só para isso seria uma consulta a mais
 * em cada carregamento de página.
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
 * `convite/[token]/termos`) — mesma consulta, mesmos cabeçalhos, mesma
 * auditoria; só o 404 e os dados do evento variam por chamador.
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
