import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, schema } from "@/db";

/**
 * Email + password com sessões em base de dados.
 *
 * O MFA por TOTP ficou fora do corte da POC (ver CLAUDE.md). Quando entrar, é o
 * plugin `twoFactor` do Better Auth mais uma tabela — não é refactor.
 *
 * A instância é criada à primeira utilização para o `next build` não precisar de
 * ligação à base de dados nem de segredos.
 */
let cache: ReturnType<typeof criar> | null = null;

function criar() {
  return betterAuth({
    database: drizzleAdapter(db(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    emailAndPassword: {
      enabled: true,
      // Sem registo público: as contas são criadas pela sociedade, com o
      // `scripts/criar_utilizador.mjs` a correr no servidor. O ecrã de registo
      // deixou de existir, e este interruptor fecha também o endpoint — a rota
      // da API continuava aberta a quem a chamasse à mão.
      disableSignUp: true,
      minPasswordLength: 12,
    },
    session: {
      expiresIn: 60 * 60 * 8, // 8 horas — um dia de trabalho, não um mês
      updateAge: 60 * 60,
    },
  });
}

export function auth() {
  if (!cache) cache = criar();
  return cache;
}
