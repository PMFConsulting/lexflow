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
 * O email do domínio da própria sociedade — o whitelabel a sério.
 *
 * Quem contrata com o cliente é a sociedade, e o endereço de onde o pedido de
 * dados sai é dela, não da plataforma. Enquanto houve uma instalação com uma
 * sociedade só, o `EMAIL_REMETENTE` do ambiente bastava; com duas, o cliente da
 * segunda recebe um pedido de documentos de identificação assinado com o
 * domínio da primeira — e não responder é a reação certa dele.
 *
 * Três regras atravessam este ficheiro:
 *
 * 1. **Só o `super_admin`.** Configurar de que endereço uma sociedade escreve é
 *    uma decisão de plataforma: um `society_admin` que a pudesse tomar podia
 *    apontar o remetente da sociedade dele para um domínio que controlasse, e
 *    passar a escrever a clientes de KYC com a aparência da plataforma. O guard
 *    é a primeira linha de cada ação e não do layout — um Server Action é um
 *    endereço alcançável a partir do browser.
 *
 * 2. **A chave nunca sai daqui.** `env().RESEND_API_KEY` entra no header
 *    `Authorization` e em mais lado nenhum: não vai para o `console`, não vai
 *    para a auditoria, e o corpo de erro da Resend que é devolvido ao ecrã é o
 *    dela, não o nosso pedido.
 *
 * 3. **O que fica gravado é o que a Resend disse**, e não o que quisemos que
 *    ela dissesse. `dominio_estado` é um espelho do `status` dela; nenhuma
 *    destas funções escreve `verified` por sua conta. Um estado inventado aqui
 *    era a plataforma a garantir SPF/DKIM que não existem, e o preço disso
 *    aparece semanas depois na caixa de spam de um cliente.
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
  /**
   * Os registos vêm da Resend a cada chamada e **não** são guardados.
   *
   * Guardá-los era manter uma cópia de uma coisa que só ela sabe: os valores de
   * DKIM mudam quando ela os roda, e uma tabela nossa com os antigos mandava
   * alguém colar no DNS registos que já não verificam nada — com a agravante de
   * parecerem confirmados por estarem gravados. Quem precisa deles pede-os, e
   * é o botão «Confirmar verificação» que os traz outra vez.
   */
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

/**
 * Regista sem nunca interromper a ação — mesma regra da D46 e do resto deste
 * portal: a partir do momento em que a escrita passou, uma falha da auditoria
 * não a pode desfazer nem esconder.
 */
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

/**
 * Uma chamada à API da Resend, com o erro já em português e sem a chave em lado
 * nenhum.
 *
 * O corpo do erro dela viaja intacto para o ecrã de propósito: «domain already
 * exists» e «invalid domain name» resolvem-se em sítios diferentes, e resumir
 * as duas a «não foi possível» é o que faz uma configuração de DNS demorar uma
 * tarde em vez de um minuto (D43, aplicada aqui).
 */
async function chamarResend(
  caminho: string,
  opcoes: { metodo: "GET" | "POST"; corpo?: unknown },
): Promise<{ ok: true; dados: RespostaResend } | { ok: false; erro: string }> {
  let chave: string | undefined;
  try {
    chave = env().RESEND_API_KEY;
  } catch (e) {
    // `env()` valida o ambiente inteiro e rebenta por causa de qualquer
    // variável — a mesma armadilha da D42. Aqui isso não pode passar a ser uma
    // falha do botão sem explicação.
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

/**
 * O domínio já existente na conta, procurado pelo nome.
 *
 * Existe por causa do caso mais provável de todos: alguém carrega em «Criar
 * domínio» duas vezes, ou o domínio já lá estava de outra instalação. A Resend
 * responde 422 e **não devolve o `id`** — sem esta procura, o botão ficava
 * permanentemente a dizer «já existe» e não havia forma nenhuma, pela interface,
 * de chegar ao domínio que já lá está.
 */
async function dominioExistente(nome: string): Promise<RespostaResend | null> {
  const r = await chamarResend("/domains", { metodo: "GET" });
  if (!r.ok) return null;

  const lista = (r.dados as { data?: RespostaResend[] }).data;
  if (!Array.isArray(lista)) return null;

  return lista.find((d) => d.name?.toLowerCase() === nome) ?? null;
}

/* ------------------------------------------------------------------- remetente */

/**
 * Grava o endereço `From` da sociedade — ou apaga-o, e ela volta ao global.
 *
 * O endereço é guardado **mesmo antes de o domínio estar verificado**. É a
 * escolha certa: quem configura precisa de ver no ecrã o endereço de que a
 * sociedade vai escrever, e escondê-lo até à verificação tirava a única forma
 * de confirmar que não há uma letra trocada. O preço, se o domínio ainda não
 * verificar, é um 403 da Resend com o remetente à frente — que é uma mensagem
 * que se resolve na primeira leitura.
 */
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

  /**
   * O remetente tem de ser do domínio que está a ser verificado.
   *
   * Não é arrumação: é o domínio que carrega o SPF e o DKIM, e um `From` de
   * outro lado é exatamente o envio que a Resend recusa com 403 — só que a
   * recusa aparece dias depois, no primeiro processo aberto, e não aqui. A
   * ordem certa é verificar o domínio e só então escrever o endereço; quem
   * estiver a mudar de domínio apaga o remetente primeiro.
   */
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
 * Cria o domínio na Resend e devolve os registos de DNS a colar.
 *
 * O que sai daqui para o ecrã são SPF (TXT), MX e DKIM (CNAME) — sem eles o
 * domínio nunca passa de `pending`, e é a única parte deste processo que a
 * plataforma não pode fazer sozinha: a zona de DNS é do cliente.
 *
 * O `dominio_resend_id` é gravado **antes** de qualquer verificação. É ele que
 * permite voltar a perguntar o estado mais tarde; sem ele, um domínio criado com
 * sucesso e uma página fechada a seguir ficava criado na Resend e invisível
 * aqui, e a única saída era criá-lo outra vez — que é o 422 que a função
 * seguinte existe para desarmar.
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

  // O simétrico do guard de `guardarRemetente`: o par (remetente, domínio) só
  // vale como um par. Trocar o domínio por baixo de um remetente que ficou do
  // anterior era deixar a sociedade a apontar para SPF/DKIM que não são dela.
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
        // Um domínio novo não herda a verificação do anterior. Deixar a data lá
        // era o ecrã a dizer «verificado a 12/08» sobre um domínio criado hoje.
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
 * Pergunta à Resend em que estado está o domínio e grava a resposta.
 *
 * Antes do `GET` vai um `POST /domains/{id}/verify`, e o falhanço dele é
 * ignorado de propósito: é o pedido para ela **ir ver o DNS agora**. Sem essa
 * linha, o botão limitava-se a reler um estado que a Resend só reavalia por sua
 * iniciativa — e quem acabou de colar os registos ficava a carregar num botão
 * que dizia `pending` sem nada por trás a acontecer.
 *
 * O que se grava é o `status` dela e mais nada. `dominio_verificado_em` é
 * escrito uma vez só, na primeira vez que ela diz `verified`: é a data em que a
 * verificação passou, e reescrevê-la a cada consulta transformava-a na data da
 * última consulta, que não responde a pergunta nenhuma.
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

  // Best-effort: o resultado não é lido, e não é distração. O que interessa é o
  // `GET` a seguir; um `verify` recusado (domínio já verificado, limite de
  // tentativas) não é motivo para não perguntar o estado.
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

  // Só a transição interessa à auditoria. Sem esta condição, cada carregada no
  // botão deixava uma linha igual à anterior num registo que dura sete anos.
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
