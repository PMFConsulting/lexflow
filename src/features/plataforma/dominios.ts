"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { organizacao } from "@/db/schema/organizacao";
import { registarEvento } from "@/features/auditoria/registar";
import { env } from "@/env";
import { exigirSuperAdmin } from "@/lib/sessao";
import { dominioSchema, erros, remetenteSchema } from "./schemas";

/**
 * Email do domínio da própria sociedade — o whitelabel a sério. Com duas
 * sociedades, `EMAIL_REMETENTE` global assinaria pedidos de dados da segunda
 * com o domínio da primeira.
 *
 * Três regras atravessam o ficheiro: só `super_admin` decide de que endereço
 * uma sociedade escreve; a chave da Resend nunca sai de `chamarResend`; e o
 * que fica gravado é o que a Resend disse, nunca o que se quis que dissesse —
 * `dominio_estado` é espelho do `status` dela, nenhuma função escreve
 * `verified` por conta própria.
 */

/** Mesmo limite do canal de envio: um pedido que passa disto já falhou. */
const TEMPO_LIMITE_MS = 15_000;

/** Um registo de DNS a colar na zona do domínio. */
export type RegistoDns = {
  /** `TXT`, `MX`, `CNAME`. */
  tipo: string;
  /** O nome do registo (`send`, `resend._domainkey`, `@`…). */
  nome: string;
  valor: string;
  ttl: string | null;
  prioridade: number | null;
  /** O que a Resend já vê deste registo em particular. */
  estado: string | null;
};

export type EstadoDominio = {
  dominioEmail: string | null;
  dominioResendId: string | null;
  dominioEstado: string | null;
  dominioVerificadoEm: Date | null;
  /** Registos vêm da Resend a cada chamada, nunca guardados — DKIM roda, e uma cópia nossa mandaria colar registos já inválidos. */
  registos: RegistoDns[];
};

export type ResultadoDominio =
  | { ok: true; estado: EstadoDominio }
  | { ok: false; erros: Record<string, string> };

export type ResultadoRemetente =
  | { ok: true; emailRemetente: string | null }
  | { ok: false; erros: Record<string, string> };

/* ------------------------------------------------------------------ contexto */

async function ambiente() {
  const cabecalhos = await headers();
  return {
    ip: cabecalhos.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: cabecalhos.get("user-agent"),
  };
}

/** Regista sem nunca interromper a ação (D46). */
async function auditar(entrada: Parameters<typeof registarEvento>[0]) {
  try {
    await registarEvento(entrada);
  } catch (e) {
    console.error(`[plataforma] falha a registar ${entrada.acao}:`, e);
  }
}

async function sociedadeViva(id: string) {
  const [linha] = await db()
    .select()
    .from(organizacao)
    .where(and(eq(organizacao.id, id), isNull(organizacao.apagadoEm)))
    .limit(1);
  return linha ?? null;
}

/** O domínio de um endereço, ou `null` se não houver um utilizável. */
function dominioDe(endereco: string | null): string | null {
  const parte = endereco?.split("@")[1]?.trim().toLowerCase();
  return parte ? parte : null;
}

function revalidar(id: string) {
  revalidatePath("/admin");
  revalidatePath(`/admin/sociedades/${id}`);
}

/* -------------------------------------------------------------------- Resend */

type RespostaResend = {
  id?: string;
  name?: string;
  status?: string;
  records?: {
    record?: string;
    name?: string;
    type?: string;
    ttl?: string;
    status?: string;
    value?: string;
    priority?: number;
  }[];
};

/** Chamada à API da Resend, erro em português, chave nunca exposta. Corpo do erro da Resend viaja intacto — resumir tudo a "não foi possível" custa uma tarde de DNS (D43). */
async function chamarResend(
  caminho: string,
  opcoes: { metodo: "GET" | "POST"; corpo?: unknown },
): Promise<{ ok: true; dados: RespostaResend } | { ok: false; erro: string }> {
  let chave: string | undefined;
  try {
    chave = env().RESEND_API_KEY;
  } catch (e) {
    // env() valida o ambiente inteiro e rebenta por qualquer variável (D42) —
    // não pode virar falha de botão sem explicação.
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }

  if (!chave) {
    return {
      ok: false,
      erro:
        "RESEND_API_KEY não está no ambiente do servidor — sem ela não há como criar nem verificar domínios.",
    };
  }

  try {
    const resposta = await fetch(`https://api.resend.com${caminho}`, {
      method: opcoes.metodo,
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      headers: {
        Authorization: `Bearer ${chave}`,
        ...(opcoes.corpo === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(opcoes.corpo === undefined ? {} : { body: JSON.stringify(opcoes.corpo) }),
    });

    if (!resposta.ok) {
      const corpo = await resposta.text();
      return { ok: false, erro: `A Resend devolveu ${resposta.status}: ${corpo.slice(0, 500)}` };
    }

    return { ok: true, dados: (await resposta.json()) as RespostaResend };
  } catch (erro) {
    if (erro instanceof Error && erro.name === "TimeoutError") {
      return {
        ok: false,
        erro: `A api.resend.com não respondeu em ${TEMPO_LIMITE_MS / 1000}s — verifique a saída para a Internet do servidor.`,
      };
    }
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}

/** Os registos de DNS, na forma que a tabela do ecrã lê. */
function registosDe(dados: RespostaResend): RegistoDns[] {
  return (dados.records ?? []).map((r) => ({
    tipo: (r.type ?? "").toUpperCase(),
    // `record` é o rótulo da Resend (`SPF`, `DKIM`); `name` é o nome a colar.
    nome: r.name ?? "",
    valor: r.value ?? "",
    ttl: r.ttl ?? null,
    prioridade: typeof r.priority === "number" ? r.priority : null,
    estado: r.status ?? null,
  }));
}

/** Domínio já existente na conta, procurado pelo nome — a Resend responde 422 sem devolver o id, e sem esta procura o botão ficava trancado em "já existe". */
async function dominioExistente(nome: string): Promise<RespostaResend | null> {
  const r = await chamarResend("/domains", { metodo: "GET" });
  if (!r.ok) return null;

  const lista = (r.dados as { data?: RespostaResend[] }).data;
  if (!Array.isArray(lista)) return null;

  return lista.find((d) => d.name?.toLowerCase() === nome) ?? null;
}

/* ------------------------------------------------------------------- remetente */

/** Grava (ou apaga) o `From` da sociedade — mesmo antes do domínio verificar, para o ecrã mostrar o endereço real; o preço é um 403 resolvido à primeira leitura. */
export async function guardarRemetente(
  organizacaoId: string,
  emailRemetente: string,
): Promise<ResultadoRemetente> {
  const { eu } = await exigirSuperAdmin();

  const lido = remetenteSchema.safeParse({ emailRemetente });
  if (!lido.success) return { ok: false, erros: erros(lido) };

  const novo = lido.data.emailRemetente;

  const antes = await sociedadeViva(organizacaoId);
  if (!antes) return { ok: false, erros: { _: "Esta sociedade já não existe." } };

  // Remetente tem de ser do domínio em verificação — um From de outro
  // domínio é o 403 que a Resend recusa, só que dias depois, no primeiro
  // processo aberto.
  const doDominio = dominioDe(novo);
  if (novo && antes.dominioEmail && doDominio !== antes.dominioEmail) {
    return {
      ok: false,
      erros: {
        emailRemetente: `O domínio de envio desta sociedade é ${antes.dominioEmail}. Use um endereço @${antes.dominioEmail} ou troque primeiro o domínio.`,
      },
    };
  }

  try {
    await db()
      .update(organizacao)
      .set({ emailRemetente: novo, atualizadoEm: new Date() })
      .where(eq(organizacao.id, organizacaoId));
  } catch (e) {
    console.error("[plataforma] falhou a gravar o remetente da sociedade:", e);
    return { ok: false, erros: { _: "Não foi possível gravar. Tente de novo." } };
  }

  const { ip, userAgent } = await ambiente();

  await auditar({
    organizacaoId,
    atorId: eu.id,
    acao: "sociedade.remetente_alterado",
    entidade: "organizacao",
    entidadeId: organizacaoId,
    valorAnterior: { emailRemetente: antes.emailRemetente },
    valorNovo: { emailRemetente: novo },
    ip,
    userAgent,
  });

  revalidar(organizacaoId);
  return { ok: true, emailRemetente: novo };
}

/* --------------------------------------------------------------------- domínio */

/**
 * Cria o domínio na Resend e devolve os registos de DNS a colar (SPF, MX,
 * DKIM) — a zona de DNS é do cliente, a plataforma não pode fazer isto
 * sozinha. `dominio_resend_id` gravado antes de qualquer verificação, senão
 * um domínio criado com sucesso e a página fechada a seguir fica invisível aqui.
 */
export async function iniciarVerificacaoDominio(
  organizacaoId: string,
  dominio: string,
): Promise<ResultadoDominio> {
  const { eu } = await exigirSuperAdmin();

  const lido = dominioSchema.safeParse({ dominioEmail: dominio });
  if (!lido.success) return { ok: false, erros: erros(lido) };

  const nome = lido.data.dominioEmail;

  const antes = await sociedadeViva(organizacaoId);
  if (!antes) return { ok: false, erros: { _: "Esta sociedade já não existe." } };

  // Simétrico do guard de guardarRemetente — o par (remetente, domínio) só
  // vale junto.
  const doRemetente = dominioDe(antes.emailRemetente);
  if (doRemetente && doRemetente !== nome) {
    return {
      ok: false,
      erros: {
        dominioEmail: `O remetente desta sociedade é ${antes.emailRemetente}. Apague-o ou mude-o para @${nome} antes de trocar o domínio.`,
      },
    };
  }

  let dados: RespostaResend;
  const criacao = await chamarResend("/domains", { metodo: "POST", corpo: { name: nome } });

  if (criacao.ok) {
    dados = criacao.dados;
  } else {
    // Já existe na conta? Então o que falta é adotá-lo, não recriá-lo.
    const existente = await dominioExistente(nome);
    if (!existente?.id) return { ok: false, erros: { dominioEmail: criacao.erro } };
    console.info(`[plataforma] domínio ${nome} já existia na Resend — adotado (${existente.id}).`);
    dados = existente;
  }

  if (!dados.id) {
    return {
      ok: false,
      erros: {
        dominioEmail:
          "A Resend aceitou o domínio mas não devolveu o identificador dele — sem esse identificador não há como confirmar a verificação. Tente de novo.",
      },
    };
  }

  const estadoResend = dados.status ?? "pending";

  try {
    await db()
      .update(organizacao)
      .set({
        dominioEmail: nome,
        dominioResendId: dados.id,
        dominioEstado: estadoResend,
        // Domínio novo não herda a verificação do anterior.
        dominioVerificadoEm: estadoResend === "verified" ? new Date() : null,
        atualizadoEm: new Date(),
      })
      .where(eq(organizacao.id, organizacaoId));
  } catch (e) {
    console.error("[plataforma] domínio criado na Resend e não gravado:", e);
    return {
      ok: false,
      erros: {
        _: `O domínio ${nome} foi criado na Resend (${dados.id}) mas não ficou gravado nesta sociedade. Tente de novo — ele será readotado.`,
      },
    };
  }

  const { ip, userAgent } = await ambiente();

  await auditar({
    organizacaoId,
    atorId: eu.id,
    acao: "sociedade.dominio_iniciado",
    entidade: "organizacao",
    entidadeId: organizacaoId,
    valorAnterior: { dominioEmail: antes.dominioEmail, dominioEstado: antes.dominioEstado },
    valorNovo: { dominioEmail: nome, dominioResendId: dados.id, dominioEstado: estadoResend },
    ip,
    userAgent,
  });

  revalidar(organizacaoId);

  return {
    ok: true,
    estado: {
      dominioEmail: nome,
      dominioResendId: dados.id,
      dominioEstado: estadoResend,
      dominioVerificadoEm: estadoResend === "verified" ? new Date() : null,
      registos: registosDe(dados),
    },
  };
}

/**
 * Pergunta à Resend o estado do domínio e grava a resposta. `POST /verify`
 * antes do `GET`, falhanço ignorado — é o pedido para ela ir ver o DNS agora.
 * `dominio_verificado_em` só se escreve na primeira vez que diz `verified`.
 */
export async function confirmarVerificacao(organizacaoId: string): Promise<ResultadoDominio> {
  const { eu } = await exigirSuperAdmin();

  const antes = await sociedadeViva(organizacaoId);
  if (!antes) return { ok: false, erros: { _: "Esta sociedade já não existe." } };

  if (!antes.dominioResendId) {
    return {
      ok: false,
      erros: { _: "Esta sociedade ainda não tem domínio criado na Resend." },
    };
  }

  const id = encodeURIComponent(antes.dominioResendId);

  // Best-effort: resultado não é lido, o que interessa é o GET a seguir.
  await chamarResend(`/domains/${id}/verify`, { metodo: "POST" });

  const consulta = await chamarResend(`/domains/${id}`, { metodo: "GET" });
  if (!consulta.ok) return { ok: false, erros: { _: consulta.erro } };

  const estadoResend = consulta.dados.status ?? antes.dominioEstado ?? "pending";
  const verificadoEm =
    estadoResend === "verified" ? (antes.dominioVerificadoEm ?? new Date()) : null;

  try {
    await db()
      .update(organizacao)
      .set({
        dominioEstado: estadoResend,
        dominioVerificadoEm: verificadoEm,
        atualizadoEm: new Date(),
      })
      .where(eq(organizacao.id, organizacaoId));
  } catch (e) {
    console.error("[plataforma] falhou a gravar o estado do domínio:", e);
    return { ok: false, erros: { _: "Não foi possível gravar o estado. Tente de novo." } };
  }

  // Só a transição interessa à auditoria — senão cada clique repete a linha
  // anterior num registo de sete anos.
  if (estadoResend !== antes.dominioEstado) {
    const { ip, userAgent } = await ambiente();
    await auditar({
      organizacaoId,
      atorId: eu.id,
      acao: "sociedade.dominio_verificado",
      entidade: "organizacao",
      entidadeId: organizacaoId,
      valorAnterior: { dominioEstado: antes.dominioEstado },
      valorNovo: { dominioEmail: antes.dominioEmail, dominioEstado: estadoResend },
      ip,
      userAgent,
    });
  }

  revalidar(organizacaoId);

  return {
    ok: true,
    estado: {
      dominioEmail: antes.dominioEmail,
      dominioResendId: antes.dominioResendId,
      dominioEstado: estadoResend,
      dominioVerificadoEm: verificadoEm,
      registos: registosDe(consulta.dados),
    },
  };
}
