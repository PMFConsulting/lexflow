"use server";

import { headers } from "next/headers";
import { exigirSocietyAdmin } from "@/lib/sessao";
import { registarEvento } from "@/features/auditoria/registar";
import {
  documentosDoProcesso,
  processoPorId,
  propostaDoProcesso,
} from "./consultas";
import {
  assinaturaDoProcesso,
  seccoesDoProcesso,
} from "@/features/onboarding/dados";
import { gerarDossierPdf } from "./pdf-dossier";

export type ResultadoExportarPdf =
  | {
      ok: true;
      pdfBase64: string;
      nomeFicheiro: string;
    }
  | {
      ok: false;
      erro: string;
    };

/**
 * Exporta o dossiê completo do processo em PDF com todas as secções de dados
 * e a listagem de anexos por nome.
 * Ação reservada exclusivamente a utilizadores com papel `society_admin`.
 */
export async function exportarProcessoPdf(processoId: string): Promise<ResultadoExportarPdf> {
  const { eu } = await exigirSocietyAdmin();

  const processo = await processoPorId(processoId);
  if (!processo || processo.organizacaoId !== eu.organizacaoId) {
    return { ok: false, erro: "Processo não encontrado." };
  }

  const [seccoes, docs, assinatura, proposta] = await Promise.all([
    seccoesDoProcesso(processo.id),
    documentosDoProcesso(processo.id),
    assinaturaDoProcesso(processo.id),
    propostaDoProcesso(processo.id),
  ]);

  const pdfBuffer = await gerarDossierPdf({
    processo: {
      id: processo.id,
      referencia: processo.referencia,
      tipoCliente: processo.tipoCliente,
      nomeCliente: processo.nomeCliente,
      nifCliente: processo.nifCliente,
      emailCliente: processo.emailCliente,
      estado: processo.estado,
      responsavel: processo.responsavel,
      submetidoEm: processo.submetidoEm,
      atualizadoEm: processo.atualizadoEm,
      criadoEm: processo.criadoEm,
    },
    seccoes,
    documentos: docs.map((d) => ({ nome: d.nome, tipo: d.tipo, bytes: d.bytes })),
    assinatura,
    proposta: proposta ? { nome: proposta.nome, bytes: proposta.bytes } : null,
  });

  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    userAgent = h.get("user-agent") ?? null;
  } catch {
    // headers outside request context
  }

  await registarEvento({
    organizacaoId: processo.organizacaoId,
    processoId: processo.id,
    atorId: eu.id,
    acao: "processo.exportado_pdf",
    entidade: "processo_onboarding",
    entidadeId: processo.id,
    valorNovo: { referencia: processo.referencia },
    ip,
    userAgent,
  });

  return {
    ok: true,
    pdfBase64: pdfBuffer.toString("base64"),
    nomeFicheiro: `dossier-${processo.referencia}.pdf`,
  };
}
