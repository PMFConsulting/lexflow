"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { documentoOrganizacao } from "@/db/schema/sociedade";
import { registarEvento } from "@/features/auditoria/registar";
import {
  assinaturaConfere,
  MENSAGEM_FORMATO,
  mensagemConteudo,
  mimeAceite,
} from "@/features/onboarding/formatos";
import { acessoConvitePorToken, motivoDoAcessoConvite } from "./dados";

/**
 * Upload dos documentos de quem se está a registar.
 *
 * As regras de formato, tamanho e magic bytes vêm do mesmo `formatos.ts` do
 * percurso do cliente — um ficheiro que diz ser PDF e não é é o mesmo problema
 * em qualquer percurso, e ter duas listas de formatos aceites foi o defeito da
 * D39.
 *
 * A diferença que importa está no `convite_id`: estes documentos pertencem a
 * uma **pessoa**, não à sociedade. Sem essa coluna preenchida, o cartão de
 * cidadão de um advogado ficava a pertencer à sociedade inteira e aparecia na
 * lista de documentos dela.
 */

const MAX_BYTES = 4 * 1024 * 1024;

/** Os tipos que uma pessoa da equipa pode escolher. Allowlist, não `String(...)`. */
const TIPOS_DA_PESSOA = ["identificacao", "cedula_profissional", "outro"] as const;

const tipoDaPessoa = z.enum(TIPOS_DA_PESSOA);

export type ResultadoUploadConvite =
  | { ok: true; id: string; nome: string }
  | { ok: false; erro: string };

export async function carregarDocumentoConvite(
  bruto: string,
  formData: FormData,
): Promise<ResultadoUploadConvite> {
  const acesso = await acessoConvitePorToken(bruto);
  if (acesso.estado !== "ok") {
    const { titulo, descricao } = motivoDoAcessoConvite(acesso);
    return { ok: false, erro: `${titulo} ${descricao}` };
  }

  const { convite, org, token } = acesso;

  const analiseTipo = tipoDaPessoa.safeParse(String(formData.get("tipo") ?? "outro"));
  if (!analiseTipo.success) {
    return { ok: false, erro: "Escolha uma categoria de documento da lista." };
  }
  const tipo = analiseTipo.data;

  const ficheiro = formData.get("ficheiro");
  if (!(ficheiro instanceof File) || ficheiro.size === 0) {
    return { ok: false, erro: "Escolha um ficheiro." };
  }
  if (ficheiro.size > MAX_BYTES) {
    const mb = (ficheiro.size / 1024 / 1024).toFixed(1);
    return { ok: false, erro: `O ficheiro tem ${mb} MB. O máximo são 4 MB.` };
  }

  const mime = mimeAceite(ficheiro.name, ficheiro.type);
  if (!mime) return { ok: false, erro: MENSAGEM_FORMATO };

  const bytes = Buffer.from(await ficheiro.arrayBuffer());
  if (!assinaturaConfere(mime, bytes)) {
    console.warn(
      `[documento-convite] ${convite.email}: «${ficheiro.name}» declara ${mime} e o conteúdo não bate — recusado.`,
    );
    return { ok: false, erro: mensagemConteudo(ficheiro.name) };
  }

  const hash = createHash("sha256").update(bytes).digest("hex");
  const base = db();

  const [jaExiste] = await base
    .select({ id: documentoOrganizacao.id })
    .from(documentoOrganizacao)
    .where(
      and(
        eq(documentoOrganizacao.conviteId, convite.id),
        eq(documentoOrganizacao.hashSha256, hash),
        isNull(documentoOrganizacao.apagadoEm),
      ),
    )
    .limit(1);

  if (jaExiste) return { ok: false, erro: "Este ficheiro já foi carregado." };

  const [linha] = await base
    .insert(documentoOrganizacao)
    .values({
      organizacaoId: org.id,
      conviteId: convite.id,
      tipo,
      nomeOriginal: ficheiro.name.slice(0, 200),
      mime,
      tamanhoBytes: ficheiro.size,
      hashSha256: hash,
      chaveStorage: `equipa/${org.id}/${convite.id}/${hash}`,
      dados: bytes.toString("base64"),
    })
    .returning({ id: documentoOrganizacao.id, nome: documentoOrganizacao.nomeOriginal });

  const h = await headers();
  await registarEvento({
    organizacaoId: org.id,
    acao: "utilizador.documento.carregado",
    entidade: "documento_organizacao",
    entidadeId: linha.id,
    valorNovo: { tipo, email: convite.email, bytes: ficheiro.size, hash },
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
  }).catch((e) =>
    console.error("[documento-convite] audit write failed", { erro: String(e) }),
  );

  revalidatePath(`/convite/${token}`, "layout");
  return { ok: true, id: linha.id, nome: linha.nome };
}

/** Remoção: soft delete, porque a lei manda reter. */
export async function removerDocumentoConvite(bruto: string, id: string) {
  const acesso = await acessoConvitePorToken(bruto);
  if (acesso.estado !== "ok") {
    const { titulo, descricao } = motivoDoAcessoConvite(acesso);
    return { ok: false as const, erro: `${titulo} ${descricao}` };
  }

  const { convite, org, token } = acesso;
  const base = db();

  const [alvo] = await base
    .select()
    .from(documentoOrganizacao)
    .where(
      and(
        eq(documentoOrganizacao.id, id),
        eq(documentoOrganizacao.conviteId, convite.id),
      ),
    )
    .limit(1);

  if (!alvo) return { ok: false as const, erro: "Documento não encontrado." };

  await base
    .update(documentoOrganizacao)
    .set({ apagadoEm: new Date() })
    .where(eq(documentoOrganizacao.id, id));

  const h = await headers();
  await registarEvento({
    organizacaoId: org.id,
    acao: "utilizador.documento.removido",
    entidade: "documento_organizacao",
    entidadeId: id,
    valorAnterior: { nome: alvo.nomeOriginal, tipo: alvo.tipo, email: convite.email },
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
  }).catch((e) =>
    console.error("[documento-convite] audit write failed", { erro: String(e) }),
  );

  revalidatePath(`/convite/${token}`, "layout");
  return { ok: true as const };
}
