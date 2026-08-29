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
 * The plaintext token and its hash, generated **in one go**.
 *
 * They used to be separate, and whoever created the matter hashed by hand what
 * they had just generated. That works as long as nobody touches the two lines —
 * and the day one of them starts hashing something else (a renewed token, a
 * value normalised halfway through) gives a stored matter with a hash matching
 * no link at all: the client receives the address, the lookup by hash finds
 * nothing, and what they see is a 404 with no possible explanation.
 *
 * By returning the pair, that divergence stops being writable. Whoever stores
 * does not choose what gets hashed; they receive that token's hash and have no
 * other at hand.
 */
export function novoTokenAcesso(): { token: string; hash: string } {
  const token = gerarToken();
  return { token, hash: hashToken(token) };
}

/** The `base64url` alphabet — the only letters one of our tokens has. */
const ALFABETO = /[A-Za-z0-9_-]/;

/**
 * Cleans a token arriving from outside before looking it up.
 *
 * One of our tokens is 43 characters of `base64url`, and what reaches the
 * server has been through an email client, a paste and a browser. Along the way
 * it picks up things that are **not part of it**: the full stop ending the
 * sentence the link sat in, the `<` and `>` Outlook wraps addresses in, a hard
 * space stuck on the right, a trailing `/` the browser adds, a `​` webmail
 * inserted so it could break the line.
 *
 * None of those characters can exist in a token, and even so any one of them
 * changes the SHA-256 entirely — the matter is there, the link is the right
 * one, and the lookup returns nothing. It is the most banal way for a valid
 * magic link to give a 404, and the hardest to believe when you look at the URL
 * and it *looks* fine.
 *
 * Trimming happens **only at the ends**, and on purpose: cleaning the middle
 * would turn a corrupted token into a possibly valid one, which is hiding the
 * fault instead of fixing it. At the ends there is no such risk — a token has a
 * fixed length and none is a prefix of another.
 *
 * The dirt itself can arrive percent-encoded — a webmail client's ZWSP reaches
 * the server as `%E2%80%8B`, and its last decoded character, `B`, belongs to
 * the token alphabet. Trimming a still-encoded string finds nothing to cut and
 * leaves the ZWSP sitting inside what looks like a clean token. Decoding runs
 * first, and only once: after that the ZWSP is the raw invisible character the
 * trim already knows how to remove, and a token's own alphabet has no `%` to
 * decode in the first place, so a real token is never touched by this step.
 */
export function normalizarToken(bruto: string): string {
  let t = bruto ?? "";
  try {
    t = decodeURIComponent(t);
  } catch {
    // Malformed percent-encoding (e.g. a lone `%zz`) — keep it as received and
    // let the trim below and the hash mismatch handle it, same as any other dirt.
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
