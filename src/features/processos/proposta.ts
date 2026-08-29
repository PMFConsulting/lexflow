"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { documento } from "@/db/schema/documentos";
import { processoOnboarding } from "@/db/schema/processo";
import { registarEvento } from "@/features/auditoria/registar";
import { assinaturaConfere, mensagemConteudo } from "@/features/onboarding/formatos";
import { exigirEquipaOuSuperAdmin, podeAcederSociedade } from "@/lib/sessao";

/**
 * A proposta comercial que segue com o convite (D52).
 *
 * Antes o passo 7 mostrava sempre o `/custos.html` genérico — agora o
 * documento que o cliente aceita é o que a sociedade negociou com ele.
 *
 * Upload do lado da sociedade, não do cliente — por isso não passa por
 * `documentos.ts` do onboarding (sessão e papel aqui, token mágico lá).
 *
 * Só PDF: os anexos do cliente aceitam fotografias (documento tirado com o
 * telemóvel), mas uma proposta é produzida pela sociedade e tem de ser
 * legível e imprimível.
 */

/** O mesmo tamanho dos anexos do cliente: o `bodySizeLimit` são 6 MB (base64 incluído). */
const MAX_BYTES = 4 * 1024 * 1024;

export type ResultadoProposta =
  | { ok: true; id: string; nome: string; bytes: number }
  | { ok: false; erro: string };

export async function carregarPropostaComercial(
  processoId: string,
  formData: FormData,
): Promise<ResultadoProposta> {
  const { eu } = await exigirEquipaOuSuperAdmin();

  const ficheiro = formData.get("ficheiro");
  if (!(ficheiro instanceof File) || ficheiro.size === 0) {
    return { ok: false, erro: "Escolha o ficheiro da proposta comercial." };
  }
  if (ficheiro.size > MAX_BYTES) {
    const mb = (ficheiro.size / 1024 / 1024).toFixed(1);
    return { ok: false, erro: `A proposta tem ${mb} MB. O máximo são 4 MB.` };
  }

  // Tipo declarado pelo browser primeiro; extensão como fallback quando ele
  // não se compromete. Mesma lógica de `formatos.ts`, reduzida a um formato só.
  const tipo = (ficheiro.type ?? "").trim().toLowerCase();
  const pdfPeloNome = ficheiro.name.toLowerCase().endsWith(".pdf");
  const indeciso = tipo === "" || tipo === "application/octet-stream";
  if (!(tipo === "application/pdf" || (indeciso && pdfPeloNome))) {
    return {
      ok: false,
      erro: `«${ficheiro.name}» não é um PDF. A proposta comercial tem de ser um ficheiro PDF.`,
    };
  }

  const base = db();

  const [processo] = await base
    .select({
      id: processoOnboarding.id,
      organizacaoId: processoOnboarding.organizacaoId,
      referencia: processoOnboarding.referencia,
      estado: processoOnboarding.estado,
    })
    .from(processoOnboarding)
    .where(and(eq(processoOnboarding.id, processoId), isNull(processoOnboarding.apagadoEm)))
    .limit(1);

  // Mesma resposta para "não existe" e "é de outra organização" — regra da
  // rota de download e do detalhe. super_admin tem acesso transversal.
  if (!processo || !podeAcederSociedade(eu, processo.organizacaoId)) {
    return { ok: false, erro: "Processo não encontrado." };
  }

  if (processo.estado === "aprovado" || processo.estado === "arquivado") {
    // Mesma mensagem das outras ações de imutabilidade. Ação independente do
    // detalhe — a recusa também fica na auditoria.
    try {
      await registarEvento({
        organizacaoId: processo.organizacaoId,
        processoId: processo.id,
        atorId: eu.id,
        acao: "processo.edicao_recusada",
        entidade: "processo_onboarding",
        entidadeId: processo.id,
        valorAnterior: { estado: processo.estado },
        valorNovo: { alvo: "proposta_comercial" },
      });
    } catch (e) {
      console.error(`[processo] ${processo.referencia}: falhou auditoria de tentativa de upload da proposta`, e);
    }
    return { ok: false, erro: "Processo aprovado — já não pode ser alterado." };
  }

  const bytes = Buffer.from(await ficheiro.arrayBuffer());

  /*
   * Só os primeiros bytes não são escolhidos por quem envia: nome e MIME vêm
   * do browser, e um ficheiro com HTML lá dentro, chamado `proposta.pdf` e
   * declarado `application/pdf`, passa as duas verificações acima. É servido
   * **inline** ao cliente em `/onboarding/[token]/proposta` — o único
   * documento desta plataforma servido assim — daí a assinatura `%PDF-`
   * fechar o degrau que falta. Não valida o interior (um PDF com JavaScript
   * continua a ser PDF).
   */
  if (!assinaturaConfere("application/pdf", bytes)) {
    console.warn(
      `[proposta] «${ficheiro.name}» diz ser PDF e o conteúdo não começa por %PDF- — recusada.`,
    );
    return { ok: false, erro: mensagemConteudo(ficheiro.name) };
  }

  const hash = createHash("sha256").update(bytes).digest("hex");

  /*
   * Substitui em vez de acumular (D52): o passo 7 mostra **a** proposta, no
   * singular. A anterior fica em soft delete, para retenção e rastreio.
   */
  await base
    .update(documento)
    .set({ apagadoEm: new Date() })
    .where(
      and(
        eq(documento.processoId, processo.id),
        eq(documento.tipo, "proposta_comercial"),
        isNull(documento.apagadoEm),
      ),
    );

  const [linha] = await base
    .insert(documento)
    .values({
      processoId: processo.id,
      tipo: "proposta_comercial",
      nomeOriginal: ficheiro.name.slice(0, 200),
      mime: "application/pdf",
      tamanhoBytes: ficheiro.size,
      hashSha256: hash,
      chaveStorage: `processos/${processo.id}/${hash}`,
      dados: bytes.toString("base64"),
      // Ao contrário dos anexos do cliente, este tem autor — alguém da
      // sociedade, com sessão iniciada.
      carregadoPor: eu.id,
    })
    .returning({ id: documento.id, nome: documento.nomeOriginal });

  const h = await headers();
  await registarEvento({
    organizacaoId: processo.organizacaoId,
    processoId: processo.id,
    atorId: eu.id,
    acao: "proposta.carregada",
    entidade: "documento",
    entidadeId: linha.id,
    valorNovo: { nome: linha.nome, bytes: ficheiro.size, hash },
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
  });

  revalidatePath(`/processos/${processo.id}`);

  return { ok: true, id: linha.id, nome: linha.nome, bytes: ficheiro.size };
}
