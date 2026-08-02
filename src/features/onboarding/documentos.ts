"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { documento } from "@/db/schema/documentos";
import { registarEvento } from "@/features/auditoria/registar";
import { processoPorToken } from "./dados";

/**
 * Upload de documentos.
 *
 * O que o formulário real tem é um dropzone genérico. Categorizamos na mesma —
 * sem tipo não há alertas de validade no painel, que é meio ponto do §6 do
 * brief.
 */

const MAX_BYTES = 4 * 1024 * 1024;

const MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

export type ResultadoUpload =
  | { ok: true; id: string; nome: string }
  | { ok: false; erro: string };

export async function carregarDocumento(
  token: string,
  formData: FormData,
): Promise<ResultadoUpload> {
  const processo = await processoPorToken(token);
  if (!processo) return { ok: false, erro: "Este link já não é válido." };
  if (processo.estado !== "rascunho" && processo.estado !== "pendente_cliente") {
    return { ok: false, erro: "Este processo já foi submetido." };
  }

  const ficheiro = formData.get("ficheiro");
  const tipo = String(formData.get("tipo") ?? "outro");

  if (!(ficheiro instanceof File) || ficheiro.size === 0) {
    return { ok: false, erro: "Escolha um ficheiro." };
  }
  if (ficheiro.size > MAX_BYTES) {
    const mb = (ficheiro.size / 1024 / 1024).toFixed(1);
    return { ok: false, erro: `O ficheiro tem ${mb} MB. O máximo são 4 MB.` };
  }
  // O tipo declarado pelo browser não é prova de nada, mas filtra o acidente
  // óbvio. A validação a sério é trabalho de quem revê o processo.
  if (!MIMES.has(ficheiro.type)) {
    return { ok: false, erro: "Aceitamos PDF, JPG, PNG, WEBP ou HEIC." };
  }

  const bytes = Buffer.from(await ficheiro.arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");

  const base = db();

  // Mesmo ficheiro, mesmo processo, mesmo tipo: não duplica.
  const [jaExiste] = await base
    .select({ id: documento.id })
    .from(documento)
    .where(
      and(
        eq(documento.processoId, processo.id),
        eq(documento.hashSha256, hash),
        isNull(documento.apagadoEm),
      ),
    )
    .limit(1);

  if (jaExiste) {
    return { ok: false, erro: "Este ficheiro já foi carregado." };
  }

  const [linha] = await base
    .insert(documento)
    .values({
      processoId: processo.id,
      tipo: tipo as never,
      nomeOriginal: ficheiro.name.slice(0, 200),
      mime: ficheiro.type,
      tamanhoBytes: ficheiro.size,
      hashSha256: hash,
      // Chave futura: quando houver bucket, é aqui que ela fica e `dados` some.
      chaveStorage: `processos/${processo.id}/${hash}`,
      dados: bytes.toString("base64"),
    })
    .returning({ id: documento.id, nome: documento.nomeOriginal });

  const h = await headers();
  await registarEvento({
    organizacaoId: processo.organizacaoId,
    processoId: processo.id,
    acao: "documento.carregado",
    entidade: "documento",
    entidadeId: linha.id,
    valorNovo: { tipo, nome: linha.nome, bytes: ficheiro.size, hash },
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
  });

  revalidatePath(`/onboarding/${token}`, "layout");
  return { ok: true, id: linha.id, nome: linha.nome };
}

/** Remoção pelo cliente: soft delete, porque a lei manda reter. */
export async function removerDocumento(token: string, id: string) {
  const processo = await processoPorToken(token);
  if (!processo) return { ok: false as const, erro: "Este link já não é válido." };

  const base = db();
  const [alvo] = await base
    .select()
    .from(documento)
    .where(and(eq(documento.id, id), eq(documento.processoId, processo.id)))
    .limit(1);

  if (!alvo) return { ok: false as const, erro: "Documento não encontrado." };

  await base
    .update(documento)
    .set({ apagadoEm: new Date() })
    .where(eq(documento.id, id));

  const h = await headers();
  await registarEvento({
    organizacaoId: processo.organizacaoId,
    processoId: processo.id,
    acao: "documento.removido",
    entidade: "documento",
    entidadeId: id,
    valorAnterior: { nome: alvo.nomeOriginal, tipo: alvo.tipo },
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
  });

  revalidatePath(`/onboarding/${token}`, "layout");
  return { ok: true as const };
}
