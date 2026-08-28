import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
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
    versao: "2026-08-08.1",
    conteudo:
      "Autorizo a JMASSANO — Escritório de Advogado a enviar-me comunicações informativas e newsletters para os endereços de email que indiquei. Posso retirar esta autorização a qualquer momento.",
  },
  convites_iniciativas: {
    chave: "rgpd.convites",
    versao: "2026-08-08.1",
    conteudo:
      "Autorizo a JMASSANO — Escritório de Advogado a convidar-me para iniciativas — formações, webinars, workshops e outros eventos — através dos contactos que indiquei. Posso retirar esta autorização a qualquer momento.",
  },
  declaracao_veracidade: {
    chave: "declaracao_veracidade",
    versao: "2026-07-31.1",
    conteudo:
      "Declaro que as informações prestadas são verdadeiras e assumo a responsabilidade pela sua atualização caso se verifiquem alterações.",
  },
};

/**
 * A versão em vigor de um texto — a que este código declara. Cria-a se ainda
 * não existir.
 *
 * A procura é por **chave e versão**, e não pela mais recente da chave. Assim
 * não estava: bastava existir uma linha da chave para ela ser devolvida para
 * sempre, e mudar o texto aqui não tinha efeito nenhuma numa instalação já a
 * correr — o cliente continuava a consentir o articulado antigo enquanto o
 * ecrã lhe mostrava o novo. Com a procura pela versão exata, subir a `versao`
 * cria uma linha nova e os consentimentos anteriores continuam a apontar para
 * o texto que quem os deu viu de facto, que é o que a D3 pede.
 */
async function textoEmVigor(finalidade: Finalidade) {
  const base = db();
  const modelo = TEXTOS[finalidade];
  if (!modelo) return null;

  const daVersao = () =>
    base
      .select()
      .from(versaoTextoLegal)
      .where(
        and(
          eq(versaoTextoLegal.chave, modelo.chave),
          eq(versaoTextoLegal.versao, modelo.versao),
        ),
      )
      .limit(1);

  const [existente] = await daVersao();
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

  // Corrida com outro pedido a criar a mesma linha: ela existe agora.
  const [depois] = await daVersao();
  if (depois) return depois;

  // Rede de segurança — a linha da chave que houver, para não deixar o passo 6
  // por gravar só porque o texto legal não resolveu.
  const [qualquer] = await base
    .select()
    .from(versaoTextoLegal)
    .where(eq(versaoTextoLegal.chave, modelo.chave))
    .orderBy(desc(versaoTextoLegal.vigenteDesde))
    .limit(1);

  return qualquer ?? null;
}

/**
 * Grava um consentimento — ou a sua retirada.
 *
 * Retirar não apaga: marca `revogado_em` na linha existente.
 * Uma nova concessão após revogação cria uma LINHA NOVA, preservando
 * a linha revogada como prova inalterável no histórico.
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

  const [anteriorAtivo] = await base
    .select()
    .from(consentimento)
    .where(
      and(
        eq(consentimento.processoId, opts.processoId),
        eq(consentimento.finalidade, opts.finalidade),
        eq(consentimento.textoLegalId, texto.id),
        isNull(consentimento.revogadoEm),
      ),
    )
    .orderBy(desc(consentimento.aceiteEm))
    .limit(1);

  if (opts.aceite) {
    if (anteriorAtivo && anteriorAtivo.aceite) return;

    await base.insert(consentimento).values({
      processoId: opts.processoId,
      finalidade: opts.finalidade,
      textoLegalId: texto.id,
      aceite: true,
      aceiteEm: new Date(),
      ip: opts.ip ?? "desconhecido",
      userAgent: opts.userAgent ?? "desconhecido",
      revogadoEm: null,
    });
  } else {
    if (anteriorAtivo && anteriorAtivo.aceite) {
      await base
        .update(consentimento)
        .set({ revogadoEm: new Date() })
        .where(eq(consentimento.id, anteriorAtivo.id));
    }
  }
}
