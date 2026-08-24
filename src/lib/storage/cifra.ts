import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import type { EnvelopeCifrado } from "./tipos";

/**
 * Encryption of the storage connection parameters.
 *
 * AES-256-GCM: it encrypts and authenticates at the same time. Without the tag,
 * anyone with write access to the database could swap bytes of the ciphertext
 * and point the upload somewhere else with nothing noticing — the authenticated
 * mode turns that into a decryption error.
 *
 * Deliberate note: this module reads `process.env` instead of `env()`. `env()`
 * imports `server-only`, and the key is needed in two places that are not the
 * Next server — the configuration script and the tests.
 */

const ALGORITMO = "aes-256-gcm";
/** 96 bits is the recommended nonce for GCM. */
const BYTES_IV = 12;
const BYTES_CHAVE = 32;

export class ErroCifra extends Error {}

/**
 * The key, from 64 hex characters in `ARMAZENAMENTO_CHAVE`.
 *
 * Returns null when it is not set: with no key, the sync switches itself off
 * silently instead of blowing up a matter's submission.
 */
export function chaveDeAmbiente(): Buffer | null {
  const bruta = process.env.ARMAZENAMENTO_CHAVE?.trim();
  if (!bruta) return null;
  return lerChave(bruta);
}

export function lerChave(bruta: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(bruta)) {
    throw new ErroCifra(
      "ARMAZENAMENTO_CHAVE tem de ser 64 hexadecimais (32 bytes). " +
        'Gera com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  const chave = Buffer.from(bruta, "hex");
  if (chave.length !== BYTES_CHAVE) throw new ErroCifra("Chave com tamanho inválido.");
  return chave;
}

export function cifrar(valor: unknown, chave: Buffer): EnvelopeCifrado {
  const iv = randomBytes(BYTES_IV);
  const cifrador = createCipheriv(ALGORITMO, chave, iv);
  const dados = Buffer.concat([
    cifrador.update(JSON.stringify(valor), "utf8"),
    cifrador.final(),
  ]);

  return {
    v: 1,
    alg: ALGORITMO,
    iv: iv.toString("base64"),
    tag: cifrador.getAuthTag().toString("base64"),
    dados: dados.toString("base64"),
  };
}

export function decifrar<T = unknown>(envelope: EnvelopeCifrado, chave: Buffer): T {
  if (envelope?.v !== 1 || envelope.alg !== ALGORITMO) {
    throw new ErroCifra("Envelope de cifra desconhecido.");
  }

  try {
    const decifrador = createDecipheriv(
      ALGORITMO,
      chave,
      Buffer.from(envelope.iv, "base64"),
    );
    decifrador.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const claro = Buffer.concat([
      decifrador.update(Buffer.from(envelope.dados, "base64")),
      decifrador.final(),
    ]);
    return JSON.parse(claro.toString("utf8")) as T;
  } catch {
    // The real cause does not surface: distinguishing "wrong key" from
    // "tampered envelope" is free information for whoever is trying.
    throw new ErroCifra(
      "Não foi possível decifrar os parâmetros de armazenamento. " +
        "A ARMAZENAMENTO_CHAVE mudou ou a linha foi alterada.",
    );
  }
}

/**
 * Constant-time secret comparison. Used where a value coming from outside is
 * compared with a stored one — comparing with `===` leaks the length of the
 * common prefix through the response time.
 */
export function iguais(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
