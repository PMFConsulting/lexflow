import "server-only";
import { z } from "zod";

/**
 * Variáveis de ambiente validadas. A leitura é preguiçosa de propósito: o
 * `next build` não precisa de base de dados, e falhar o build por falta de um
 * segredo que só é usado em runtime é mau negócio.
 */
const esquema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL tem de ser um URL de ligação Postgres"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET precisa de pelo menos 32 caracteres"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_REMETENTE: z.string().email().default("onboarding@resend.dev"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Ambiente = z.infer<typeof esquema>;

let cache: Ambiente | null = null;

export function env(): Ambiente {
  if (cache) return cache;

  const resultado = esquema.safeParse(process.env);
  if (!resultado.success) {
    const problemas = resultado.error.issues
      .map((i) => `  · ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Variáveis de ambiente em falta ou inválidas:\n${problemas}\n\nCopia o .env.example para .env e preenche-o.`,
    );
  }

  cache = resultado.data;
  return cache;
}
