import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Tokens do link mágico.
 *
 * O token em claro existe uma vez, no email. Na base de dados guarda-se só o
 * SHA-256 — quem tiver acesso de leitura à BD não fica com a chave de todos os
 * dossiers dos clientes.
 */

export function gerarToken(): string {
  // 32 bytes em base64url: curto o suficiente para caber num link e largo o
  // suficiente para não se adivinhar.
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Comparação em tempo constante. Numa comparação normal, o tempo de resposta
 * varia com quantos caracteres batem certo — o que deixa adivinhar o token byte
 * a byte. Aqui não.
 */
export function tokensIguais(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** 30 dias, renovável pelo responsável (ambiguidade A15). */
export function expiraDaquiA(dias = 30): Date {
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
}
