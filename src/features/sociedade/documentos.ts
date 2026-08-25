"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { organizacao } from "@/db/schema/organizacao";
import { documentoOrganizacao } from "@/db/schema/sociedade";
import { registarEvento } from "@/features/auditoria/registar";
import {
  assinaturaConfere,
  MENSAGEM_FORMATO,
  mensagemConteudo,
  mimeAceite,
} from "@/features/onboarding/formatos";
import { acessoSociedadePorToken, motivoDoAcessoSociedade } from "./dados";

/**
 * Upload de documentos da sociedade, durante o seu próprio onboarding.
 *
 * As regras de formato, tamanho e magic bytes são as mesmas do percurso do
 * cliente e vêm do mesmo `formatos.ts` — um PDF que se chama PDF e não é PDF é
 * o mesmo problema aqui e ali, e ter duas listas de formatos aceites foi
 * exatamente o defeito da D39.
 */

const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Os tipos que a **sociedade** pode escolher no seu registo.
 *
 * Allowlist e não `String(formData.get("tipo"))`: um valor fora do enum é um
 * 500 vindo do Postgres a partir de um campo de formulário, e um valor dentro
 * do enum mas fora do que faz sentido aqui é pior — `identificacao` e
 * `cedula_profissional` são documentos de uma **pessoa**, e um deles gravado
 * sem `convite_id` ficava a pertencer à sociedade inteira.
 */
const TIPOS_DA_SOCIEDADE = ["certidao_sociedade", "termos_sociedade", "outro"] as const;

const tipoDaSociedade = z.enum(TIPOS_DA_SOCIEDADE);

export type ResultadoUploadSociedade =
  | { ok: true; id: string; nome: string }
  | { ok: false; erro: string };

export async function carregarDocumentoSociedade(
  bruto: string,
  formData: FormData,
): Promise<ResultadoUploadSociedade> {
  const acesso = await acessoSociedadePorToken(bruto);
  if (acesso.estado !== "ok") {
    const { titulo, descricao } = motivoDoAcessoSociedade(acesso);
    return { ok: false, erro: `${titulo} ${descricao}` };
  }

  const { org, token } = acesso;

  const analiseTipo = tipoDaSociedade.safeParse(String(formData.get("tipo") ?? "outro"));
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

  /*
   * Os T&C só em PDF.
   *
   * É o documento que vai ser servido a cada cliente no passo 7 e a cada pessoa
   * da equipa no registo dela, e uma fotografia de um contrato não é um
   * contrato legível. `mimeAceite` aceita imagens porque um cartão de cidadão
   * fotografado é o caso normal do percurso do cliente; aqui não é.
   */
  if (tipo === "termos_sociedade" && mime !== "application/pdf") {
    return {
      ok: false,
      erro: `«${ficheiro.name}» não é um PDF. Os Termos e Condições têm de ser um PDF — é o documento que vai ser apresentado aos vossos clientes.`,
    };
  }

  const bytes = Buffer.from(await ficheiro.arrayBuffer());

  // O nome e o MIME vêm os dois do browser. Os primeiros bytes vêm do ficheiro,
  // e são a única coisa aqui que quem carrega não escolheu.
  if (!assinaturaConfere(mime, bytes)) {
    console.warn(
      `[documento-org] ${org.nome}: «${ficheiro.name}» declara ${mime} e o conteúdo não bate — recusado.`,
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
        eq(documentoOrganizacao.organizacaoId, org.id),
        eq(documentoOrganizacao.hashSha256, hash),
        isNull(documentoOrganizacao.apagadoEm),
      ),
    )
    .limit(1);

  if (jaExiste) return { ok: false, erro: "Este ficheiro já foi carregado." };

  /*
   * Um documento por tipo, e o anterior sai.
   *
   * Mesma regra da proposta comercial (D52) e pela mesma razão: o passo 7 mostra
   * **os** Termos e Condições, no singular, e duas linhas vivas obrigariam a
   * escolher uma por ordenação — que é como um cliente acaba a aceitar o
   * articulado errado sem ninguém dar por isso. O anterior fica em soft delete,
   * porque a versão que alguém aceitou não se apaga (D3).
   */
  await base
    .update(documentoOrganizacao)
    .set({ apagadoEm: new Date() })
    .where(
      and(
        eq(documentoOrganizacao.organizacaoId, org.id),
        eq(documentoOrganizacao.tipo, tipo),
        isNull(documentoOrganizacao.conviteId),
        isNull(documentoOrganizacao.apagadoEm),
      ),
    );

  const [linha] = await base
    .insert(documentoOrganizacao)
    .values({
      organizacaoId: org.id,
      tipo,
      nomeOriginal: ficheiro.name.slice(0, 200),
      mime,
      tamanhoBytes: ficheiro.size,
      hashSha256: hash,
      chaveStorage: `sociedades/${org.id}/${hash}`,
      dados: bytes.toString("base64"),
    })
    .returning({ id: documentoOrganizacao.id, nome: documentoOrganizacao.nomeOriginal });

  const h = await headers();
  await registarEvento({
    organizacaoId: org.id,
    acao: "sociedade.documento.carregado",
    entidade: "documento_organizacao",
    entidadeId: linha.id,
    valorNovo: { tipo, nome: linha.nome, bytes: ficheiro.size, hash },
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
  }).catch((e) =>
    console.error("[documento-org] audit write failed", { erro: String(e) }),
  );

  revalidatePath(`/sociedade/${token}`, "layout");
  return { ok: true, id: linha.id, nome: linha.nome };
}

/** Remoção: soft delete, porque a lei manda reter. */
export async function removerDocumentoSociedade(bruto: string, id: string) {
  const acesso = await acessoSociedadePorToken(bruto);
  if (acesso.estado !== "ok") {
    const { titulo, descricao } = motivoDoAcessoSociedade(acesso);
    return { ok: false as const, erro: `${titulo} ${descricao}` };
  }

  const { org, token } = acesso;
  const base = db();

  const [alvo] = await base
    .select()
    .from(documentoOrganizacao)
    .where(
      and(
        eq(documentoOrganizacao.id, id),
        eq(documentoOrganizacao.organizacaoId, org.id),
        isNull(documentoOrganizacao.conviteId),
      ),
    )
    .limit(1);

  if (!alvo) return { ok: false as const, erro: "Documento não encontrado." };

  await base
    .update(documentoOrganizacao)
    .set({ apagadoEm: new Date() })
    .where(eq(documentoOrganizacao.id, id));

  /*
   * Remover o PDF dos T&C limpa também o ponteiro da organização.
   *
   * Sem isto, `termos_documento_ref` fica a apontar para uma linha apagada e o
   * `termosEmVigor` recua para o texto da plataforma — o que está certo — mas o
   * passo 4 continuava a dar-se por preenchido, porque a coluna não é nula.
   * A sociedade submetia convencida de que tinha entregado o articulado.
   */
  if (org.termosDocumentoRef === id) {
    await base
      .update(organizacao)
      .set({ termosDocumentoRef: null, termosVersao: null, termosAtualizadoEm: null })
      .where(eq(organizacao.id, org.id));
  }

  const h = await headers();
  await registarEvento({
    organizacaoId: org.id,
    acao: "sociedade.documento.removido",
    entidade: "documento_organizacao",
    entidadeId: id,
    valorAnterior: { nome: alvo.nomeOriginal, tipo: alvo.tipo },
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
  }).catch((e) =>
    console.error("[documento-org] audit write failed", { erro: String(e) }),
  );

  revalidatePath(`/sociedade/${token}`, "layout");
  return { ok: true as const };
}
