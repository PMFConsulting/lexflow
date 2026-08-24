import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, schema } from "@/db";

/**
 * Email + password with database-backed sessions.
 *
 * TOTP MFA fell outside the POC cut (see CLAUDE.md). When it comes in, it is
 * Better Auth's `twoFactor` plugin plus a table — not a refactor.
 *
 * The instance is created on first use so `next build` needs neither a database
 * connection nor secrets.
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
      // No public sign-up: accounts are created by the firm, with
      // `scripts/criar_utilizador.mjs` running on the server. The sign-up
      // screen no longer exists, and this switch also closes the endpoint — the
      // API route kept accepting anyone calling it by hand.
      disableSignUp: true,
      minPasswordLength: 12,
    },
    session: {
      // Long session (30 days) with renewal: whoever uses the POC daily does
      // not log in again on every visit. The renewal (updateAge) keeps the
      // session alive as long as there is activity.
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24,
    },
  });
}

export function auth() {
  if (!cache) cache = criar();
  return cache;
}
