"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { documento } from "@/db/schema/documentos";
import { registarEvento } from "@/features/auditoria/registar";
import { acessoPorToken, motivoDoAcesso } from "./dados";
import { assinaturaConfere, MENSAGEM_FORMATO, mensagemConteudo, mimeAceite } from "./formatos";

/**
 * Upload de documentos.
 *
 * O que o formulário real tem é um dropzone genérico. Categorizamos na mesma —
 * sem tipo não há alertas de validade no painel, que é meio ponto do §6 do
 * brief.
 */

const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Os tipos que o **cliente** pode escolher.
 *
 * O que aqui estava era um `String(formData.get("tipo") ?? "outro")` a entrar no
 * INSERT com um `as never` por cima — ou seja, sem allowlist nenhuma e com o
 * TypeScript calado à força. Um valor fora do enum era um 500 vindo do Postgres
 * a partir de um campo de formulário; e um valor *dentro* do enum mas fora do
 * que o cliente devia poder escrever era pior: `proposta_comercial` é o
 * documento que a **sociedade** anexa (D52) e que o passo 7 lhe mostra como a
 * proposta a aceitar. Um cliente que carregasse um ficheiro com esse tipo
 * passava a ler, e a aceitar, uma proposta escrita por ele próprio. O mesmo
 * vale para `termos_sociedade` e `dossier_assinado`, que a plataforma produz.
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
  if (processo.estado !== "rascunho" && processo.estado !== "pendente_cliente") {
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
  // O tipo declarado pelo browser não é prova de nada, mas filtra o acidente
  // óbvio. A validação a sério é trabalho de quem revê o processo. Quando o
  // browser não declara tipo nenhum — HEIC no Chrome, ficheiros vindos de
  // automação — vale a extensão, senão recusávamos formatos que o próprio
  // `accept` do campo anuncia. Ver `formatos.ts`.
  const mime = mimeAceite(ficheiro.name, ficheiro.type);
  if (!mime) {
    return { ok: false, erro: MENSAGEM_FORMATO };
  }

  const bytes = Buffer.from(await ficheiro.arrayBuffer());

  // O nome e o MIME vêm os dois do cliente. Os primeiros bytes vêm do ficheiro,
  // e são a única coisa aqui que ele não escolheu — ver `assinaturaConfere`.
  if (!assinaturaConfere(mime, bytes)) {
    console.warn(
      `[documento] ${processo.referencia}: «${ficheiro.name}» declara ${mime} e o conteúdo não bate — recusado.`,
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
      tipo,
      nomeOriginal: ficheiro.name.slice(0, 200),
      mime,
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
export async function removerDocumento(bruto: string, id: string) {
  const acesso = await acessoPorToken(bruto);
  if (acesso.estado !== "ok") {
    const { titulo, descricao } = motivoDoAcesso(acesso);
    return { ok: false as const, erro: `${titulo} ${descricao}` };
  }

  const { processo, token } = acesso;
  if (processo.estado !== "rascunho" && processo.estado !== "pendente_cliente") {
    return { ok: false as const, erro: "Este processo já foi submetido." };
  }

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
