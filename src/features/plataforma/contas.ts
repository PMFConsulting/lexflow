import "server-only";
import { randomBytes, randomInt } from "node:crypto";
import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { uuidv7 } from "uuidv7";
import { db } from "@/db";
import { account, user } from "@/db/schema/auth";
import { organizacao, utilizador } from "@/db/schema/organizacao";
import { enviarEmail } from "@/lib/email";
import {
  ASSUNTO_AVISO_MULTI_SOCIEDADE,
  ASSUNTO_CREDENCIAIS,
  emailAvisoMultiSociedade,
  emailCredenciais,
} from "@/lib/emails/credenciais";
import { urlLogotipoSociedade } from "@/lib/emails/moldura";
import { origemPublica } from "@/lib/origem";
import type { Papel } from "@/lib/sessao";

/**
 * Criação de contas — serviço partilhado pela interface e pelo script. As
 * duas escritas (D2) viviam só em `scripts/criar_utilizador.mjs`; invocar o
 * script por shell a partir da interface passaria a palavra-passe pela linha
 * de comandos (visível em `ps`). O script continua a ser o caminho certo para
 * a primeira conta, criada sem ninguém autenticado.
 *
 * Duas escritas na mesma transação: `user`+`account` (Better Auth, palavra-passe
 * em `account.provider_id = 'credential'`) e `utilizador` (papel e sociedade)
 * — sem a segunda, o login passa e a sessão não resolve, sem erro nenhum.
 *
 * Hash vem de `better-auth/crypto`, não de scrypt reimplementado — garante
 * que os parâmetros não divergem numa atualização da biblioteca.
 */

/**
 * Palavra-passe gerada por nós, sempre. Sem `l`/`I`/`1`/`O`/`0` — vai ser
 * lida de um email e escrita à mão numa caixa que não mostra o que se
 * escreve. `randomInt` de `crypto`, não `Math.random()`.
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
  /** Se `true`, não re-verifica aviso de multi-sociedade. */
  confirmarMultiSociedade?: boolean;
};

/**
 * O que se sabe da conta depois de a criar — nunca a palavra-passe. Vinha
 * aqui em claro, para um cartão no ecrã; deixou de vir porque passava pelas
 * mãos de um terceiro e a pessoa nunca era obrigada a trocá-la. O canal
 * passou a ser o email dela, com credencial temporária. O que fica é o que
 * quem administra precisa: a mensagem saiu? (mesmo silêncio da D48, deste lado).
 */
export type ContaCriada = {
  utilizadorId: string;
  email: string;
  nome: string;
  papel: Papel;
  aprovadoEm: Date | null;
  gestorId: string | null;
  /** `true` quando a conta já existia e foi reaproveitada (D64, mesma pessoa a administrar outra sociedade) — palavra-passe intocada, aviso em vez de credenciais. */
  reaproveitada: boolean;
  /** `true` quando o email já administrava outra sociedade e foi criada nova sociedade sem confirmação prévia. */
  avisoMultiSociedade?: boolean;
  /** Nome da sociedade que o administrador já geria previamente, se aplicável. */
  sociedadeExistenteNome?: string | null;
  /** `true` credenciais saíram; `false` não saíram (`erroEmail` diz porquê); `null` envio adiado ou conta pendente. */
  emailEnviado: boolean | null;
  erroEmail: string | null;
};

/**
 * Envio de credenciais à espera da transação que o produziu. Não pode sair de
 * dentro dela: uma mensagem enviada aí é uma palavra-passe entregue para uma
 * conta que um ROLLBACK seguinte pode apagar, e prender a transação por trinta
 * chamadas HTTP bloqueia a base. `conta` viaja aqui porque é o mesmo objeto
 * já devolvido a quem chamou — o desfecho do envio escreve-se nele.
 */
export type CredencialPorEnviar = {
  nome: string;
  email: string;
  palavraPasse: string;
  organizacaoId: string | null;
  conta: ContaCriada;
};

/** O que o aviso de multi-sociedade precisa — sem palavra-passe, a credencial é a de sempre (D64). */
type AvisoMultiSociedade = {
  nome: string;
  email: string;
  sociedadeNome: string | null;
  organizacaoId: string | null;
  conta: ContaCriada;
};

/**
 * O que pode correr mal e tem resposta em português. Classe própria, não
 * `Error` genérica — distingue "este email já cá está" (mostrar ao
 * utilizador) de "a base de dados caiu" (só registar).
 */
export class ErroDeConta extends Error {
  constructor(public readonly motivo: string) {
    super(motivo);
    this.name = "ErroDeConta";
  }
}

/** Valida o par (papel, sociedade) antes de qualquer escrita — a mensagem, já que a restrição `utilizador_org_por_papel` garante o resultado. */
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
 * Cria (ou repõe) a conta e manda as credenciais para a pessoa, se aprovada.
 * Palavra-passe sempre gerada aqui — quem administra não a escolhe, não a lê,
 * não a entrega. Conta pendente de aprovação não recebe envio agora.
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

    let avisoMultiSociedade = false;
    let sociedadeExistenteNome: string | null = null;

    if (pedido.papel !== "society_admin") {
      const [noutraSociedade] = await t
        .select({ id: utilizador.id, organizacaoId: utilizador.organizacaoId })
        .from(utilizador)
        .where(
          pedido.organizacaoId
            ? and(
              eq(utilizador.email, email),
              ne(utilizador.organizacaoId, pedido.organizacaoId),
              isNull(utilizador.apagadoEm),
            )
            : and(
                eq(utilizador.email, email),
                isNotNull(utilizador.organizacaoId),
                isNull(utilizador.apagadoEm),
              ),
        )
        .limit(1);

      if (noutraSociedade) {
        throw new ErroDeConta(
          "Esta pessoa já tem conta noutra sociedade. Um email só pode estar associado a uma sociedade.",
        );
      }
    } else if (!pedido.confirmarMultiSociedade) {
      const [noutraSociedade] = await t
        .select({
          id: utilizador.id,
          organizacaoId: utilizador.organizacaoId,
        })
        .from(utilizador)
        .where(
          pedido.organizacaoId
            ? and(
                eq(utilizador.email, email),
                ne(utilizador.organizacaoId, pedido.organizacaoId),
                isNull(utilizador.apagadoEm),
              )
            : isNotNull(utilizador.organizacaoId),
        )
        .limit(1);

      if (noutraSociedade && noutraSociedade.organizacaoId) {
        avisoMultiSociedade = true;
        const [soc] = await t
          .select({ nome: organizacao.nome })
          .from(organizacao)
          .where(eq(organizacao.id, noutraSociedade.organizacaoId))
          .limit(1);
        sociedadeExistenteNome = soc?.nome ?? null;
      }
    }

    /* --- a conta do Better Auth ------------------------------------------ */

    const [contaExistente] = await t
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1);

    let authUserId: string;

    if (contaExistente) {
      if (pedido.papel !== "society_admin") {
        const [noutraPorAuth] = await t
          .select({ id: utilizador.id, organizacaoId: utilizador.organizacaoId })
          .from(utilizador)
          .where(
            pedido.organizacaoId
              ? and(
                  eq(utilizador.authUserId, contaExistente.id),
                  ne(utilizador.organizacaoId, pedido.organizacaoId),
                  isNull(utilizador.apagadoEm),
                )
                : and(
                    eq(utilizador.authUserId, contaExistente.id),
                    isNotNull(utilizador.organizacaoId),
                    isNull(utilizador.apagadoEm),
                  ),
          )
          .limit(1);

        if (noutraPorAuth) {
          throw new ErroDeConta(
            "Esta pessoa já tem conta noutra sociedade. Um email só pode estar associado a uma sociedade.",
          );
        }
      } else if (!pedido.confirmarMultiSociedade && !avisoMultiSociedade) {
        const [noutraPorAuth] = await t
          .select({ id: utilizador.id, organizacaoId: utilizador.organizacaoId })
          .from(utilizador)
          .where(
            pedido.organizacaoId
              ? and(
                  eq(utilizador.authUserId, contaExistente.id),
                  ne(utilizador.organizacaoId, pedido.organizacaoId),
                  isNull(utilizador.apagadoEm),
                )
              : isNotNull(utilizador.organizacaoId),
          )
          .limit(1);

        if (noutraPorAuth && noutraPorAuth.organizacaoId) {
          avisoMultiSociedade = true;
          const [soc] = await t
            .select({ nome: organizacao.nome })
            .from(organizacao)
            .where(eq(organizacao.id, noutraPorAuth.organizacaoId))
            .limit(1);
          sociedadeExistenteNome = soc?.nome ?? null;
        }
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

    /* --- o utilizador de domínio (ANTES da credencial: o caminho decide) --- */

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

    // Reaproveita a credencial em vez de a substituir (D64, migração 0025):
    // regenerar a palavra-passe de quem já tem conta seria pedir-lhe para
    // trocar uma que já usa por outra que não pediu.
    const reaproveitada = Boolean(contaExistente);

    const [credencial] = await t
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, authUserId), eq(account.providerId, "credential")))
      .limit(1);

    if (credencial && reaproveitada) {
      /* --- credencial existente vale (D64) --------------------------------- */

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
            // Nada de redefinição obrigatória: a pessoa entra com a
            // palavra-passe que já conhece e usa noutra sociedade.
            deveRedefinirPassword: false,
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
          deveRedefinirPassword: false,
        });
      }

      return {
        utilizadorId,
        email,
        nome,
        papel: pedido.papel,
        aprovadoEm,
        gestorId: gestorIdFinal,
        reaproveitada: true,
        avisoMultiSociedade,
        sociedadeExistenteNome,
        emailEnviado: null,
        erroEmail: null,
      };
    }

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
      reaproveitada: false,
      avisoMultiSociedade,
      sociedadeExistenteNome,
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
 * Endereço de login desta instalação. `origemPublica()` é a fonte certa mas
 * rebenta fora de um pedido HTTP — recua para `BETTER_AUTH_URL`, porque um
 * email de credenciais sem botão continua a ser útil.
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

/** Nome da sociedade, para a mensagem saber de quem fala. Nunca rebenta nem impede o envio. */
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
 * Manda as credenciais e escreve o desfecho na conta. Não propaga (D46) — a
 * conta já está criada; o que importa é o ecrã saber distinguir "criada e
 * acessível" de "criada e inalcançável".
 */
export async function enviarCredenciais(envio: CredencialPorEnviar): Promise<void> {
  try {
    const [link, soc] = await Promise.all([
      enderecoDeEntrada(),
      dadosDaSociedade(envio.organizacaoId),
    ]);

    // Dois caminhos (D64): conta nova leva a palavra-passe temporária; conta
    // reaproveitada leva só um aviso, sem palavra-passe no corpo.
    if (envio.conta.reaproveitada) {
      const resultado = await enviarEmail({
        para: envio.email,
        assunto: ASSUNTO_AVISO_MULTI_SOCIEDADE,
        html: emailAvisoMultiSociedade({
          nome: envio.nome,
          sociedade: soc.nome,
          link,
          logotipoUrl: soc.logotipoUrl,
        }),
        template: "credenciais_acesso",
        organizacaoId: envio.organizacaoId,
      });

      envio.conta.emailEnviado = resultado.ok;
      envio.conta.erroEmail = resultado.ok ? null : resultado.erro;
      return;
    }

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
    // enviarEmail já não propaga, mas emailEnviado não pode ficar em null —
    // isso passaria por "correu bem" o estado "ainda não se sabe".
    envio.conta.emailEnviado = false;
    envio.conta.erroEmail = e instanceof Error ? e.message : String(e);
    console.error(`[contas] falhou o envio das credenciais para ${envio.email}:`, e);
  }
}

/** Despeja os envios pendentes, em série — trinta em paralelo é como se apanha um 429 que pausa o canal (lib/email.ts). */
export async function enviarCredenciaisPendentes(
  pendentes: readonly CredencialPorEnviar[],
): Promise<void> {
  for (const envio of pendentes) await enviarCredenciais(envio);
}
