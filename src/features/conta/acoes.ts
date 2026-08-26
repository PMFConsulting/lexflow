"use server";

import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { db } from "@/db";
import { account } from "@/db/schema/auth";
import { utilizador } from "@/db/schema/organizacao";
import { registarEvento } from "@/features/auditoria/registar";
import { sessaoAtual } from "@/lib/sessao";
import { novaPalavraPasseSchema } from "./schemas";

/**
 * A conta de quem já entrou: definir a palavra-passe própria.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Porque é uma ação autenticada e não um link de reposição
 *
 * O que isto fecha é a janela entre "recebi credenciais por email" e "tenho uma
 * palavra-passe que só eu conheço". A pessoa **já se autenticou** com a
 * credencial temporária quando chega aqui — é isso que prova que o email é
 * dela — e por isso não há segundo fator a inventar: um link de reposição
 * enviado por email seria autenticar pelo mesmo canal duas vezes, e um pedido da
 * palavra-passe atual seria pedir outra vez o que ela acabou de escrever no
 * ecrã de entrada, três segundos antes.
 *
 * `sessaoAtual()` e não `exigirSessao()`, de propósito: o guard manda para cá
 * toda a gente que tenha a marca `deve_redefinir_password`, e usá-lo aqui era
 * esta ação a redirecionar-se para a página que a chama.
 */

export type ResultadoRedefinicao =
  | { ok: true }
  | { ok: false; erros: Record<string, string> };

export async function redefinirPalavraPasse(dados: unknown): Promise<ResultadoRedefinicao> {
  const sessao = await sessaoAtual();
  if (!sessao) {
    return {
      ok: false,
      erros: { _: "A sessão expirou. Volte a entrar para definir a palavra-passe." },
    };
  }

  const lido = novaPalavraPasseSchema.safeParse(dados);
  if (!lido.success) {
    const saida: Record<string, string> = {};
    for (const problema of lido.error.issues) {
      const campo = problema.path.join(".") || "_";
      if (!saida[campo]) saida[campo] = problema.message;
    }
    return { ok: false, erros: saida };
  }

  const { eu, conta } = sessao;

  /**
   * A credencial do Better Auth — `provider_id = 'credential'`, que é onde a
   * palavra-passe vive (D2/D23). Não é `user`, e não é a nossa `utilizador`.
   *
   * Sem linha nenhuma não há nada a atualizar, e escrever a marca a `false`
   * sobre uma conta sem credencial era destrancar a plataforma a alguém que
   * continua sem forma de voltar a entrar amanhã.
   */
  const [credencial] = await db()
    .select({ id: account.id, password: account.password })
    .from(account)
    .where(and(eq(account.userId, conta.id), eq(account.providerId, "credential")))
    .limit(1);

  if (!credencial) {
    console.error(
      `[conta] ${eu.email} não tem credencial 'credential' — a palavra-passe não pode ser definida.`,
    );
    return {
      ok: false,
      erros: {
        _: "Esta conta não tem credenciais de acesso configuradas. Fale com quem a criou.",
      },
    };
  }

  /**
   * A palavra-passe nova não pode ser a temporária.
   *
   * Sem esta verificação, submeter o mesmo valor que veio no email passava —
   * e o ecrã dizia que estava tudo tratado sobre uma palavra-passe que continua
   * a existir escrita numa caixa de correio. A redefinição deixava de ser uma
   * redefinição e passava a ser um clique.
   */
  if (credencial.password) {
    try {
      const igual = await verifyPassword({
        hash: credencial.password,
        password: lido.data.palavraPasse,
      });
      if (igual) {
        return {
          ok: false,
          erros: {
            palavraPasse:
              "Escolha uma palavra-passe diferente da que recebeu por email — essa é temporária.",
          },
        };
      }
    } catch (e) {
      // Um hash que não se consegue ler não é razão para impedir a pessoa de
      // definir uma palavra-passe nova: é razão para a definir.
      console.warn(`[conta] não foi possível comparar o hash de ${eu.email}`, e);
    }
  }

  const hash = await hashPassword(lido.data.palavraPasse);

  /**
   * As duas escritas numa transação, pela mesma razão que a criação da conta
   * (D63): a meio delas não há estado aceitável. Só o hash novo é uma pessoa
   * presa para sempre no ecrã de definição, com a palavra-passe já trocada; só
   * a marca é a plataforma aberta com a credencial do email ainda a valer.
   */
  try {
    await db().transaction(async (tx) => {
      await tx
        .update(account)
        .set({ password: hash, updatedAt: new Date() })
        .where(eq(account.id, credencial.id));

      await tx
        .update(utilizador)
        .set({ deveRedefinirPassword: false, atualizadoEm: new Date() })
        .where(eq(utilizador.id, eu.id));
    });
  } catch (e) {
    console.error(`[conta] falhou a definir a palavra-passe de ${eu.email}:`, e);
    return { ok: false, erros: { _: "Não foi possível gravar. Tente de novo." } };
  }

  /**
   * A auditoria regista **que** a palavra-passe foi definida, e nada do que ela
   * é. A cadeia é por organização (D6) e o `super_admin` não tem nenhuma — para
   * esse fica o registo no console, que é onde as operações de plataforma já
   * vivem, em vez de se pendurar o evento numa sociedade a que ele não pertence.
   */
  const cabecalhos = await headers();
  const ip = cabecalhos.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = cabecalhos.get("user-agent");

  if (eu.organizacaoId) {
    try {
      await registarEvento({
        organizacaoId: eu.organizacaoId,
        atorId: eu.id,
        acao: "utilizador.palavra_passe_definida",
        entidade: "utilizador",
        entidadeId: eu.id,
        valorAnterior: { deveRedefinirPassword: true },
        valorNovo: { deveRedefinirPassword: false },
        ip,
        userAgent,
      });
    } catch (e) {
      // Mesma regra da D46: a palavra-passe já está trocada e nada disto a
      // desfaz. Um erro no ecrã por causa da auditoria mandava a pessoa repetir
      // o que já está feito.
      console.error("[conta] falha a registar utilizador.palavra_passe_definida:", e);
    }
  } else {
    console.warn(
      `[conta] palavra-passe definida por ${eu.email} (plataforma, ip ${ip ?? "?"}, ${userAgent ?? "?"})`,
    );
  }

  return { ok: true };
}
