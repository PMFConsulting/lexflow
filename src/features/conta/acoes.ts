"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { db } from "@/db";
import { account } from "@/db/schema/auth";
import { utilizador } from "@/db/schema/organizacao";
import { registarEvento } from "@/features/auditoria/registar";
import { COOKIE_SOCIEDADE_ATIVA, sessaoAtual } from "@/lib/sessao";
import { novaPalavraPasseSchema } from "./schemas";
import { mascararEmail } from "@/lib/redigir";

/**
 * A conta de quem já entrou: definir a palavra-passe própria.
 *
 * Ação autenticada, não link de reposição: a pessoa já se autenticou com a
 * credencial temporária ao chegar aqui, o que já prova que o email é dela.
 *
 * `sessaoAtual()` e não `exigirSessao()`: o guard manda para cá quem tem
 * `deve_redefinir_password`, e usar o guard aqui criava um redirecionamento
 * desta ação para si própria.
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
   * A credencial do Better Auth — `provider_id = 'credential'`, onde vive a
   * palavra-passe (D2/D23). Sem linha, nada a atualizar; marcar a `false` sem
   * credencial destrancava a plataforma sem forma de voltar a entrar.
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
   * A nova palavra-passe não pode ser a temporária — sem isto, submeter o
   * mesmo valor do email passava como redefinição sem o ser.
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
      console.warn(`[conta] não foi possível comparar o hash de ${mascararEmail(eu.email)}`, e);
    }
  }

  const hash = await hashPassword(lido.data.palavraPasse);

  /**
   * As duas escritas numa transação (D63): a meio não há estado aceitável —
   * só o hash é uma conta presa; só a marca é a plataforma aberta com a
   * credencial antiga ainda a valer.
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
    console.error(`[conta] falhou a definir a palavra-passe de ${mascararEmail(eu.email)}:`, e);
    return { ok: false, erros: { _: "Não foi possível gravar. Tente de novo." } };
  }

  /**
   * A auditoria regista que a palavra-passe foi definida, não qual é. Cadeia
   * por organização (D6); `super_admin` não tem uma, por isso vai para o
   * console em vez de se pendurar numa sociedade a que não pertence.
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

export type ResultadoTrocaSociedade = { ok: true } | { ok: false; erro: string };

/**
 * Muda a sociedade ativa de uma conta que administra mais do que uma
 * (BUG3-002) — grava o cookie que `sessaoAtual()` lê, nada mais.
 *
 * `organizacaoId` só é aceite com linha `utilizador` ativa e não apagada
 * desta conta nessa sociedade; sem essa validação, qualquer conta escolhia
 * entrar em qualquer sociedade só por saber o id, que não é segredo.
 */
export async function trocarSociedade(organizacaoId: string): Promise<ResultadoTrocaSociedade> {
  const sessao = await sessaoAtual();
  if (!sessao) {
    return { ok: false, erro: "A sessão expirou. Volte a entrar." };
  }

  const [pertence] = await db()
    .select({ id: utilizador.id })
    .from(utilizador)
    .where(
      and(
        eq(utilizador.authUserId, sessao.conta.id),
        eq(utilizador.organizacaoId, organizacaoId),
        eq(utilizador.ativo, true),
        isNull(utilizador.apagadoEm),
      ),
    )
    .limit(1);

  if (!pertence) {
    return { ok: false, erro: "Não tem acesso a essa sociedade." };
  }

  (await cookies()).set(COOKIE_SOCIEDADE_ATIVA, organizacaoId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  revalidatePath("/");
  return { ok: true };
}
