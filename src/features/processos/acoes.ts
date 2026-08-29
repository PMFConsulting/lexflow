"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { contadorReferencia, organizacao } from "@/db/schema/organizacao";
import { processoOnboarding } from "@/db/schema/processo";
import {
  areaInteresse,
  dadosFaturacao,
  dadosFiscais,
  dadosIdentificacao,
  declaracaoPpe,
  emailNewsletter,
  fechoProposta,
  nacionalidade,
  preferenciasContacto,
  relacaoNegocio,
  representanteLegal,
} from "@/db/schema/seccoes";
import { registarEvento } from "@/features/auditoria/registar";
import { acessoPorToken } from "@/features/onboarding/dados";
import { nifFaturacao } from "@/features/onboarding/schemas";
import { email as emailSchema } from "@/lib/campos";
import { enviarEmail } from "@/lib/email";
import { enviarBoasVindas } from "@/lib/emails/boas-vindas";
import {
  ASSUNTO_REGISTO,
  ASSUNTO_REJEICAO,
  emailRegisto,
  emailRejeicao,
} from "@/lib/emails/jmassano";
import { urlLogotipoSociedade } from "@/lib/emails/moldura";
import { resolverEmailCliente } from "@/lib/emails/obter-modelo";
import { origemPublica } from "@/lib/origem";
import {
  exigirEquipaOuSuperAdmin,
  podeAcederSociedade,
  podeAprovarProcesso,
  podeReabrirProcesso,
  podeReenviarLinkProcesso,
} from "@/lib/sessao";
import { expiraDaquiA, novoTokenAcesso } from "@/lib/token";
import { validarNif, validarNipc, validarTelefone } from "@/lib/validacao-pt";
import {
  novoProcesso,
  reaberturaProcessoSchema,
  type NovoProcesso,
} from "./schemas";

/** Mesma forma em todas as saídas por erro — o `campo` fica sempre no tipo. */
const falha = (erro: string, campo?: string) => ({ ok: false as const, erro, campo });

/** O nome da restrição que um 23505 violou, venha ele em que campo vier. */
function restricaoViolada(erro: unknown): string {
  const e = erro as { constraint_name?: string; constraint?: string; message?: string };
  return e.constraint_name ?? e.constraint ?? e.message ?? "";
}

/**
 * Cria um processo e devolve o link mágico.
 *
 * Token em claro só existe nesta chamada; a BD guarda o hash (D4). Dados de
 * abertura (nome/NIPC/email) ficam gravados no processo — obrigatórios em
 * pessoa coletiva, para identificar a entidade antes do passo 1.
 *
 * Exige sessão (D59): sem isto, o identificador da ação bastava para abrir
 * processos e disparar emails de registo para qualquer endereço.
 *
 * A partir do INSERT não rejeita (D46): cada passo corre no seu try, para uma
 * falha de auditoria não derrubar o email nem o link já gravado.
 */
export async function criarProcesso(entrada: NovoProcesso & { organizacaoId?: string }) {
  // Primeira instrução da ação, antes do safeParse — uma carga rejeitada pelo
  // schema também fica registada. Regista a forma (chaves), não os valores:
  // "string:particular" em vez de "{tipoCliente,nome,email}" indica um
  // separador antigo a chamar a ação com a assinatura anterior.
  const bruto: unknown = entrada;
  const forma =
    typeof bruto === "object" && bruto !== null
      ? `{${Object.keys(bruto).join(",")}}`
      : `${typeof bruto}:${String(bruto)}`;
  console.info(`[processo] pedido de criação recebido — carga=${forma}`);

  // Sessão antes de qualquer trabalho e antes de qualquer email — mesma regra
  // do `guardarPasso` do onboarding. Sem isto, o identificador da ação (que
  // viaja no HTML de qualquer página do back-office) bastava para abrir
  // processos e disparar o email de registo para qualquer endereço.
  const { eu } = await exigirEquipaOuSuperAdmin();

  // Validação do cliente é conforto, não garantia — decide-se aqui.
  const analise = novoProcesso.safeParse(entrada);
  if (!analise.success) {
    const problema = analise.error.issues[0];
    // O campo aponta o erro à caixa certa em vez de um aviso genérico no
    // fundo da janela.
    return falha(
      problema?.message ?? "Dados inválidos.",
      typeof problema?.path[0] === "string" ? problema.path[0] : undefined,
    );
  }

  const { tipoCliente, nome, email } = analise.data;
  const nif = analise.data.tipoCliente === "empresa" ? analise.data.nif : undefined;
  const emailCliente = email?.toLowerCase();

  console.info(
    `[processo] carga aceite pelo schema tipo=${tipoCliente} email=${emailCliente ?? "(nenhum)"}`,
  );

  const base = db();

  // Organização de quem está autenticado (equipa da sociedade) ou a indicada
  // na entrada (super_admin transversal).
  const orgId =
    eu.papel === "super_admin"
      ? (entrada.organizacaoId ?? eu.organizacaoId)
      : eu.organizacaoId;

  if (!orgId) {
    return falha("Escolha a sociedade onde criar o processo.", "organizacaoId");
  }

  const [org] = await base
    .select()
    .from(organizacao)
    .where(eq(organizacao.id, orgId))
    .limit(1);
  if (!org) {
    return falha("Não há organização criada. Corra `pnpm db:seed`.");
  }

  const ano = new Date().getFullYear();

  // Sequencial atómico: um UPDATE ... RETURNING não deixa dois processos
  // apanharem o mesmo número, ao contrário de um SELECT max()+1.
  await base
    .insert(contadorReferencia)
    .values({ organizacaoId: org.id, ano, ultimo: 0 })
    .onConflictDoNothing({ target: [contadorReferencia.organizacaoId, contadorReferencia.ano] });

  // Token e hash saem da mesma chamada, não de duas linhas separadas —
  // divergir dava um processo real cujo link a consulta por hash nunca
  // encontra: o cliente carrega no email e leva com "não existe".
  const { token, hash } = novoTokenAcesso();
  const expiraEm = expiraDaquiA(30);

  let processo: typeof processoOnboarding.$inferSelect | undefined;
  let referencia = "";

  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    const [contador] = await base
      .update(contadorReferencia)
      .set({ ultimo: sql`${contadorReferencia.ultimo} + 1` })
      .where(
        and(eq(contadorReferencia.organizacaoId, org.id), eq(contadorReferencia.ano, ano)),
      )
      .returning({ ultimo: contadorReferencia.ultimo });

    referencia = `${org.prefixoReferencia}-${ano}-${String(contador.ultimo).padStart(4, "0")}`;

    try {
      [processo] = await base
        .insert(processoOnboarding)
        .values({
          organizacaoId: org.id,
          referencia,
          tipoCliente,
          nomeCliente: nome ?? null,
          nifCliente: nif ?? null,
          emailCliente: emailCliente ?? null,
          tokenAcessoHash: hash,
          expiraEm,
        })
        .returning();
      break;
    } catch (erro) {
      if ((erro as { code?: string }).code !== "23505") throw erro;

      /*
       * Duas restrições únicas, tratamento diferente. `processo_referencia_org`
       * é colisão esperada (dois pedidos em simultâneo) — tira-se outro número
       * e repete-se. `processo_token` significa que já existe uma linha gravada
       * com este token (o INSERT anterior confirmou e a resposta perdeu-se);
       * repetir nunca resolve, por isso recupera-se a linha pelo mesmo caminho
       * que o cliente usa.
       */
      if (restricaoViolada(erro).includes("processo_token")) {
        const recuperado = await acessoPorToken(token);
        if (recuperado.estado === "ok") {
          console.warn(
            `[processo] o INSERT colidiu no token; recuperada a linha ${recuperado.processo.referencia}`,
          );
          processo = recuperado.processo;
          referencia = recuperado.processo.referencia;
          break;
        }
        return falha("Não foi possível criar o processo. Tente novamente.");
      }

      if (tentativa >= 5) {
        return falha("Não foi possível criar o processo. Tente novamente.");
      }
    }
  }

  if (!processo) {
    return falha("Não foi possível criar o processo. Tente novamente.");
  }

  /**
   * `processo` é `let` (o ciclo atribui-lhe) e o TypeScript não propaga a
   * garantia de não-undefined para as closures definidas a seguir (`auditar`).
   */
  const dossier = processo;

  /*
   * Daqui para baixo o processo já está gravado — nada pode rebentar. Chegar
   * ao envio de email dependia de três awaits sem rede por baixo (headers,
   * registarEvento, origemPublica); qualquer um a rebentar dava "/emails" a
   * zero sem o enviarEmail ter sido chamado, e a janela dizia "o servidor não
   * respondeu" — um erro de auditoria com cara de erro de email. Regra: cada
   * peça a partir daqui corre no seu próprio try (D46).
   */

  /*
   * O link é testado antes de ser entregue a alguém: token gerado e hash
   * gravado nem sempre resultam num link que abre (schema mudado, trigger,
   * expira_em no passado) — sem este teste o 404 só aparecia do lado do
   * cliente, dias depois. Consulta pela mesma função que serve a página do
   * cliente; se falhar, repõe-se o hash uma vez, e se ainda assim falhar quem
   * criou o processo fica a saber no ecrã. Corre dentro de try como tudo o
   * resto abaixo — não pode ser esta verificação a matar o email do cliente.
   */
  const linkAbre = async () => {
    try {
      return (await acessoPorToken(token)).estado === "ok";
    } catch (erro) {
      console.error(`[processo] ${referencia}: não foi possível verificar o link`, erro);
      return false;
    }
  };

  let linkVerificado = await linkAbre();

  if (!linkVerificado) {
    console.error(
      `[processo] ${referencia}: o token gravado não abre o processo — a repor o hash`,
    );
    try {
      await base
        .update(processoOnboarding)
        .set({ tokenAcessoHash: hash, expiraEm, apagadoEm: null })
        .where(eq(processoOnboarding.id, dossier.id));
      linkVerificado = await linkAbre();
    } catch (erro) {
      console.error(`[processo] ${referencia}: a reposição do token falhou`, erro);
    }
  }

  /** Cabeçalhos do pedido, para a auditoria. Falhar aqui não custa um email. */
  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    userAgent = h.get("user-agent") ?? null;
  } catch (erro) {
    console.error(`[processo] ${referencia}: não foi possível ler os cabeçalhos`, erro);
  }

  /**
   * Evento de auditoria que nunca propaga — a cadeia de hashes continua a ser
   * escrita pelo mesmo `registarEvento`; só a falha a escrevê-la deixa de
   * poder interromper o resto da ação (D46).
   */
  const auditar = async (acao: string, valorNovo: Record<string, unknown>) => {
    try {
      await registarEvento({
        organizacaoId: org.id,
        processoId: dossier.id,
        // Agora sempre com autor: o processo nasce de alguém com sessão.
        atorId: eu.id,
        acao,
        entidade: "processo_onboarding",
        entidadeId: dossier.id,
        valorNovo,
        ip,
        userAgent,
      });
    } catch (erro) {
      console.error(`[processo] ${referencia}: o evento ${acao} não ficou gravado`, erro);
    }
  };

  // Dados de abertura no evento: prova de com que identificação o dossier nasceu.
  await auditar("processo.criado", {
    referencia,
    tipoCliente,
    nome: nome ?? null,
    nif: nif ?? null,
  });

  // Falha de acesso é evento de auditoria, não só uma linha de log — permite
  // descobrir mais tarde, sem consola do contentor à mão.
  if (!linkVerificado) {
    await auditar("link.nao_resolve", { referencia });
  }

  // Link montado uma vez só, no servidor, para os dois destinos (email e
  // janela) — cada um a montar o seu divergia sempre que o back-office fosse
  // acedido por túnel, localhost, IP ou segundo domínio (D48).
  let link = `/onboarding/${token}`;
  try {
    link = `${await origemPublica()}/onboarding/${token}`;
  } catch (erro) {
    // Origem em falta ainda se corrige a olho; a janela completa com a sua própria origem.
    console.error(`[processo] ${referencia}: origemPublica falhou; link relativo`, erro);
  }

  let emailEnviado = false;
  /** O motivo, quando não saiu. Vai para a janela — ver a nota em baixo. */
  let erroEmail: string | undefined;

  if (emailCliente) {
    // enviarEmail já não propaga (D42) e auditar também — este try é o
    // terceiro fecho, para o token em claro não se perder por uma exceção aqui.
    try {
      const r = await enviarEmail({
        para: emailCliente,
        assunto: ASSUNTO_REGISTO,
        html: emailRegisto({ nome, link, logotipoUrl: urlLogotipoSociedade(org) }),
        template: "registo",
        organizacaoId: org.id,
        processoId: dossier.id,
        // Mesmo hash gravado em processo_onboarding.token_acesso_hash — liga
        // o email enviado ao link que a verificação em cima experimentou (D4),
        // sem guardar o token em claro em mais um sítio.
        tokenHash: hash,
      });
      emailEnviado = r.ok;
      if (!r.ok) erroEmail = r.erro;

      // Falha de envio também vai a auditoria: saber que não saiu importa
      // tanto como saber que saiu.
      await auditar(r.ok ? "link.enviado" : "link.envio_falhou", {
        para: emailCliente,
        ...(r.ok ? {} : { erro: r.erro }),
      });
    } catch (erro) {
      emailEnviado = false;
      erroEmail = erro instanceof Error ? erro.message : String(erro);
      console.error(`[processo] ${referencia}: o email de registo rebentou`, erro);
    }
  } else {
    // Processo sem endereço não deixava rasto: nem em email_log (só regista
    // tentativas), nem em evento_auditoria. Este evento dá prova positiva de
    // que não havia endereço, em vez de silêncio (D44).
    console.warn(
      `[processo] ${referencia}: criado sem endereço de email — o email de registo não foi tentado.`,
    );
    await auditar("link.sem_email", { referencia });
  }

  // revalidatePath também não pode impedir o token de chegar à janela.
  try {
    revalidatePath("/");
  } catch (erro) {
    console.error(`[processo] ${referencia}: revalidatePath falhou`, erro);
  }

  return {
    ok: true as const,
    referencia,
    token,
    /** O mesmo texto do email — a janela não monta o seu próprio, senão há dois links e só um funciona. */
    link,
    /** Se o link foi testado com sucesso. A falso, o processo existe mas o link não abre. */
    linkVerificado,
    processoId: dossier.id,
    emailEnviado,
    /** Endereço que o servidor recebeu — distingue "envio falhou" de "nunca chegou cá". */
    paraServidor: emailCliente ?? null,
    // Motivo visível na janela: evita ir aos logs para distinguir domínio por
    // verificar, chave em falta ou saída de rede fechada.
    erroEmail,
  };
}

/* ------------------------------------------------------------- aprovação */

type ResultadoDecisao = { ok: true } | { ok: false; erro: string };

/**
 * Email do cliente para as duas decisões: identificação, com faturação como
 * recurso quando o passo 1 não foi gravado (mesma prioridade de
 * `notificarSubmissao` em `onboarding/acoes.ts`).
 */
async function emailDoCliente(processoId: string) {
  const base = db();
  const [identificacao] = await base
    .select({ email: dadosIdentificacao.email, nome: dadosIdentificacao.nome })
    .from(dadosIdentificacao)
    .where(eq(dadosIdentificacao.processoId, processoId))
    .limit(1);
  const [faturacao] = await base
    .select({ email: dadosFaturacao.email })
    .from(dadosFaturacao)
    .where(eq(dadosFaturacao.processoId, processoId))
    .limit(1);
  return {
    email: identificacao?.email ?? faturacao?.email ?? null,
    nome: identificacao?.nome ?? null,
  };
}

/**
 * Sessão, permissão e estado — as três guardas comuns a aprovar e a rejeitar.
 * Um processo de outra organização responde como inexistente, não com um erro
 * que revele que existe noutra conta (mesma regra do detalhe do processo).
 */
async function processoParaDecisao(
  id: string,
): Promise<
  | { ok: true; processo: typeof processoOnboarding.$inferSelect; atorId: string }
  | { ok: false; erro: string }
> {
  const { eu } = await exigirEquipaOuSuperAdmin();
  if (!podeAprovarProcesso(eu.papel)) {
    return { ok: false, erro: "Não tem permissão para decidir este processo." };
  }

  const [processo] = await db()
    .select()
    .from(processoOnboarding)
    .where(eq(processoOnboarding.id, id))
    .limit(1);

  if (!processo || !podeAcederSociedade(eu, processo.organizacaoId)) {
    return { ok: false, erro: "Processo não encontrado." };
  }
  if (processo.estado !== "aguardar_aprovacao") {
    return { ok: false, erro: "Este processo não está à espera de aprovação." };
  }

  return { ok: true, processo, atorId: eu.id };
}

/**
 * Aprova um processo: muda estado, grava autor/data, envia boas-vindas com os
 * três anexos (`enviarBoasVindas`, partilhada com a submissão). O email corre
 * no seu próprio try — a decisão já está gravada, um Resend em baixo não a desfaz.
 */
export async function aprovarProcesso(id: string): Promise<ResultadoDecisao> {
  const verificacao = await processoParaDecisao(id);
  if (!verificacao.ok) return verificacao;
  const { processo, atorId } = verificacao;

  let atualizado: typeof processoOnboarding.$inferSelect | undefined;

  try {
    atualizado = await db().transaction(async (tx) => {
      // Guarda de estado também no UPDATE, não só no SELECT de
      // processoParaDecisao — entre os dois, outro pedido (dois separadores,
      // um duplo submit) pode ter decidido o mesmo processo.
      const [res] = await tx
        .update(processoOnboarding)
        .set({ estado: "aprovado", aprovadoEm: new Date(), aprovadoPor: atorId })
        .where(
          and(
            eq(processoOnboarding.id, id),
            eq(processoOnboarding.estado, "aguardar_aprovacao"),
          ),
        )
        .returning();

      if (!res) return undefined;

      await registarEvento(
        {
          organizacaoId: processo.organizacaoId,
          processoId: processo.id,
          atorId,
          acao: "processo.aprovado",
          entidade: "processo_onboarding",
          entidadeId: processo.id,
          valorAnterior: { estado: processo.estado },
          valorNovo: { estado: "aprovado" },
        },
        tx,
      );

      return res;
    });
  } catch (e) {
    console.error(`[processo] ${processo.referencia}: falhou a aprovação / auditoria:`, e);
    return { ok: false, erro: "Não foi possível aprovar o processo." };
  }

  if (!atualizado) {
    return { ok: false, erro: "O processo já mudou de estado — recarregue a página." };
  }

  try {
    const { email, nome } = await emailDoCliente(id);
    if (email) {
      await enviarBoasVindas(atualizado, email, nome);
    } else {
      console.warn(
        `[processo] ${processo.referencia}: aprovado sem endereço de email — boas-vindas não enviadas.`,
      );
    }
  } catch (e) {
    console.error(`[processo] ${processo.referencia}: as boas-vindas não foram enviadas`, e);
  }

  revalidatePath("/processos");
  revalidatePath(`/processos/${id}`);
  revalidatePath(`/admin/sociedades/${processo.organizacaoId}/processos/${id}`);
  revalidatePath(`/admin/sociedades/${processo.organizacaoId}`);
  revalidatePath("/admin");
  revalidatePath("/");

  return { ok: true };
}

/**
 * Rejeita um processo: muda o estado, grava o motivo, e avisa o cliente por
 * email. O motivo é obrigatório — uma rejeição sem motivo é uma decisão que
 * ninguém, do lado do cliente, consegue perceber nem contestar.
 */
export async function rejeitarProcesso(id: string, motivoBruto: string): Promise<ResultadoDecisao> {
  const motivo = motivoBruto.trim();
  if (!motivo) {
    return { ok: false, erro: "Indique o motivo da rejeição." };
  }

  const verificacao = await processoParaDecisao(id);
  if (!verificacao.ok) return verificacao;
  const { processo, atorId } = verificacao;

  let rejeitado: typeof processoOnboarding.$inferSelect | undefined;

  try {
    rejeitado = await db().transaction(async (tx) => {
      // Mesma guarda de estado no UPDATE que aprovarProcesso.
      const [res] = await tx
        .update(processoOnboarding)
        .set({ estado: "rejeitado", motivoRejeicao: motivo })
        .where(
          and(
            eq(processoOnboarding.id, id),
            eq(processoOnboarding.estado, "aguardar_aprovacao"),
          ),
        )
        .returning();

      if (!res) return undefined;

      await registarEvento(
        {
          organizacaoId: processo.organizacaoId,
          processoId: processo.id,
          atorId,
          acao: "processo.rejeitado",
          entidade: "processo_onboarding",
          entidadeId: processo.id,
          valorAnterior: { estado: processo.estado },
          valorNovo: { estado: "rejeitado", motivo },
        },
        tx,
      );

      return res;
    });
  } catch (e) {
    console.error(`[processo] ${processo.referencia}: falhou a rejeição / auditoria:`, e);
    return { ok: false, erro: "Não foi possível rejeitar o processo." };
  }

  if (!rejeitado) {
    return { ok: false, erro: "O processo já mudou de estado — recarregue a página." };
  }

  try {
    const { email, nome } = await emailDoCliente(id);
    if (email) {
      const [org] = await db()
        .select({
          id: organizacao.id,
          nome: organizacao.nome,
          logotipoDados: organizacao.logotipoDados,
          logotipoAtualizadoEm: organizacao.logotipoAtualizadoEm,
        })
        .from(organizacao)
        .where(eq(organizacao.id, processo.organizacaoId))
        .limit(1);

      const emailResolvido = await resolverEmailCliente({
        organizacaoId: processo.organizacaoId,
        template: "rejeicao",
        variaveis: {
          nome_cliente: nome,
          referencia: processo.referencia,
          nome_sociedade: org?.nome,
          motivo,
        },
        logotipoUrl: urlLogotipoSociedade(org),
      });

      await enviarEmail({
        para: email,
        assunto: emailResolvido.assunto,
        html: emailResolvido.html,
        template: "rejeicao",
        organizacaoId: processo.organizacaoId,
        processoId: processo.id,
      });
    } else {
      console.warn(
        `[processo] ${processo.referencia}: rejeitado sem endereço de email — decisão não notificada.`,
      );
    }
  } catch (e) {
    console.error(`[processo] ${processo.referencia}: o email de rejeição não foi enviado`, e);
  }

  revalidatePath("/processos");
  revalidatePath(`/processos/${id}`);
  revalidatePath(`/admin/sociedades/${processo.organizacaoId}/processos/${id}`);
  revalidatePath(`/admin/sociedades/${processo.organizacaoId}`);
  revalidatePath("/admin");
  revalidatePath("/");

  return { ok: true };
}

/**
 * Reabre um processo (Frente M): muda estado, renova o acesso do cliente,
 * grava o motivo em auditoria e notifica por email. Só permitido a partir de
 * `arquivado` (→ `em_revisao`) ou `rejeitado` (→ `pendente_cliente`).
 *
 * `aprovado` nunca reabre — é a decisão final da sociedade; a tentativa fica
 * em auditoria e a ação responde com mensagem de processo imutável.
 */
export async function reabrirProcesso(
  id: string,
  motivoBruto: string,
): Promise<ResultadoDecisao> {
  const analise = reaberturaProcessoSchema.safeParse({
    processoId: id,
    motivo: motivoBruto,
  });

  if (!analise.success) {
    const problema = analise.error.issues[0];
    return falha(problema?.message ?? "Indique o motivo da reabertura.");
  }

  const { motivo } = analise.data;

  const { eu } = await exigirEquipaOuSuperAdmin();
  if (!podeReabrirProcesso(eu.papel)) {
    return falha("Não tem permissão para reabrir este processo.");
  }

  const [processo] = await db()
    .select()
    .from(processoOnboarding)
    .where(eq(processoOnboarding.id, id))
    .limit(1);

  if (!processo || !podeAcederSociedade(eu, processo.organizacaoId)) {
    return falha("Processo não encontrado.");
  }

  // aprovado não reabre (imutabilidade definitiva) — tentativa fica em auditoria.
  if (processo.estado === "aprovado") {
    let ipTentativa: string | null = null;
    let userAgentTentativa: string | null = null;
    try {
      const h = await headers();
      ipTentativa = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
      userAgentTentativa = h.get("user-agent") ?? null;
    } catch {
      // Headers outside request context
    }
    try {
      await registarEvento({
        organizacaoId: processo.organizacaoId,
        processoId: processo.id,
        atorId: eu.id,
        acao: "processo.reabertura_recusada",
        entidade: "processo_onboarding",
        entidadeId: processo.id,
        valorAnterior: { estado: processo.estado },
        valorNovo: { motivo },
        ip: ipTentativa,
        userAgent: userAgentTentativa,
      });
    } catch (e) {
      console.error(`[processo] ${processo.referencia}: falhou auditoria de tentativa de reabertura`, e);
    }
    return falha("Processo aprovado — já não pode ser alterado.");
  }

  const ESTADOS_REABERTURA: Record<string, "em_revisao" | "pendente_cliente"> = {
    arquivado: "em_revisao",
    rejeitado: "pendente_cliente",
  };

  const novoEstado = ESTADOS_REABERTURA[processo.estado];
  if (!novoEstado) {
    return falha("Apenas processos arquivados ou rejeitados podem ser reabertos.");
  }

  const { token, hash } = novoTokenAcesso();
  const expiraEm = expiraDaquiA(30);

  // Guarda de estado no UPDATE: entre o SELECT acima e aqui, outro pedido
  // pode ter decidido o mesmo processo — a mesma classe de falha que
  // `aprovarProcesso`/`rejeitarProcesso` já fecham.
  const [reaberto] = await db()
    .update(processoOnboarding)
    .set({
      estado: novoEstado,
      tokenAcessoHash: hash,
      expiraEm,
      apagadoEm: null,
      atualizadoEm: new Date(),
    })
    .where(
      and(
        eq(processoOnboarding.id, id),
        eq(processoOnboarding.estado, processo.estado),
      ),
    )
    .returning();

  if (!reaberto) {
    return falha("O processo já mudou de estado — recarregue a página.");
  }

  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    userAgent = h.get("user-agent") ?? null;
  } catch {
    // Headers outside request context
  }

  try {
    await registarEvento({
      organizacaoId: processo.organizacaoId,
      processoId: processo.id,
      atorId: eu.id,
      acao: "reabertura",
      entidade: "processo_onboarding",
      entidadeId: processo.id,
      valorAnterior: { estado: processo.estado },
      valorNovo: { estado: novoEstado, motivo },
      ip,
      userAgent,
    });
  } catch (e) {
    console.error(`[processo] ${processo.referencia}: falhou auditoria de reabertura`, e);
  }

  try {
    let linkProcesso = `/onboarding/${token}`;
    try {
      linkProcesso = `${await origemPublica()}/onboarding/${token}`;
    } catch (erro) {
      console.error(`[processo] ${processo.referencia}: origemPublica falhou; link relativo`, erro);
    }

    const { email, nome } = await emailDoCliente(id);
    if (email) {
      const [org] = await db()
        .select({
          id: organizacao.id,
          nome: organizacao.nome,
          logotipoDados: organizacao.logotipoDados,
          logotipoAtualizadoEm: organizacao.logotipoAtualizadoEm,
        })
        .from(organizacao)
        .where(eq(organizacao.id, processo.organizacaoId))
        .limit(1);

      const emailResolvido = await resolverEmailCliente({
        organizacaoId: processo.organizacaoId,
        template: "reabertura",
        variaveis: {
          nome_cliente: nome,
          referencia: processo.referencia,
          nome_sociedade: org?.nome,
          motivo,
          link_processo: linkProcesso,
        },
        logotipoUrl: urlLogotipoSociedade(org),
      });

      await enviarEmail({
        para: email,
        assunto: emailResolvido.assunto,
        html: emailResolvido.html,
        template: "reabertura",
        organizacaoId: processo.organizacaoId,
        processoId: processo.id,
        tokenHash: hash,
      });
    } else {
      console.warn(
        `[processo] ${processo.referencia}: reaberto sem endereço de email — notificação não enviada.`,
      );
    }
  } catch (e) {
    console.error(`[processo] ${processo.referencia}: o email de reabertura não foi enviado`, e);
  }

  try {
    revalidatePath("/processos");
    revalidatePath(`/processos/${id}`);
    revalidatePath(`/admin/sociedades/${processo.organizacaoId}/processos/${id}`);
    revalidatePath(`/admin/sociedades/${processo.organizacaoId}`);
    revalidatePath("/admin");
    revalidatePath("/");
  } catch {
    // revalidatePath outside request context
  }

  return { ok: true };
}

/**
 * Reenvia o link de acesso de um processo ao cliente (BUG3-005): o link
 * expira aos 30 dias, ou o cliente esgota a quota de OTP e fica sem forma de
 * voltar a entrar.
 *
 * Restrito a `society_admin`/`super_admin` (`podeReenviarLinkProcesso`) — é
 * administração de acesso, não trabalho sobre o processo. Só nos estados
 * editáveis (`rascunho`, `pendente_cliente`, `em_revisao`); `aprovado` é
 * imutável (D59/D20).
 *
 * Gera sempre um token novo — só o SHA-256 fica gravado (D4), o hash não se
 * inverte. Ao contrário de `reabrirProcesso`, o `estado` não muda.
 */
export async function reenviarLinkProcesso(id: string): Promise<ResultadoDecisao> {
  const { eu } = await exigirEquipaOuSuperAdmin();
  if (!podeReenviarLinkProcesso(eu.papel)) {
    return falha("Não tem permissão para reenviar o link deste processo.");
  }

  const [processo] = await db()
    .select()
    .from(processoOnboarding)
    .where(eq(processoOnboarding.id, id))
    .limit(1);

  if (!processo || !podeAcederSociedade(eu, processo.organizacaoId)) {
    return falha("Processo não encontrado.");
  }

  const ESTADOS_REENVIO = new Set(["rascunho", "pendente_cliente", "em_revisao"]);
  if (!ESTADOS_REENVIO.has(processo.estado)) {
    return falha(
      processo.estado === "aprovado"
        ? "Processo aprovado — já não pode ser alterado."
        : "Só é possível reenviar o link de processos em rascunho, pendentes do cliente ou em revisão.",
    );
  }

  const { token, hash } = novoTokenAcesso();
  const expiraEm = expiraDaquiA(30);

  // Guarda de estado no UPDATE, como em reabrirProcesso/aprovarProcesso: entre
  // o SELECT e aqui, outro pedido pode ter decidido o processo.
  const [atualizado] = await db()
    .update(processoOnboarding)
    .set({ tokenAcessoHash: hash, expiraEm, apagadoEm: null, atualizadoEm: new Date() })
    .where(and(eq(processoOnboarding.id, id), eq(processoOnboarding.estado, processo.estado)))
    .returning();

  if (!atualizado) {
    return falha("O processo já mudou de estado — recarregue a página.");
  }

  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    userAgent = h.get("user-agent") ?? null;
  } catch {
    // Headers outside request context
  }

  try {
    await registarEvento({
      organizacaoId: processo.organizacaoId,
      processoId: processo.id,
      atorId: eu.id,
      acao: "processo.link_reenviado",
      entidade: "processo_onboarding",
      entidadeId: processo.id,
      valorAnterior: { estado: processo.estado },
      valorNovo: { estado: processo.estado },
      ip,
      userAgent,
    });
  } catch (e) {
    console.error(`[processo] ${processo.referencia}: falhou auditoria de reenvio de link`, e);
  }

  try {
    let link = `/onboarding/${token}`;
    try {
      link = `${await origemPublica()}/onboarding/${token}`;
    } catch (erro) {
      console.error(`[processo] ${processo.referencia}: origemPublica falhou; link relativo`, erro);
    }

    const { email, nome } = await emailDoCliente(id);
    const destino = email ?? processo.emailCliente;
    if (destino) {
      const [org] = await db()
        .select({
          id: organizacao.id,
          nome: organizacao.nome,
          logotipoDados: organizacao.logotipoDados,
          logotipoAtualizadoEm: organizacao.logotipoAtualizadoEm,
        })
        .from(organizacao)
        .where(eq(organizacao.id, processo.organizacaoId))
        .limit(1);

      await enviarEmail({
        para: destino,
        assunto: ASSUNTO_REGISTO,
        html: emailRegisto({
          nome: nome ?? processo.nomeCliente,
          link,
          logotipoUrl: urlLogotipoSociedade(org),
        }),
        template: "registo",
        organizacaoId: processo.organizacaoId,
        processoId: processo.id,
        tokenHash: hash,
      });
    } else {
      console.warn(`[processo] ${processo.referencia}: reenvio de link sem endereço de email.`);
    }
  } catch (e) {
    console.error(`[processo] ${processo.referencia}: o email de reenvio não foi enviado`, e);
  }

  try {
    revalidatePath("/processos");
    revalidatePath(`/processos/${id}`);
  } catch {
    // revalidatePath outside request context
  }

  return { ok: true };
}

/* ------------------------------------------------------------- edição de dados */

export type ResultadoEdicao =
  | { ok: true }
  | { ok: false; erro: string };

/**
 * Atualiza os dados de uma secção de um processo (passos 1 a 7).
 *
 * Permite ao `super_admin` e à equipa da sociedade editar/corrigir/preencher
 * qualquer campo de dados de um processo. Toda a alteração é registada na auditoria.
 */
export async function atualizarSeccaoProcesso(
  processoId: string,
  passo: number,
  dados: Record<string, unknown>,
): Promise<ResultadoEdicao> {
  const { eu } = await exigirEquipaOuSuperAdmin();

  const base = db();
  const [processo] = await base
    .select()
    .from(processoOnboarding)
    .where(and(eq(processoOnboarding.id, processoId), isNull(processoOnboarding.apagadoEm)))
    .limit(1);

  if (!processo || !podeAcederSociedade(eu, processo.organizacaoId)) {
    return { ok: false, erro: "Processo não encontrado." };
  }

  if (processo.estado === "aprovado" || processo.estado === "arquivado") {
    // Recusa registada: tentativa de editar dossier fechado fica em auditoria
    // (D46), com o passo que se tentou gravar.
    try {
      await registarEvento({
        organizacaoId: processo.organizacaoId,
        processoId: processo.id,
        atorId: eu.id,
        acao: "processo.edicao_recusada",
        entidade: "processo_onboarding",
        entidadeId: processo.id,
        valorAnterior: { estado: processo.estado },
        valorNovo: { passo },
      });
    } catch (e) {
      console.error(`[processo] ${processo.referencia}: falhou auditoria de tentativa de edição`, e);
    }
    return { ok: false, erro: "Processo aprovado — já não pode ser alterado." };
  }

  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    userAgent = h.get("user-agent") ?? null;
  } catch {
    // Headers might fail outside request context
  }

  const insere = <T>(extra: Record<string, unknown>) => ({ processoId: processo.id, ...extra }) as T;

  /** Só os campos que mudaram face ao que estava gravado — o diff é o que entra em auditoria. */
  const apenasAlterados = (
    antes: Record<string, unknown> | undefined,
    depois: Record<string, unknown>,
  ): { antes: Record<string, unknown>; depois: Record<string, unknown> } => {
    const antesAlterado: Record<string, unknown> = {};
    const depoisAlterado: Record<string, unknown> = {};
    for (const chave of Object.keys(depois)) {
      const valorAntes = antes?.[chave] ?? null;
      const valorDepois = depois[chave] ?? null;
      const igual =
        valorAntes instanceof Date && valorDepois instanceof Date
          ? valorAntes.getTime() === valorDepois.getTime()
          : valorAntes === valorDepois;
      if (!igual) {
        antesAlterado[chave] = valorAntes;
        depoisAlterado[chave] = valorDepois;
      }
    }
    return { antes: antesAlterado, depois: depoisAlterado };
  };

  let diffAntes: Record<string, unknown> = {};
  let diffDepois: Record<string, unknown> = {};

  switch (passo) {
    case 1: {
      const {
        nome,
        profissao,
        entidadePatronal,
        dataNascimento,
        naturezaJuridica,
        dataConstituicao,
        telefone,
        email,
        morada,
        codigoPostal,
        localidade,
        freguesia,
        concelho,
        distrito,
        pais,
        nacionalidades,
      } = dados as {
        nome?: string;
        profissao?: string;
        entidadePatronal?: string;
        dataNascimento?: string;
        naturezaJuridica?: string;
        dataConstituicao?: string;
        telefone?: string;
        email?: string;
        morada?: string;
        codigoPostal?: string;
        localidade?: string;
        freguesia?: string;
        concelho?: string;
        distrito?: string;
        pais?: string;
        nacionalidades?: string[];
      };

      if (!nome?.trim()) {
        return { ok: false, erro: "O nome é obrigatório." };
      }

      // O canal de correção não pode gravar o que o cliente não conseguiria
      // submeter (BUG3-004): as mesmas regras de `onboarding/schemas.ts`,
      // aplicadas só aos campos que o pedido realmente trouxe.
      if (telefone?.trim()) {
        const r = validarTelefone(telefone.trim());
        if (!r.valido) return { ok: false, erro: r.mensagem };
      }
      if (email?.trim() && !emailSchema.safeParse(email.trim()).success) {
        return { ok: false, erro: "Email inválido — falta o @ ou o domínio." };
      }
      if (dataNascimento?.trim()) {
        if (Number.isNaN(Date.parse(dataNascimento.trim()))) {
          return { ok: false, erro: "Data de nascimento inválida." };
        }
        if (new Date(dataNascimento.trim()) > new Date()) {
          return { ok: false, erro: "A data de nascimento não pode estar no futuro." };
        }
      }
      if (dataConstituicao?.trim()) {
        if (Number.isNaN(Date.parse(dataConstituicao.trim()))) {
          return { ok: false, erro: "Data de constituição inválida." };
        }
        if (new Date(dataConstituicao.trim()) > new Date()) {
          return { ok: false, erro: "A data de constituição não pode estar no futuro." };
        }
      }

      const valoresIdentificacao = {
        nome: nome.trim(),
        profissao: profissao?.trim() || null,
        entidadePatronal: entidadePatronal?.trim() || null,
        dataNascimento: dataNascimento?.trim() || null,
        naturezaJuridica: naturezaJuridica?.trim() || null,
        dataConstituicao: dataConstituicao?.trim() || null,
        telefone: telefone?.trim() || "",
        email: email?.trim().toLowerCase() || "",
        morada: morada?.trim() || "",
        codigoPostal: codigoPostal?.trim() || "",
        localidade: localidade?.trim() || "",
        freguesia: freguesia?.trim() || "",
        concelho: concelho?.trim() || "",
        distrito: distrito?.trim() || "",
        pais: pais?.trim() || "Portugal",
      };

      const [identificacaoAnterior] = await base
        .select()
        .from(dadosIdentificacao)
        .where(eq(dadosIdentificacao.processoId, processo.id))
        .limit(1);

      await base
        .insert(dadosIdentificacao)
        .values(insere<typeof dadosIdentificacao.$inferInsert>(valoresIdentificacao))
        .onConflictDoUpdate({
          target: dadosIdentificacao.processoId,
          set: valoresIdentificacao,
        });

      ({ antes: diffAntes, depois: diffDepois } = apenasAlterados(
        identificacaoAnterior,
        valoresIdentificacao,
      ));

      if (Array.isArray(nacionalidades)) {
        await base
          .delete(nacionalidade)
          .where(
            and(
              eq(nacionalidade.processoId, processo.id),
              eq(nacionalidade.titular, "cliente"),
            ),
          );
        if (nacionalidades.length) {
          await base.insert(nacionalidade).values(
            nacionalidades.map((p) => ({
              processoId: processo.id,
              titular: "cliente" as const,
              pais: p,
            })),
          );
        }
      }

      await base
        .update(processoOnboarding)
        .set({
          nomeCliente: nome.trim(),
          emailCliente: email?.trim().toLowerCase() || processo.emailCliente,
          atualizadoEm: new Date(),
        })
        .where(eq(processoOnboarding.id, processo.id));
      break;
    }

    case 2: {
      const {
        nif,
        nifPortugues,
        resideEmPortugal,
        docTipo,
        docNumero,
        docValidade,
        cae,
        codigoCertidaoPermanente,
        regimeIva,
      } = dados as {
        nif?: string;
        nifPortugues?: boolean;
        resideEmPortugal?: boolean;
        docTipo?: "cartao_cidadao" | "passaporte" | "titulo_residencia" | "outro";
        docNumero?: string;
        docValidade?: string;
        cae?: string;
        codigoCertidaoPermanente?: string;
        regimeIva?: "normal" | "isento_art53" | "isento_art9" | "misto";
      };

      if (!nif?.trim()) {
        return { ok: false, erro: "O NIF é obrigatório." };
      }

      // Mesma regra do passo 2 do onboarding: o mod-11 só se aplica a NIF
      // português (`nifPortugues`, default true), e à régua da pessoa
      // coletiva quando é o caso — um NIF de pessoa singular na caixa de uma
      // empresa passa o checksum e está errado à mesma.
      if (nifPortugues ?? true) {
        const r = processo.tipoCliente === "empresa" ? validarNipc(nif) : validarNif(nif);
        if (!r.valido) return { ok: false, erro: r.mensagem };
      }

      const [fiscaisAnterior] = await base
        .select()
        .from(dadosFiscais)
        .where(eq(dadosFiscais.processoId, processo.id))
        .limit(1);

      // Em falta no pedido, o valor existente fica como estava — nunca hoje.
      // Um "hoje" a fingir de data de validade marcava o documento como a
      // expirar já, sem ninguém o ter escolhido. A coluna é `NOT NULL`: sem
      // um valor anterior para cair de volta, falta mesmo um dado obrigatório.
      const docValidadeFinal = docValidade?.trim() || fiscaisAnterior?.docValidade;
      if (!docValidadeFinal) {
        return { ok: false, erro: "A validade do documento é obrigatória." };
      }

      const valoresFiscais = {
        nif: nif.trim(),
        nifPortugues: nifPortugues ?? true,
        resideEmPortugal: resideEmPortugal ?? true,
        docTipo: docTipo || "cartao_cidadao",
        docNumero: docNumero?.trim() || "",
        docValidade: docValidadeFinal,
        cae: cae?.trim() || null,
        codigoCertidaoPermanente: codigoCertidaoPermanente?.trim() || null,
        regimeIva: regimeIva === "normal" || regimeIva === "isento_art53" || regimeIva === "isento_art9" || regimeIva === "misto" ? regimeIva : null,
      };

      await base
        .insert(dadosFiscais)
        .values(insere<typeof dadosFiscais.$inferInsert>(valoresFiscais))
        .onConflictDoUpdate({
          target: dadosFiscais.processoId,
          set: valoresFiscais,
        });

      ({ antes: diffAntes, depois: diffDepois } = apenasAlterados(fiscaisAnterior, valoresFiscais));

      await base
        .update(processoOnboarding)
        .set({ nifCliente: nif.trim(), atualizadoEm: new Date() })
        .where(eq(processoOnboarding.id, processo.id));
      break;
    }

    case 3: {
      const {
        eRepresentante,
        relacao,
        nome,
        dataNascimento,
        profissao,
        telefone,
        email,
        morada,
        pais,
        localidade,
        codigoPostal,
        freguesia,
        concelho,
        distrito,
        nif,
        docTipo,
        docNumero,
        docValidade,
        nacionalidades,
      } = dados as {
        eRepresentante?: boolean;
        relacao?: string;
        nome?: string;
        dataNascimento?: string;
        profissao?: string;
        telefone?: string;
        email?: string;
        morada?: string;
        pais?: string;
        localidade?: string;
        codigoPostal?: string;
        freguesia?: string;
        concelho?: string;
        distrito?: string;
        nif?: string;
        docTipo?: "cartao_cidadao" | "passaporte" | "titulo_residencia" | "outro";
        docNumero?: string;
        docValidade?: string;
        nacionalidades?: string[];
      };

      if (telefone?.trim()) {
        const r = validarTelefone(telefone.trim());
        if (!r.valido) return { ok: false, erro: r.mensagem };
      }
      if (email?.trim() && !emailSchema.safeParse(email.trim()).success) {
        return { ok: false, erro: "Email inválido — falta o @ ou o domínio." };
      }
      if (dataNascimento?.trim()) {
        if (Number.isNaN(Date.parse(dataNascimento.trim()))) {
          return { ok: false, erro: "Data de nascimento inválida." };
        }
        if (new Date(dataNascimento.trim()) > new Date()) {
          return { ok: false, erro: "A data de nascimento não pode estar no futuro." };
        }
      }

      const valoresRep = {
        eRepresentante: Boolean(eRepresentante),
        relacao: relacao?.trim() || null,
        nome: nome?.trim() || null,
        dataNascimento: dataNascimento?.trim() || null,
        profissao: profissao?.trim() || null,
        telefone: telefone?.trim() || null,
        email: email?.trim() || null,
        morada: morada?.trim() || null,
        pais: pais?.trim() || null,
        localidade: localidade?.trim() || null,
        codigoPostal: codigoPostal?.trim() || null,
        freguesia: freguesia?.trim() || null,
        concelho: concelho?.trim() || null,
        distrito: distrito?.trim() || null,
        nif: nif?.trim() || null,
        docTipo: docTipo || null,
        docNumero: docNumero?.trim() || null,
        docValidade: docValidade?.trim() || null,
      };

      const [repAnterior] = await base
        .select()
        .from(representanteLegal)
        .where(eq(representanteLegal.processoId, processo.id))
        .limit(1);

      await base
        .insert(representanteLegal)
        .values(insere<typeof representanteLegal.$inferInsert>(valoresRep))
        .onConflictDoUpdate({
          target: representanteLegal.processoId,
          set: valoresRep,
        });

      ({ antes: diffAntes, depois: diffDepois } = apenasAlterados(repAnterior, valoresRep));

      if (Array.isArray(nacionalidades)) {
        await base
          .delete(nacionalidade)
          .where(
            and(
              eq(nacionalidade.processoId, processo.id),
              eq(nacionalidade.titular, "representante"),
            ),
          );
        if (nacionalidades.length) {
          await base.insert(nacionalidade).values(
            nacionalidades.map((p) => ({
              processoId: processo.id,
              titular: "representante" as const,
              pais: p,
            })),
          );
        }
      }
      break;
    }

    case 4: {
      const {
        ePpe,
        ppeCargo,
        ppePais,
        ppeEntidade,
        ppeInicio,
        ppeFim,
        eRelacionadoPpe,
        relacaoPpe,
        ppeRelacionadaNome,
        ppeRelacionadaCargo,
        ppeRelacionadaPais,
        servicos,
        origemFundos,
      } = dados as {
        ePpe?: boolean;
        ppeCargo?: string;
        ppePais?: string;
        ppeEntidade?: string;
        ppeInicio?: string;
        ppeFim?: string;
        eRelacionadoPpe?: boolean;
        relacaoPpe?: string;
        ppeRelacionadaNome?: string;
        ppeRelacionadaCargo?: string;
        ppeRelacionadaPais?: string;
        servicos?: string;
        origemFundos?: string;
      };

      if (ppeInicio?.trim() && Number.isNaN(Date.parse(ppeInicio.trim()))) {
        return { ok: false, erro: "Data de início do exercício PPE inválida." };
      }
      if (ppeFim?.trim() && Number.isNaN(Date.parse(ppeFim.trim()))) {
        return { ok: false, erro: "Data de fim do exercício PPE inválida." };
      }
      if (ppeInicio?.trim() && ppeFim?.trim() && new Date(ppeFim) < new Date(ppeInicio)) {
        return { ok: false, erro: "O fim não pode ser anterior ao início." };
      }

      const valoresPpe = {
        ePpe: Boolean(ePpe),
        ppeCargo: ppeCargo?.trim() || null,
        ppePais: ppePais?.trim() || null,
        ppeEntidade: ppeEntidade?.trim() || null,
        ppeInicio: ppeInicio?.trim() || null,
        ppeFim: ppeFim?.trim() || null,
        eRelacionadoPpe: Boolean(eRelacionadoPpe),
        relacaoPpe: relacaoPpe?.trim() || null,
        ppeRelacionadaNome: ppeRelacionadaNome?.trim() || null,
        ppeRelacionadaCargo: ppeRelacionadaCargo?.trim() || null,
        ppeRelacionadaPais: ppeRelacionadaPais?.trim() || null,
      };

      const [ppeAnterior] = await base
        .select()
        .from(declaracaoPpe)
        .where(eq(declaracaoPpe.processoId, processo.id))
        .limit(1);

      await base
        .insert(declaracaoPpe)
        .values(insere<typeof declaracaoPpe.$inferInsert>(valoresPpe))
        .onConflictDoUpdate({
          target: declaracaoPpe.processoId,
          set: valoresPpe,
        });

      ({ antes: diffAntes, depois: diffDepois } = apenasAlterados(ppeAnterior, valoresPpe));

      if (servicos !== undefined || origemFundos !== undefined) {
        const valoresRelacao = {
          servicos: servicos?.trim() || "",
          origemFundos: origemFundos?.trim() || "",
        };

        const [relacaoAnterior] = await base
          .select()
          .from(relacaoNegocio)
          .where(eq(relacaoNegocio.processoId, processo.id))
          .limit(1);

        await base
          .insert(relacaoNegocio)
          .values({ processoId: processo.id, ...valoresRelacao })
          .onConflictDoUpdate({
            target: relacaoNegocio.processoId,
            set: valoresRelacao,
          });

        const diffRelacao = apenasAlterados(relacaoAnterior, valoresRelacao);
        diffAntes = { ...diffAntes, ...diffRelacao.antes };
        diffDepois = { ...diffDepois, ...diffRelacao.depois };
      }

      const eraElevado = processo.nivelRisco === "elevado";

      if (ePpe) {
        await base
          .update(processoOnboarding)
          .set({
            nivelRisco: "elevado",
            fatoresRisco: [
              {
                codigo: "ppe",
                descricao: "Pessoa politicamente exposta declarada",
                peso: 100,
              },
            ],
            atualizadoEm: new Date(),
          })
          .where(eq(processoOnboarding.id, processo.id));

        if (!eraElevado) {
          try {
            await registarEvento({
              organizacaoId: processo.organizacaoId,
              processoId: processo.id,
              atorId: eu.id,
              acao: "risco.elevado",
              entidade: "processo_onboarding",
              entidadeId: processo.id,
              valorNovo: { nivelRisco: "elevado", motivo: "ppe" },
              ip,
              userAgent,
            });
          } catch (e) {
            console.error(`[processo] ${processo.referencia}: falhou auditoria de risco`, e);
          }
        }
      } else if (eraElevado) {
        await base
          .update(processoOnboarding)
          .set({
            nivelRisco: "baixo",
            fatoresRisco: [],
            atualizadoEm: new Date(),
          })
          .where(eq(processoOnboarding.id, processo.id));

        try {
          await registarEvento({
            organizacaoId: processo.organizacaoId,
            processoId: processo.id,
            atorId: eu.id,
            acao: "risco.reposto",
            entidade: "processo_onboarding",
            entidadeId: processo.id,
            valorAnterior: { nivelRisco: "elevado", motivo: "ppe" },
            valorNovo: { nivelRisco: "baixo", motivo: "ppe_retirada" },
            ip,
            userAgent,
          });
        } catch (e) {
          console.error(`[processo] ${processo.referencia}: falhou auditoria de risco reposto`, e);
        }
      }
      break;
    }

    case 5: {
      const {
        igualAoCliente,
        nome,
        nif,
        email,
        acIgualAoCliente,
        acNome,
        acEmail,
        acTelefone,
        morada,
        codigoPostal,
        localidade,
        freguesia,
        concelho,
        distrito,
        pais,
      } = dados as {
        igualAoCliente?: boolean;
        nome?: string;
        nif?: string;
        email?: string;
        acIgualAoCliente?: boolean;
        acNome?: string;
        acEmail?: string;
        acTelefone?: string;
        morada?: string;
        codigoPostal?: string;
        localidade?: string;
        freguesia?: string;
        concelho?: string;
        distrito?: string;
        pais?: string;
      };

      if (!nome?.trim() || !nif?.trim() || !email?.trim()) {
        return { ok: false, erro: "Nome, NIF e email de faturação são obrigatórios." };
      }

      // Mesmo schema do passo 5 do onboarding (`nifFaturacao`): nove dígitos
      // levam o checksum inteiro, qualquer outra forma é um NIF estrangeiro e
      // só se exige que exista.
      const nifValidado = nifFaturacao.safeParse(nif);
      if (!nifValidado.success) {
        return { ok: false, erro: nifValidado.error.issues[0]?.message ?? "NIF inválido." };
      }
      if (!emailSchema.safeParse(email.trim()).success) {
        return { ok: false, erro: "Email inválido — falta o @ ou o domínio." };
      }
      if (acEmail?.trim() && !emailSchema.safeParse(acEmail.trim()).success) {
        return { ok: false, erro: "Email do contacto alternativo inválido." };
      }

      const valoresFaturacao = {
        igualAoCliente: Boolean(igualAoCliente),
        nome: nome.trim(),
        nif: nifValidado.data,
        email: email.trim().toLowerCase(),
        acIgualAoCliente: Boolean(acIgualAoCliente),
        acNome: acNome?.trim() || null,
        acEmail: acEmail?.trim() || null,
        acTelefone: acTelefone?.trim() || null,
        morada: morada?.trim() || "",
        codigoPostal: codigoPostal?.trim() || "",
        localidade: localidade?.trim() || "",
        freguesia: freguesia?.trim() || "",
        concelho: concelho?.trim() || "",
        distrito: distrito?.trim() || "",
        pais: pais?.trim() || "Portugal",
      };

      const [faturacaoAnterior] = await base
        .select()
        .from(dadosFaturacao)
        .where(eq(dadosFaturacao.processoId, processo.id))
        .limit(1);

      await base
        .insert(dadosFaturacao)
        .values(insere<typeof dadosFaturacao.$inferInsert>(valoresFaturacao))
        .onConflictDoUpdate({
          target: dadosFaturacao.processoId,
          set: valoresFaturacao,
        });

      ({ antes: diffAntes, depois: diffDepois } = apenasAlterados(
        faturacaoAnterior,
        valoresFaturacao,
      ));
      break;
    }

    case 6: {
      const {
        origemContacto,
        origemDetalhe,
        newsletter,
        emailsNewsletter,
        areasInteresse,
        convitesIniciativas,
        convitesNome,
        convitesEmail,
      } = dados as {
        origemContacto?: "evento_conferencia" | "recomendacao" | "pesquisa_online" | "outro";
        origemDetalhe?: string;
        newsletter?: boolean;
        emailsNewsletter?: string[];
        areasInteresse?: string[];
        convitesIniciativas?: boolean;
        convitesNome?: string;
        convitesEmail?: string;
      };

      const valoresPrefs = {
        origemContacto: origemContacto || null,
        origemDetalhe: origemDetalhe?.trim() || null,
        newsletter: Boolean(newsletter),
        convitesIniciativas: Boolean(convitesIniciativas),
        convitesNome: convitesNome?.trim() || null,
        convitesEmail: convitesEmail?.trim() || null,
      };

      const [prefsAnterior] = await base
        .select()
        .from(preferenciasContacto)
        .where(eq(preferenciasContacto.processoId, processo.id))
        .limit(1);

      await base
        .insert(preferenciasContacto)
        .values(insere<typeof preferenciasContacto.$inferInsert>(valoresPrefs))
        .onConflictDoUpdate({
          target: preferenciasContacto.processoId,
          set: valoresPrefs,
        });

      ({ antes: diffAntes, depois: diffDepois } = apenasAlterados(prefsAnterior, valoresPrefs));

      if (Array.isArray(emailsNewsletter)) {
        await base
          .delete(emailNewsletter)
          .where(eq(emailNewsletter.processoId, processo.id));
        if (emailsNewsletter.length) {
          await base.insert(emailNewsletter).values(
            emailsNewsletter.map((e) => ({
              processoId: processo.id,
              email: e.trim().toLowerCase(),
            })),
          );
        }
      }

      if (Array.isArray(areasInteresse)) {
        await base
          .delete(areaInteresse)
          .where(eq(areaInteresse.processoId, processo.id));
        if (areasInteresse.length) {
          await base
            .insert(areaInteresse)
            .values(areasInteresse.map((a) => ({ processoId: processo.id, area: a.trim() })));
        }
      }
      break;
    }

    case 7: {
      const { declaracaoVeracidade, tcAceitacao, propostaAceitacao } = dados as {
        declaracaoVeracidade?: boolean;
        tcAceitacao?: boolean;
        propostaAceitacao?: boolean;
      };

      const valoresFecho = {
        declaracaoVeracidade: Boolean(declaracaoVeracidade),
        tcAceitacao: Boolean(tcAceitacao),
        propostaAceitacao: Boolean(propostaAceitacao),
      };

      const [fechoAnterior] = await base
        .select()
        .from(fechoProposta)
        .where(eq(fechoProposta.processoId, processo.id))
        .limit(1);

      await base
        .insert(fechoProposta)
        .values(insere<typeof fechoProposta.$inferInsert>(valoresFecho))
        .onConflictDoUpdate({
          target: fechoProposta.processoId,
          set: valoresFecho,
        });

      ({ antes: diffAntes, depois: diffDepois } = apenasAlterados(fechoAnterior, valoresFecho));
      break;
    }

    default:
      return { ok: false, erro: "Passo inválido." };
  }

  await base
    .update(processoOnboarding)
    .set({ atualizadoEm: new Date() })
    .where(eq(processoOnboarding.id, processo.id));

  try {
    await registarEvento({
      organizacaoId: processo.organizacaoId,
      processoId: processo.id,
      atorId: eu.id,
      acao: "processo.dados_atualizados",
      entidade: "processo_onboarding",
      entidadeId: processo.id,
      valorAnterior: { passo, papel: eu.papel, ...diffAntes },
      valorNovo: { passo, papel: eu.papel, ...diffDepois },
      ip,
      userAgent,
    });
  } catch (e) {
    console.error(`[processo] ${processo.referencia}: falhou registo de auditoria da edição`, e);
  }

  try {
    revalidatePath("/processos");
    revalidatePath(`/processos/${processo.id}`);
    revalidatePath(`/admin/sociedades/${processo.organizacaoId}/processos/${processo.id}`);
    revalidatePath(`/admin/sociedades/${processo.organizacaoId}`);
  } catch {
    // revalidatePath outside request context
  }

  return { ok: true };
}

