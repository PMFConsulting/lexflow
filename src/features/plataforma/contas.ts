import "server-only";
import { randomBytes, randomInt } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { uuidv7 } from "uuidv7";
import { db } from "@/db";
import { account, user } from "@/db/schema/auth";
import { utilizador } from "@/db/schema/organizacao";
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

/** O que o Better Auth aceita no início de sessão (`minPasswordLength`). */
export const MINIMO_PALAVRA_PASSE = 12;

/**
 * Palavra-passe gerada por nós.
 *
 * Sem `l`/`I`/`1`/`O`/`0`: isto vai ser lido de um ecrã e escrito noutro sítio,
 * provavelmente por telefone. Um alfabeto sem sósias tira ao processo o modo de
 * falha mais irritante que ele tem — a conta que "não funciona" porque alguém
 * leu um `1` onde estava um `l`.
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
  /** Omitida, é gerada — e devolvida uma única vez a quem criou a conta. */
  palavraPasse?: string;
};

export type ContaCriada = {
  utilizadorId: string;
  email: string;
  nome: string;
  papel: Papel;
  /**
   * Em claro, e só aqui.
   *
   * Não vai para `evento_auditoria` (que dura sete anos), não vai para
   * `email_log` (que guarda assunto e destinatário, nunca o corpo — D34) e não
   * fica em lado nenhum da base de dados: o que lá fica é o hash, na `account`.
   * O único sítio onde este valor existe é a resposta desta chamada, e o único
   * ecrã que o mostra mostra-o uma vez.
   */
  palavraPasse: string;
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
 * Cria (ou repõe) a conta e devolve a palavra-passe uma única vez.
 *
 * `tx` é opcional para o caso de haver de correr dentro de uma transação maior
 * — é o que a importação em lote faz, para que um ficheiro de trinta linhas não
 * deixe quinze contas criadas e quinze por criar.
 */
export type Transacao = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

export async function criarConta(
  pedido: PedidoDeConta,
  tx?: Transacao,
): Promise<ContaCriada> {
  const email = normalizarEmail(pedido.email);
  const nome = pedido.nome.trim();
  const palavraPasse = pedido.palavraPasse ?? gerarPalavraPasse();

  const problema = validarPapelESociedade(pedido.papel, pedido.organizacaoId);
  if (problema) throw new ErroDeConta(problema);

  if (!nome) throw new ErroDeConta("Indique o nome.");
  if (palavraPasse.length < MINIMO_PALAVRA_PASSE) {
    throw new ErroDeConta(
      `A palavra-passe tem de ter pelo menos ${MINIMO_PALAVRA_PASSE} caracteres.`,
    );
  }

  const hash = await hashPassword(palavraPasse);

  const executar = async (t: Transacao): Promise<ContaCriada> => {
    /* --- a conta do Better Auth ------------------------------------------ */

    // `user.email` é único **global**, e o `utilizador` é único por sociedade.
    // Os dois níveis não coincidem: a mesma pessoa em duas sociedades teria dois
    // `utilizador` e uma só conta de acesso. É por isso que a conta é
    // reaproveitada quando já existe, em vez de se tentar criar outra — o
    // insert rebentava no índice único e a mensagem falava de uma tabela que
    // quem está no ecrã não sabe que existe.
    const [contaExistente] = await t
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1);

    let authUserId: string;

    if (contaExistente) {
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

    // Sem sociedade, a procura é por `is null` e não por `= null` — que em SQL
    // não é falso, é desconhecido, e não encontrava nunca o `super_admin` que
    // já lá estivesse. É a mesma distinção que obrigou ao índice único parcial.
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

    if (jaExiste) {
      // Estava apagado: repõe-se em vez de recusar. O email é único por
      // sociedade e um insert novo batia no índice — e "já existe" sobre uma
      // conta que ninguém vê em lado nenhum é a pior resposta possível.
      await t
        .update(utilizador)
        .set({
          nome,
          papel: pedido.papel,
          authUserId,
          ativo: true,
          apagadoEm: null,
          atualizadoEm: new Date(),
        })
        .where(eq(utilizador.id, utilizadorId));
    } else {
      // `id` gerado na aplicação e não pela base de dados (decisão D15).
      await t.insert(utilizador).values({
        id: utilizadorId,
        organizacaoId: pedido.organizacaoId,
        authUserId,
        nome,
        email,
        papel: pedido.papel,
        ativo: true,
      });
    }

    return { utilizadorId, email, nome, papel: pedido.papel, palavraPasse };
  };

  // Com `tx` já estamos dentro de uma; abrir outra por dentro não é possível.
  return tx ? executar(tx) : db().transaction(executar);
}
