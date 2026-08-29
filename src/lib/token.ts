import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Magic link tokens.
 *
 * The plaintext token exists once, in the email. Only the SHA-256 is stored in
 * the database — whoever has read access to the DB does not end up holding the
 * key to every client case file.
 */

export function gerarToken(): string {
  // 32 bytes in base64url: short enough to fit in a link and wide enough not to
  // be guessed.
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(normalizarToken(token)).digest("hex");
}

/**
 * Generates the plaintext token and its hash **in one step** (D47).
 *
 * Kept separate, one call hashing something other than what it just
 * generated gives a matter with a hash matching no link — 404 with no
 * explanation. Returning the pair means whoever stores never chooses what
 * gets hashed.
 */
export function novoTokenAcesso(): { token: string; hash: string } {
  const token = gerarToken();
  return { token, hash: hashToken(token) };
}

/** The `base64url` alphabet — the only letters one of our tokens has. */
const ALFABETO = /[A-Za-z0-9_-]/;

/**
 * Cleans a token from outside before lookup (D47).
 *
 * A token is 43 `base64url` characters, but what arrives has passed through
 * an email client, a paste and a browser: a trailing full stop, Outlook's
 * `<>`, a hard space, a trailing `/`, a webmail ZWSP. None belongs to the
 * token, and any one of them changes the SHA-256 entirely — link is right,
 * lookup finds nothing.
 *
 * Trimmed only at the ends: cleaning the middle would turn a corrupted token
 * into a possibly valid one, hiding the fault instead of fixing it. At the
 * ends there's no such risk — fixed length, no token is a prefix of another.
 *
 * `decodeURIComponent` runs first and only once: a ZWSP can arrive as
 * `%E2%80%8B`, whose last decoded character (`B`) belongs to the token
 * alphabet and would slip past an un-decoded trim.
 */
export function normalizarToken(bruto: string): string {
  let t = bruto ?? "";
  try {
    t = decodeURIComponent(t);
  } catch {
    // Malformed percent-encoding (e.g. a lone `%zz`) — leave as received, the
    // trim and hash mismatch handle it like any other dirt.
  }
  let inicio = 0;
  let fim = t.length;
  while (inicio < fim && !ALFABETO.test(t[inicio])) inicio++;
  while (fim > inicio && !ALFABETO.test(t[fim - 1])) fim--;
  return t.slice(inicio, fim);
}

/**
 * Constant-time comparison. In a normal comparison, response time varies with
 * how many characters match — which lets the token be guessed byte by byte. Not
 * here.
 */
export function tokensIguais(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** 30 days, renewable by the person responsible (ambiguity A15). */
export function expiraDaquiA(dias = 30): Date {
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
}
