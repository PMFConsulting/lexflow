import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { consentimento, versaoTextoLegal } from "@/db/schema/legal";
import type { finalidadeConsentimento } from "@/db/schema/enums";

type Finalidade = (typeof finalidadeConsentimento.enumValues)[number];

/**
 * Consentimentos com prova.
 *
 * O que interessa daqui a quatro anos não é um booleano: é conseguir mostrar o
 * texto exato que a pessoa viu, quando o aceitou e de que endereço. É por isso
 * que cada consentimento aponta para uma versão de texto imutável em vez de
 * guardar só "sim".
 *
 * Só entram aqui as finalidades que são mesmo consentimento. Prestação do
 * serviço e obrigações legais têm outra base legal e pedir consentimento para
 * elas seria inválido — ver a divergência D2 e a ambiguidade A11 em
 * docs/CAMPOS.md.
 */

/** Textos por omissão, criados à primeira utilização se ainda não existirem. */
const TEXTOS: Record<string, { chave: string; versao: string; conteudo: string }> = {
  newsletter: {
    chave: "rgpd.newsletter",
    versao: "2026-07-31.1",
    conteudo:
      "Autorizo a PMF Consulting a enviar-me comunicações informativas e newsletters para os endereços de email que indiquei. Posso retirar esta autorização a qualquer momento.",
  },
  convites_iniciativas: {
    chave: "rgpd.convites",
    versao: "2026-08-02.1",
    conteudo:
      "Autorizo a PMF Consulting a convidar-me para iniciativas — formações, webinars, workshops e outros eventos — através dos contactos que indiquei. Posso retirar esta autorização a qualquer momento.",
  },
  declaracao_veracidade: {
    chave: "declaracao_veracidade",
    versao: "2026-07-31.1",
    conteudo:
      "Declaro que as informações prestadas são verdadeiras e assumo a responsabilidade pela sua atualização caso se verifiquem alterações.",
  },
};

/** A versão em vigor de um texto. Cria-a se ainda não existir. */
async function textoEmVigor(finalidade: Finalidade) {
  const base = db();
  const modelo = TEXTOS[finalidade];
  if (!modelo) return null;

  const [existente] = await base
    .select()
    .from(versaoTextoLegal)
    .where(eq(versaoTextoLegal.chave, modelo.chave))
    .orderBy(desc(versaoTextoLegal.vigenteDesde))
    .limit(1);

  if (existente) return existente;

  const [criado] = await base
    .insert(versaoTextoLegal)
    .values({
      chave: modelo.chave,
      versao: modelo.versao,
      conteudo: modelo.conteudo,
      hash: createHash("sha256").update(modelo.conteudo, "utf8").digest("hex"),
    })
    .onConflictDoNothing({ target: [versaoTextoLegal.chave, versaoTextoLegal.versao] })
    .returning();

  if (criado) return criado;

  const [depois] = await base
    .select()
    .from(versaoTextoLegal)
    .where(eq(versaoTextoLegal.chave, modelo.chave))
    .orderBy(desc(versaoTextoLegal.vigenteDesde))
    .limit(1);

  return depois ?? null;
}

/**
 * Grava um consentimento — ou a sua retirada.
 *
 * Retirar não apaga: marca `revogado_em` na linha existente e grava uma nova
 * com `aceite = false`. O histórico é a prova, e apagá-lo destruiria
 * exatamente aquilo que a lei manda conseguir demonstrar.
 */
export async function registarConsentimento(opts: {
  processoId: string;
  finalidade: Finalidade;
  aceite: boolean;
  ip: string | null;
  userAgent: string | null;
}) {
  const base = db();
  const texto = await textoEmVigor(opts.finalidade);
  if (!texto) return;

  const [anterior] = await base
    .select()
    .from(consentimento)
    .where(
      and(
        eq(consentimento.processoId, opts.processoId),
        eq(consentimento.finalidade, opts.finalidade),
        eq(consentimento.textoLegalId, texto.id),
      ),
    )
    .limit(1);

  // Sem mudança de resposta, não há nada a registar: repetir a mesma linha a
  // cada gravação do passo só enche o histórico de ruído.
  if (anterior && anterior.aceite === opts.aceite && !anterior.revogadoEm) return;

  if (anterior && anterior.aceite && !opts.aceite) {
    await base
      .update(consentimento)
      .set({ revogadoEm: new Date() })
      .where(eq(consentimento.id, anterior.id));
  }

  await base
    .insert(consentimento)
    .values({
      processoId: opts.processoId,
      finalidade: opts.finalidade,
      textoLegalId: texto.id,
      aceite: opts.aceite,
      aceiteEm: new Date(),
      ip: opts.ip ?? "desconhecido",
      userAgent: opts.userAgent ?? "desconhecido",
    })
    .onConflictDoUpdate({
      target: [consentimento.processoId, consentimento.finalidade, consentimento.textoLegalId],
      set: {
        aceite: opts.aceite,
        aceiteEm: new Date(),
        ip: opts.ip ?? "desconhecido",
        userAgent: opts.userAgent ?? "desconhecido",
        revogadoEm: null,
      },
    });
}

/** O texto em vigor, para o mostrar ao lado da caixa que se está a aceitar. */
export async function textoParaMostrar(finalidade: Finalidade) {
  const t = await textoEmVigor(finalidade);
  return t?.conteudo ?? TEXTOS[finalidade]?.conteudo ?? "";
}
