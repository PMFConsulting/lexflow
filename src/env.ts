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
  /**
   * Remetente dos emails ao cliente. O valor por omissão é o da sociedade e não
   * o `onboarding@resend.dev` do arranque: uma instalação a que falte a variável
   * mandava os três emails da JMASSANO com o remetente da Resend, e um cliente
   * que recebe um pedido de dados pessoais de um domínio que não conhece faz
   * bem em não responder. Continua a poder ser trocado por `.env`.
   */
  EMAIL_REMETENTE: z.string().email().default("POC@jmassano.pt"),
  EMAIL_NOTIFICACOES: z.string().email().optional(),
  /** Chave AES-256 (64 carateres hex) para cifrar credenciais de armazenamento. Gera com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. */
  ARMAZENAMENTO_CHAVE: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "ARMAZENAMENTO_CHAVE tem de ser 64 carateres hex (32 bytes)")
    .optional(),
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
