"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import { db } from "@/db";
import { emailModelo } from "@/db/schema/email";
import { registarEvento } from "@/features/auditoria/registar";
import { TEMPLATES_EDITAVEIS, type TemplateEditavel } from "@/lib/emails/personalizacao";
import { exigirSocietyAdmin } from "@/lib/sessao";

async function contexto() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
  };
}

const esquemaGuardarModelo = z.object({
  template: z.enum(TEMPLATES_EDITAVEIS, {
    message: "Template de email inválido ou não editável.",
  }),
  assunto: z
    .string()
    .trim()
    .min(1, "O assunto do email é obrigatório.")
    .max(300, "O assunto não pode exceder 300 caracteres."),
  corpoHtml: z
    .string()
    .trim()
    .min(1, "O corpo do email é obrigatório.")
    .max(50000, "O corpo do email não pode exceder 50.000 caracteres."),
});

export type ResultadoGuardarModelo =
  | { ok: true; template: TemplateEditavel }
  | { ok: false; erros?: Record<string, string[]>; mensagem?: string };

/**
 * Guarda ou atualiza a personalização de um modelo de email da sociedade.
 * Apenas acessível pelo administrador da sociedade (society_admin).
 */
export async function guardarModeloEmail(dados: unknown): Promise<ResultadoGuardarModelo> {
  const { eu } = await exigirSocietyAdmin();

  const r = esquemaGuardarModelo.safeParse(dados);
  if (!r.success) {
    const erros: Record<string, string[]> = {};
    for (const problema of r.error.issues) {
      const campo = problema.path.join(".") || "_";
      (erros[campo] ??= []).push(problema.message);
    }
    return { ok: false, erros, mensagem: "Por favor corrija os campos assinalados." };
  }

  const { template, assunto, corpoHtml } = r.data;
  const base = db();

  const [anterior] = await base
    .select()
    .from(emailModelo)
    .where(
      and(
        eq(emailModelo.organizacaoId, eu.organizacaoId),
        eq(emailModelo.template, template),
      ),
    )
    .limit(1);

  let linhaId: string;

  if (anterior) {
    linhaId = anterior.id;
    await base
      .update(emailModelo)
      .set({
        assunto,
        corpoHtml,
        atualizadoEm: new Date(),
        atualizadoPor: eu.id,
      })
      .where(eq(emailModelo.id, anterior.id));
  } else {
    linhaId = uuidv7();
    await base.insert(emailModelo).values({
      id: linhaId,
      organizacaoId: eu.organizacaoId,
      template,
      assunto,
      corpoHtml,
      atualizadoEm: new Date(),
      atualizadoPor: eu.id,
    });
  }

  try {
    const { ip, userAgent } = await contexto();
    await registarEvento({
      organizacaoId: eu.organizacaoId,
      atorId: eu.id,
      acao: "email_modelo.atualizado",
      entidade: "email_modelo",
      entidadeId: linhaId,
      valorAnterior: anterior
        ? { assunto: anterior.assunto, corpoHtml: anterior.corpoHtml }
        : null,
      valorNovo: { template, assunto, corpoHtml },
      ip,
      userAgent,
    });
  } catch (e) {
    console.error("[email_modelo] Falha ao registar auditoria", e);
  }

  revalidatePath("/configuracao/emails");
  return { ok: true, template };
}

const esquemaReverterModelo = z.object({
  template: z.enum(TEMPLATES_EDITAVEIS, {
    message: "Template de email inválido ou não editável.",
  }),
});

export type ResultadoReverterModelo =
  | { ok: true; template: TemplateEditavel }
  | { ok: false; mensagem: string };

/**
 * Reverte a personalização de um template de email para os valores padrão de sistema.
 * Elimina a linha correspondente em email_modelo e regista na auditoria.
 */
export async function reverterModeloEmail(dados: unknown): Promise<ResultadoReverterModelo> {
  const { eu } = await exigirSocietyAdmin();

  const r = esquemaReverterModelo.safeParse(dados);
  if (!r.success) {
    return { ok: false, mensagem: "Template inválido." };
  }

  const { template } = r.data;
  const base = db();

  const [anterior] = await base
    .select()
    .from(emailModelo)
    .where(
      and(
        eq(emailModelo.organizacaoId, eu.organizacaoId),
        eq(emailModelo.template, template),
      ),
    )
    .limit(1);

  if (!anterior) {
    // Já está em padrão
    return { ok: true, template };
  }

  await base.delete(emailModelo).where(eq(emailModelo.id, anterior.id));

  try {
    const { ip, userAgent } = await contexto();
    await registarEvento({
      organizacaoId: eu.organizacaoId,
      atorId: eu.id,
      acao: "email_modelo.revertido",
      entidade: "email_modelo",
      entidadeId: anterior.id,
      valorAnterior: {
        template: anterior.template,
        assunto: anterior.assunto,
        corpoHtml: anterior.corpoHtml,
      },
      valorNovo: null,
      ip,
      userAgent,
    });
  } catch (e) {
    console.error("[email_modelo] Falha ao registar auditoria de reversão", e);
  }

  revalidatePath("/configuracao/emails");
  return { ok: true, template };
}
