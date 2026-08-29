import "server-only";
import { z } from "zod";
import { EMAIL_REMETENTE_DEFAULT } from "./email-remetente-default.mjs";

/**
 * Validated environment variables. The read is lazy on purpose: `next build`
 * does not need a database, and failing the build for want of a secret only
 * used at runtime is a bad deal.
 */
const esquema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL tem de ser um URL de ligação Postgres"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET precisa de pelo menos 32 caracteres"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  RESEND_API_KEY: z.string().optional(),
  /** Alternative to Resend (Brevo, 300 emails/day on the free plan). If present, it takes priority. */
  BREVO_API_KEY: z.string().optional(),
  /**
   * Alternative to Resend (Mailjet, 200 emails/day on the free plan). Only used
   * with the key AND the secret.
   */
  MAILJET_API_KEY: z.string().optional(),
  MAILJET_SECRET_KEY: z.string().optional(),
  /** Twilio SendGrid (opcional; produção futura via Twilio). */
  TWILIO_SENDGRID_API_KEY: z.string().optional(),
  /**
   * Last resort: our own SMTP (postfix on the client's server). No third-party
   * quota, but delivery is less closely watched — so it sits at the end of the
   * chain. `SMTP_PORT` is optional (25 by default).
   */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().max(65535).optional(),
  /** Remetente dos emails ao cliente. Substituível via `.env`. */
  EMAIL_REMETENTE: z.string().email().default(EMAIL_REMETENTE_DEFAULT),
  EMAIL_NOTIFICACOES: z.string().email().optional(),
  /** AES-256 key (64 hex characters) for encrypting storage credentials. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. */
  ARMAZENAMENTO_CHAVE: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "ARMAZENAMENTO_CHAVE tem de ser 64 carateres hex (32 bytes)")
    .optional(),
  /**
   * A chave que autentica o bot na API dos onboardings.
   *
   * Opcional, e sem valor por omissão de propósito: **sem ela a API responde
   * 503 e não fica aberta**. Um valor por defeito aqui seria a instalação que
   * esqueceu a variável a servir dados de KYC a quem os peça — e uma chave
   * partilhada num exemplo é uma chave pública.
   *
   * Gera-se com `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
   */
  API_CHAVE: z.string().min(32, "API_CHAVE precisa de pelo menos 32 caracteres").optional(),
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
