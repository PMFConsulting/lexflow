"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { documento } from "@/db/schema/documentos";
import { registarEvento } from "@/features/auditoria/registar";
import { destinoDaOrganizacao } from "@/lib/storage";
import { mensagemSegura } from "@/lib/storage/sanitizacao";
import { chaveObjeto, nomeSeguroDeFicheiro } from "@/lib/storage/tipos";
import { acessoPorToken, motivoDoAcesso } from "./dados";
import { assinaturaConfere, MENSAGEM_FORMATO, mensagemConteudo, mimeAceite } from "./formatos";

/**
 * Upload de documentos. O formulário real usa um dropzone genérico;
 * categorizamos aqui porque sem tipo não há alertas de validade no painel
 * (§6 do brief).
 */

const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Os tipos que o **cliente** pode escolher.
 *
 * Antes era `String(formData.get("tipo") ?? "outro")` com `as never` por
 * cima — sem allowlist, TypeScript calado à força, e um valor fora do enum
 * dava 500 do Postgres. Pior ainda: dentro do enum mas fora desta lista havia
 * `proposta_comercial` (documento que a sociedade anexa, D52, e que o passo 7
 * mostra como proposta a aceitar) — um cliente podia carregar um ficheiro
 * com esse tipo e passar a "aceitar" uma proposta escrita por ele próprio.
 * Mesmo risco para `termos_sociedade` e `dossier_assinado`.
 */
const TIPOS_DO_CLIENTE = [
  "identificacao",
  "comprovativo_nif",
  "certidao_permanente",
  "procuracao",
  "ata_designacao",
  "comprovativo_rcbe",
  "outro",
] as const;

type TipoDoCliente = (typeof TIPOS_DO_CLIENTE)[number];

const tipoDoCliente = z.enum(TIPOS_DO_CLIENTE);

export type ResultadoUpload =
  | { ok: true; id: string; nome: string }
  | { ok: false; erro: string };

export async function carregarDocumento(
  bruto: string,
  formData: FormData,
): Promise<ResultadoUpload> {
  const acesso = await acessoPorToken(bruto);
  if (acesso.estado !== "ok") {
    const { titulo, descricao } = motivoDoAcesso(acesso);
    return { ok: false, erro: `${titulo} ${descricao}` };
  }

  const { processo, token } = acesso;
  if (
    processo.estado !== "rascunho" &&
    processo.estado !== "pendente_cliente" &&
    processo.estado !== "em_revisao"
  ) {
    return { ok: false, erro: "Este processo já foi submetido." };
  }

  const ficheiro = formData.get("ficheiro");

  const analiseTipo = tipoDoCliente.safeParse(String(formData.get("tipo") ?? "outro"));
  if (!analiseTipo.success) {
    return { ok: false, erro: "Escolha uma categoria de documento da lista." };
  }
  const tipo: TipoDoCliente = analiseTipo.data;

  if (!(ficheiro instanceof File) || ficheiro.size === 0) {
    return { ok: false, erro: "Escolha um ficheiro." };
  }
  if (ficheiro.size > MAX_BYTES) {
    const mb = (ficheiro.size / 1024 / 1024).toFixed(1);
    return { ok: false, erro: `O ficheiro tem ${mb} MB. O máximo são 4 MB.` };
  }
  // Tipo declarado pelo browser filtra o acidente óbvio, não prova nada — a
  // validação a sério é de quem revê o processo. Sem tipo declarado (HEIC no
  // Chrome, automação) vale a extensão. Ver `formatos.ts`.
  const mime = mimeAceite(ficheiro.name, ficheiro.type);
  if (!mime) {
    return { ok: false, erro: MENSAGEM_FORMATO };
  }

  const bytes = Buffer.from(await ficheiro.arrayBuffer());

  // Nome e MIME vêm do cliente; os bytes são a única coisa que ele não
  // escolheu — ver `assinaturaConfere`.
  if (!assinaturaConfere(mime, bytes)) {
    console.warn(
      `[documento] ${processo.referencia}: assinatura de "${ficheiro.name}" não corresponde a ${mime} — recusado.`,
    );
    return { ok: false, erro: mensagemConteudo(ficheiro.name) };
  }

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
        eq(documento.tipo, tipo),
        isNull(documento.apagadoEm),
      ),
    )
    .limit(1);

  if (jaExiste) {
    return { ok: false, erro: "Este ficheiro já foi carregado." };
  }

  /*
   * Nenhum documento vive na base de dados — instrução do dono, verbatim:
   * "No documents have to be in the database. No documents, everything in
   * its own S3." Isso só é possível quando a sociedade já tem o bucket S3
   * ativo (D65): sem destino, não há para onde o ficheiro ir.
   *
   * Decisão: sem S3 ativo, o upload é recusado — não cai para `dados` como
   * antes. Gravar na base de dados "só desta vez" era exatamente o desvio
   * que a instrução do dono proíbe, e o carregamento de documentos já é um
   * portão obrigatório do passo 2 (D56): recusar aqui não é diferente, em
   * espécie, de recusar um ficheiro com o formato errado.
   *
   * A chave grava-se em `Sistema/processos/<processoId>/…` — "Sistema" e não
   * "Clientes", porque esta é a cópia técnica de que a própria tabela
   * `documento` depende (via `chaveStorage`); a cópia legível por humanos,
   * dentro da pasta do cliente, é escrita à parte por `sincronizar.ts` na
   * submissão, a partir desta mesma cópia — nunca as duas mãos escrevendo o
   * mesmo ficheiro em paralelo.
   */
  const ligacao = await destinoDaOrganizacao(processo.organizacaoId);
  if (!ligacao || !ligacao.config.bucketS3) {
    return {
      ok: false,
      erro:
        "O armazenamento desta sociedade ainda não está pronto para receber documentos. " +
        "Contacte o administrador.",
    };
  }

  const nomeObjeto = `${hash}-${nomeSeguroDeFicheiro(ficheiro.name)}`;
  const segmentos = ["Sistema", "processos", processo.id];
  const chave = chaveObjeto([...segmentos, nomeObjeto]);

  try {
    await ligacao.destino.enviar(segmentos, { nome: nomeObjeto, mime, conteudo: bytes });
  } catch (e) {
    console.error(
      `[documento] ${processo.referencia}: envio de "${ficheiro.name}" para o armazenamento falhou`,
      mensagemSegura(e),
    );
    return { ok: false, erro: "Não foi possível guardar o ficheiro. Tente novamente." };
  }

  const [linha] = await base
    .insert(documento)
    .values({
      processoId: processo.id,
      tipo,
      nomeOriginal: ficheiro.name.slice(0, 200),
      mime,
      tamanhoBytes: ficheiro.size,
      hashSha256: hash,
      chaveStorage: chave,
      dados: null,
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
export async function removerDocumento(bruto: string, id: string) {
  const acesso = await acessoPorToken(bruto);
  if (acesso.estado !== "ok") {
    const { titulo, descricao } = motivoDoAcesso(acesso);
    return { ok: false as const, erro: `${titulo} ${descricao}` };
  }

  const { processo, token } = acesso;
  if (
    processo.estado !== "rascunho" &&
    processo.estado !== "pendente_cliente" &&
    processo.estado !== "em_revisao"
  ) {
    return { ok: false as const, erro: "Este processo já foi submetido." };
  }

  const base = db();
  const [alvo] = await base
    .select()
    .from(documento)
    .where(and(eq(documento.id, id), eq(documento.processoId, processo.id)))
    .limit(1);

  if (!alvo) return { ok: false as const, erro: "Documento não encontrado." };

  if (!(TIPOS_DO_CLIENTE as readonly string[]).includes(alvo.tipo)) {
    return {
      ok: false as const,
      erro: "Não tem permissão para remover este tipo de documento.",
    };
  }

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
