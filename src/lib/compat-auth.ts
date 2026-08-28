import { randomBytes, scrypt as scryptAsync } from "node:crypto";

/**
 * Reimplementation of `@better-auth/utils/password`'s Node backend, for the
 * two operational scripts that cannot carry `better-auth` into the
 * `output: "standalone"` image (BUG-001 — Next's tracing drops packages that
 * end up inlined into the server bundle, and these scripts run outside it).
 *
 * The parameters have to match exactly, or a hash produced here would not
 * verify against one Better Auth wrote, and vice-versa: `r: 16` is not
 * Node's scrypt default (`8`), so it must be passed explicitly.
 * `src/lib/compat-auth.test.ts` pins this against the real
 * `better-auth/crypto` implementation.
 */
const N = 16384;
const R = 16;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 128 * N * R * 2;

function gerarChave(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptAsync(
      password.normalize("NFKC"),
      salt,
      KEYLEN,
      { N, r: R, p: P, maxmem: MAXMEM },
      (erro, chave) => {
        if (erro) reject(erro);
        else resolve(chave as Buffer);
      },
    );
  });
}

/** Format: `${salt}:${key}`, both hex — identical to better-auth/crypto's hashPassword. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const chave = await gerarChave(password, salt);
  return `${salt}:${chave.toString("hex")}`;
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  const [salt, chave] = hash.split(":");
  if (!salt || !chave) return false;
  const alvo = await gerarChave(password, salt);
  return alvo.toString("hex") === chave;
}
