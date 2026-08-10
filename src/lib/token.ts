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
  return createHash("sha256").update(normalizarToken(token)).digest("hex");
}

/**
 * O token em claro e o seu hash, gerados **de uma vez**.
 *
 * Estavam separados, e quem criava o processo hashava à mão o que tinha
 * acabado de gerar. Funciona enquanto ninguém mexer nas duas linhas — e o dia
 * em que uma delas passar a hashar outra coisa (um token renovado, um valor
 * normalizado a meio) dá um processo gravado com um hash que não corresponde a
 * link nenhum: o cliente recebe o endereço, a consulta por hash não encontra
 * nada, e o que ele vê é um 404 sem explicação possível.
 *
 * Devolvendo o par, essa divergência deixa de ser escrevível. Quem grava não
 * escolhe o que hasha; recebe o hash daquele token e não tem outro à mão.
 */
export function novoTokenAcesso(): { token: string; hash: string } {
  const token = gerarToken();
  return { token, hash: hashToken(token) };
}

/** O alfabeto do `base64url` — as únicas letras que um token nosso tem. */
const ALFABETO = /[A-Za-z0-9_-]/;

/**
 * Limpa um token vindo de fora antes de o procurar.
 *
 * Um token nosso são 43 caracteres de `base64url`, e o que chega ao servidor
 * passou por um cliente de email, por uma colagem e por um browser. Pelo
 * caminho apanha coisas que **não fazem parte dele**: o ponto final da frase em
 * que o link ia, os `<` e `>` com que o Outlook envolve endereços, um espaço
 * duro colado à direita, um `/` final que o browser acrescenta, um `​` que
 * o webmail meteu para poder quebrar a linha.
 *
 * Nenhum desses caracteres pode existir num token, e mesmo assim qualquer um
 * deles muda o SHA-256 por inteiro — o processo está lá, o link é o certo, e a
 * consulta não devolve nada. É a forma mais banal de um link mágico válido dar
 * 404, e a mais difícil de acreditar quando se olha para o URL e ele *parece*
 * bem.
 *
 * Só se corta **nas pontas**, e de propósito: limpar o meio faria de um token
 * corrompido um token possivelmente válido, que é esconder a avaria em vez de
 * a resolver. Nas pontas não há esse risco — um token tem comprimento fixo e
 * nenhum é prefixo de outro.
 */
export function normalizarToken(bruto: string): string {
  let inicio = 0;
  let fim = bruto.length;
  while (inicio < fim && !ALFABETO.test(bruto[inicio])) inicio++;
  while (fim > inicio && !ALFABETO.test(bruto[fim - 1])) fim--;
  return bruto.slice(inicio, fim);
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
