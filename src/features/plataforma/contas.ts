import "server-only";
import { randomBytes, randomInt } from "node:crypto";
import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { uuidv7 } from "uuidv7";
import { db } from "@/db";
import { account, user } from "@/db/schema/auth";
import { organizacao, utilizador } from "@/db/schema/organizacao";
import { enviarEmail } from "@/lib/email";
import { ASSUNTO_CREDENCIAIS, emailCredenciais } from "@/lib/emails/credenciais";
import { urlLogotipoSociedade } from "@/lib/emails/moldura";
import { origemPublica } from "@/lib/origem";
import type { Papel } from "@/lib/sessao";

/**
 * Criação de contas — o serviço, partilhado pela interface e pelo script.
 *
 * As duas escritas que uma conta precisa (decisão D2) viviam só em
 * `scripts/criar_utilizador.mjs`, e o portal do `super_admin` precisa
 * exatamente das mesmas. A alternativa — a interface a invocar o script por
 * shell — está fora de questão: passava o email e a palavra-passe pela linha de
 * comandos de um processo (o `ps` de qualquer utilizador da máquina mostra os
 * argumentos), e transformava um erro de SQL numa string de stderr para alguém
 * tentar interpretar.
 *
 * O script continua a existir, e continua a ser o caminho certo para o
 * arranque: a primeira conta da plataforma tem de nascer sem ninguém
 * autenticado para a criar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * As duas escritas, e porque são duas
 *
 *   1. `user` + `account` — o Better Auth. A palavra-passe não vive em `user`:
 *      vive na `account` com `provider_id = 'credential'`, e é lá que o início
 *      de sessão a procura.
 *   2. `utilizador` — o nosso, o que tem papel e sociedade.
 *
 * Sem a segunda, o início de sessão passa e a sessão não resolve —
 * `sessaoAtual()` procura por `auth_user_id` e devolve `null`, o que manda a
 * pessoa de volta para `/entrar` sem uma única mensagem de erro. É o defeito
 * mais confuso que este sistema sabe produzir, e é por isso que as duas correm
 * dentro da mesma transação.
 *
 * O hash vem de `better-auth/crypto` e não de uma reimplementação de scrypt: é
 * a única forma de garantir que os parâmetros não divergem numa atualização da
 * biblioteca. Mesma regra que o script já seguia.
 */

/**
 * Palavra-passe gerada por nós — sempre, e sem alternativa.
 *
 * Sem `l`/`I`/`1`/`O`/`0`: isto vai ser lido de um email e escrito à mão numa
 * caixa de palavra-passe, que não mostra o que se escreve. Um alfabeto sem
 * sósias tira ao processo o modo de falha mais irritante que ele tem — a conta
 * que "não funciona" porque alguém leu um `1` onde estava um `l`.
 *
 * `randomInt` do módulo `crypto` e não `Math.random()`: são credenciais de
 * acesso a um sistema com documentos de identificação lá dentro.
 */
const ALFABETO = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function gerarPalavraPasse(comprimento = 16) {
  let saida = "";
  for (let i = 0; i < comprimento; i++) saida += ALFABETO[randomInt(ALFABETO.length)];
  return saida;
}

/** Id no formato do Better Auth: texto opaco, sem hífenes. */
const idAuth = () => randomBytes(16).toString("hex");

export function normalizarEmail(email: string) {
  return email.trim().toLowerCase();
}

export type PedidoDeConta = {
  nome: string;
  email: string;
  papel: Papel;
  /** `null` para o `super_admin`, que não pertence a sociedade nenhuma. */
  organizacaoId: string | null;
  /** Opcional, só para papel 'utilizador'. */
  gestorId?: string | null;
  /**
   * Data de aprovação da conta.
   * Se omitido (undefined), por omissão é now() (aprovado).
   * Se null, conta nasce pendente de aprovação e sem envio de credenciais.
   */
  aprovadoEm?: Date | null;
};

/**
 * O que se sabe da conta depois de a criar — e **nunca a palavra-passe**.
 *
 * Era aqui que ela vinha, em claro, para um cartão no ecrã de quem criou a
 * conta. Deixou de vir, e a razão é de produto e não de arrumação: a
 * palavra-passe passava pelas mãos de um terceiro, ficava num ecrã aberto num
 * escritório, e a pessoa a quem ela pertence não era obrigada a trocá-la nunca.
 * O canal passou a ser o email da própria pessoa, e a credencial passou a ser
 * temporária (`utilizador.deve_redefinir_password`).
 *
 * O que fica no lugar é o que quem administra precisa mesmo de saber: **a
 * mensagem saiu?** Sem essa resposta, uma conta criada com um email que não
 * chegou é uma pessoa que não entra e ninguém sabe porquê — que é exactamente o
 * silêncio da D48, deste lado.
 */
export type ContaCriada = {
  utilizadorId: string;
  email: string;
  nome: string;
  papel: Papel;
  aprovadoEm: Date | null;
  gestorId: string | null;
  /**
   * `true` — as credenciais saíram; `false` — não saíram, e `erroEmail` diz
   * porquê; `null` — o envio foi adiado, ainda não aconteceu ou a conta está pendente de aprovação.
   */
  emailEnviado: boolean | null;
  erroEmail: string | null;
};

/**
 * Um envio de credenciais à espera da transação que o produziu.
 *
 * As credenciais **não podem sair de dentro de uma transação**: a importação em
 * lote é tudo-ou-nada (é o que impede um ficheiro de trinta linhas de deixar
 * quinze contas criadas), e uma mensagem enviada de lá de dentro é uma
 * palavra-passe entregue para uma conta que o `ROLLBACK` seguinte apagou. Além
 * disso, prender uma transação de Postgres durante trinta chamadas HTTP a um
 * fornecedor de email é o género de coisa que só se descobre com a base a
 * bloquear.
 *
 * A `conta` viaja aqui dentro de propósito: é o mesmo objeto que já foi
 * devolvido a quem chamou, e é nele que o desfecho do envio é escrito quando
 * ele acontecer.
 */
export type CredencialPorEnviar = {
  nome: string;
  email: string;
  palavraPasse: string;
  organizacaoId: string | null;
  conta: ContaCriada;
};

/**
 * O que pode correr mal e tem resposta em português.
 *
 * Uma classe própria, e não uma `Error` genérica: o Server Action precisa de
 * distinguir "este email já cá está" (que se diz ao utilizador, debaixo da
 * caixa que o causou) de "a base de dados caiu" (que se regista e se resume a
 * um pedido de desculpas). Sem a distinção, ou se mostram detalhes internos ao
 * utilizador ou se esconde dele a única coisa que ele podia corrigir.
 */
export class ErroDeConta extends Error {
  constructor(public readonly motivo: string) {
    super(motivo);
    this.name = "ErroDeConta";
  }
}

/**
 * Valida o par (papel, sociedade) antes de qualquer escrita.
 *
 * A restrição `utilizador_org_por_papel` diz o mesmo na base de dados, e é ela
 * que garante o resultado. Esta função existe para dar a **mensagem**: um
 * `violates check constraint` no ecrã de quem se enganou a escolher a sociedade
 * não é uma resposta.
 */
export function validarPapelESociedade(papel: Papel, organizacaoId: string | null) {
  if (papel === "super_admin" && organizacaoId) {
    return "Um administrador da plataforma não pertence a nenhuma sociedade.";
  }
  if (papel !== "super_admin" && !organizacaoId) {
    return "Escolha a sociedade a que esta conta pertence.";
  }
  return null;
}

/**
 * Cria (ou repõe) a conta e manda as credenciais **para a pessoa** (se aprovada).
 *
 * A palavra-passe é sempre gerada aqui e nunca vem de fora: quem administra não
 * a escolhe, não a lê e não a entrega.
 *
 * Se a conta nascer pendente de aprovação (`aprovadoEm = null`), o envio de
 * credenciais não ocorre neste momento.
 */
export type Transacao = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

export async function criarConta(
  pedido: PedidoDeConta,
  tx?: Transacao,
  porEnviar?: CredencialPorEnviar[],
): Promise<ContaCriada> {
  const email = normalizarEmail(pedido.email);
  const nome = pedido.nome.trim();
  const palavraPasse = gerarPalavraPasse();
  const aprovadoEm = pedido.aprovadoEm !== undefined ? pedido.aprovadoEm : new Date();

  const problema = validarPapelESociedade(pedido.papel, pedido.organizacaoId);
  if (problema) throw new ErroDeConta(problema);

  if (pedido.gestorId && pedido.papel !== "utilizador") {
    throw new ErroDeConta("Apenas utilizadores com papel 'utilizador' podem ter um gestor associado.");
  }

  if (!nome) throw new ErroDeConta("Indique o nome.");

  const hash = await hashPassword(palavraPasse);

  const executar = async (t: Transacao): Promise<ContaCriada> => {
    if (pedido.gestorId) {
      const [gestorLinha] = await t
        .select({
          id: utilizador.id,
          papel: utilizador.papel,
          organizacaoId: utilizador.organizacaoId,
        })
        .from(utilizador)
        .where(
          and(
            eq(utilizador.id, pedido.gestorId),
            isNull(utilizador.apagadoEm),
          ),
        )
        .limit(1);

      if (!gestorLinha) {
        throw new ErroDeConta("O gestor selecionado não existe ou foi removido.");
      }
      if (gestorLinha.papel !== "gestor") {
        throw new ErroDeConta("O utilizador selecionado como gestor não tem o papel de gestor.");
      }
      if (gestorLinha.organizacaoId !== pedido.organizacaoId) {
        throw new ErroDeConta("O gestor tem de pertencer à mesma sociedade.");
      }
    }

    /* --- verificação de colisão global --------------------------------- */

    const [noutraSociedade] = await t
      .select({ id: utilizador.id, organizacaoId: utilizador.organizacaoId })
      .from(utilizador)
      .where(
        pedido.organizacaoId
          ? and(
              eq(utilizador.email, email),
              ne(utilizador.organizacaoId, pedido.organizacaoId),
            )
          : isNotNull(utilizador.organizacaoId),
      )
      .limit(1);

    if (noutraSociedade) {
      throw new ErroDeConta(
        "Esta pessoa já tem conta noutra sociedade. Um email só pode estar associado a uma sociedade.",
      );
    }

    /* --- a conta do Better Auth ------------------------------------------ */

    const [contaExistente] = await t
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1);

    let authUserId: string;

    if (contaExistente) {
      const [noutraPorAuth] = await t
        .select({ id: utilizador.id, organizacaoId: utilizador.organizacaoId })
        .from(utilizador)
        .where(
          pedido.organizacaoId
            ? and(
                eq(utilizador.authUserId, contaExistente.id),
                ne(utilizador.organizacaoId, pedido.organizacaoId),
              )
            : isNotNull(utilizador.organizacaoId),
        )
        .limit(1);

      if (noutraPorAuth) {
        throw new ErroDeConta(
          "Esta pessoa já tem conta noutra sociedade. Um email só pode estar associado a uma sociedade.",
        );
      }

      authUserId = contaExistente.id;
      await t.update(user).set({ name: nome, updatedAt: new Date() }).where(eq(user.id, authUserId));
    } else {
      authUserId = idAuth();
      await t.insert(user).values({
        id: authUserId,
        name: nome,
        email,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    const [credencial] = await t
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, authUserId), eq(account.providerId, "credential")))
      .limit(1);

    if (credencial) {
      await t
        .update(account)
        .set({ password: hash, updatedAt: new Date() })
        .where(eq(account.id, credencial.id));
    } else {
      await t.insert(account).values({
        id: idAuth(),
        accountId: authUserId,
        providerId: "credential",
        userId: authUserId,
        password: hash,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    /* --- o utilizador de domínio ------------------------------------------ */

    const [jaExiste] = await t
      .select({ id: utilizador.id, apagadoEm: utilizador.apagadoEm })
      .from(utilizador)
      .where(
        and(
          eq(utilizador.email, email),
          pedido.organizacaoId
            ? eq(utilizador.organizacaoId, pedido.organizacaoId)
            : isNull(utilizador.organizacaoId),
        ),
      )
      .limit(1);

    if (jaExiste && !jaExiste.apagadoEm) {
      throw new ErroDeConta("Já existe uma conta com este email nesta sociedade.");
    }

    const utilizadorId = jaExiste?.id ?? uuidv7();
    const gestorIdFinal = pedido.papel === "utilizador" ? (pedido.gestorId ?? null) : null;

    if (jaExiste) {
      await t
        .update(utilizador)
        .set({
          nome,
          papel: pedido.papel,
          gestorId: gestorIdFinal,
          aprovadoEm,
          authUserId,
          ativo: true,
          apagadoEm: null,
          deveRedefinirPassword: true,
          atualizadoEm: new Date(),
        })
        .where(eq(utilizador.id, utilizadorId));
    } else {
      await t.insert(utilizador).values({
        id: utilizadorId,
        organizacaoId: pedido.organizacaoId,
        authUserId,
        nome,
        email,
        papel: pedido.papel,
        gestorId: gestorIdFinal,
        aprovadoEm,
        ativo: true,
        deveRedefinirPassword: true,
      });
    }

    return {
      utilizadorId,
      email,
      nome,
      papel: pedido.papel,
      aprovadoEm,
      gestorId: gestorIdFinal,
      emailEnviado: null,
      erroEmail: null,
    };
  };

  const conta = tx ? await executar(tx) : await db().transaction(executar);

  // Se a conta nasce aprovada, envia as credenciais de acesso
  if (aprovadoEm !== null) {
    const envio: CredencialPorEnviar = {
      nome,
      email,
      palavraPasse,
      organizacaoId: pedido.organizacaoId,
      conta,
    };

    if (porEnviar) porEnviar.push(envio);
    else await enviarCredenciais(envio);
  }

  return conta;
}

/* -------------------------------------------------- o envio das credenciais */

/**
 * O endereço de início de sessão desta instalação.
 *
 * `origemPublica()` é a fonte certa e a única de confiança (o anfitrião do
 * pedido não decide para onde vai um link que sai por email), mas rebenta fora
 * de um pedido HTTP e rebenta com `BETTER_AUTH_URL` mal configurada. Um email
 * de credenciais sem botão continua a ser um email de credenciais úteis — o que
 * não pode acontecer é ele não sair por causa do endereço do botão.
 */
async function enderecoDeEntrada(): Promise<string> {
  try {
    return `${await origemPublica()}/entrar`;
  } catch (e) {
    console.warn("[contas] origemPublica failed — a usar BETTER_AUTH_URL", e);
    const base = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
    return `${base}/entrar`;
  }
}

/**
 * O nome da sociedade, para a mensagem saber de quem fala.
 *
 * Nunca rebenta e nunca impede o envio: um email que diz "foi criada uma conta
 * para si" sem o nome da casa é pior do que um que o diz, e é muitíssimo melhor
 * do que nenhum.
 */
async function dadosDaSociedade(
  organizacaoId: string | null,
): Promise<{ nome: string | null; logotipoUrl: string | null }> {
  if (!organizacaoId) return { nome: null, logotipoUrl: null };
  try {
    const [linha] = await db()
      .select({
        id: organizacao.id,
        nome: organizacao.nome,
        logotipoDados: organizacao.logotipoDados,
        logotipoAtualizadoEm: organizacao.logotipoAtualizadoEm,
      })
      .from(organizacao)
      .where(eq(organizacao.id, organizacaoId))
      .limit(1);
    return {
      nome: linha?.nome ?? null,
      logotipoUrl: urlLogotipoSociedade(linha),
    };
  } catch (e) {
    console.warn(`[contas] could not read organisation ${organizacaoId}`, e);
    return { nome: null, logotipoUrl: null };
  }
}

/**
 * Manda as credenciais e escreve o desfecho na conta.
 *
 * **Não propaga.** A conta já está criada e nada do que aqui acontece a desfaz
 * (D46); o que interessa é que a resposta diga o que se passou, para o ecrã
 * poder distinguir "está criada e a pessoa já tem como entrar" de "está criada
 * e ninguém lhe consegue chegar" — que se resolvem em sítios diferentes.
 */
export async function enviarCredenciais(envio: CredencialPorEnviar): Promise<void> {
  try {
    const [link, soc] = await Promise.all([
      enderecoDeEntrada(),
      dadosDaSociedade(envio.organizacaoId),
    ]);

    const resultado = await enviarEmail({
      para: envio.email,
      assunto: ASSUNTO_CREDENCIAIS,
      html: emailCredenciais({
        nome: envio.nome,
        sociedade: soc.nome,
        email: envio.email,
        palavraPasse: envio.palavraPasse,
        link,
        logotipoUrl: soc.logotipoUrl,
      }),
      template: "credenciais_acesso",
      organizacaoId: envio.organizacaoId,
    });

    envio.conta.emailEnviado = resultado.ok;
    envio.conta.erroEmail = resultado.ok ? null : resultado.erro;
  } catch (e) {
    // `enviarEmail` promete não propagar, e o resto daqui também não devia —
    // mas o que não pode mesmo acontecer é a conta ficar com `emailEnviado` a
    // `null`, que é o estado "ainda não se sabe" a passar por "correu bem".
    envio.conta.emailEnviado = false;
    envio.conta.erroEmail = e instanceof Error ? e.message : String(e);
    console.error(`[contas] falhou o envio das credenciais para ${envio.email}:`, e);
  }
}

/**
 * Despeja os envios que ficaram à espera da transação.
 *
 * Em série e não em paralelo: são chamadas HTTP a um fornecedor com quota
 * diária e limite de ritmo, e trinta em simultâneo é a forma mais rápida de
 * apanhar um 429 que põe o canal em pausa (`lib/email.ts`) e deixa metade das
 * contas sem credenciais.
 */
export async function enviarCredenciaisPendentes(
  pendentes: readonly CredencialPorEnviar[],
): Promise<void> {
  for (const envio of pendentes) await enviarCredenciais(envio);
}
