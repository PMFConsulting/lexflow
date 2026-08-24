import { describe, expect, it } from "vitest";
import { gerarToken, hashToken, normalizarToken, novoTokenAcesso } from "./token";

/**
 * The magic link token, from the side where a valid link gives a 404.
 *
 * There are two ways for that to happen, and both read the same way on the
 * client's screen — "this page does not exist" — with nothing to tell one from
 * the other: either the stored hash is not that token's, or the token reaching
 * the server is not the one that left here.
 */

describe("novoTokenAcesso — o par não pode divergir", () => {
  it("o hash devolvido é o hash do token devolvido", () => {
    const { token, hash } = novoTokenAcesso();
    expect(hash).toBe(hashToken(token));
  });

  it("cada chamada dá um token diferente", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => novoTokenAcesso().token));
    expect(tokens.size).toBe(50);
  });

  it("o token cabe num URL sem precisar de codificação", () => {
    const { token } = novoTokenAcesso();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(encodeURIComponent(token)).toBe(token);
  });
});

/**
 * What a token picks up between the email and the server.
 *
 * None of these characters can be part of a token, and any one of them changes
 * the SHA-256 entirely: the matter is there, the link is the right one, and the
 * lookup by hash returns nothing. It is the most banal way for a valid magic
 * link to give a 404, and the hardest to believe — the URL, by eye, looks fine.
 *
 * The invisible ones go in by code (`String.fromCharCode`) and not literally: a
 * hard space and a normal space are the same thing by eye and are not the same
 * thing to SHA-256, which is precisely the defect under test. Written raw in
 * the file, the first editor that "tidies up the whitespace" would erase the
 * case with nobody noticing.
 */
describe("normalizarToken — a sujidade das pontas", () => {
  const t = "abcDEF123_-abcDEF123_-abcDEF123_-abcDEF123x";
  const NBSP = String.fromCharCode(160);
  const ZWSP = String.fromCharCode(8203);

  it.each([
    ["espaços à volta", `  ${t}  `],
    ["o ponto final da frase em que o link ia", `${t}.`],
    ["os sinais com que o Outlook envolve endereços", `<${t}>`],
    ["um parêntesis de citação", `(${t})`],
    ["a barra final que o browser acrescenta", `${t}/`],
    ["um espaço duro à direita", `${t}${NBSP}`],
    ["espaços de largura zero dos dois lados", `${ZWSP}${t}${ZWSP}`],
    ["uma quebra de linha da cópia", `${t}\r\n`],
    ["um tabulador", `\t${t}\t`],
    ["aspas de uma colagem", `"${t}"`],
    ["uma vírgula de enumeração", `${t},`],
  ])("limpa %s", (_caso, sujo) => {
    expect(normalizarToken(sujo)).toBe(t);
    // And — what actually matters — it now finds the same row.
    expect(hashToken(sujo)).toBe(hashToken(t));
  });

  it("não mexe no meio: um token corrompido continua corrompido", () => {
    // Cleaning the middle would turn a broken token into a possibly valid one,
    // which is hiding the fault instead of fixing it.
    const partido = "abcDEF123_-abc DEF123_-abcDEF123_-abcDEF123x";
    expect(normalizarToken(partido)).toBe(partido);
    expect(hashToken(partido)).not.toBe(hashToken(t));
  });

  it("um token limpo passa incólume", () => {
    const { token } = novoTokenAcesso();
    expect(normalizarToken(token)).toBe(token);
  });

  it("uma cadeia sem uma única letra do alfabeto fica vazia", () => {
    expect(normalizarToken("   ")).toBe("");
    expect(normalizarToken("")).toBe("");
  });
});

describe("hashToken", () => {
  it("é estável e normaliza antes de calcular", () => {
    const token = gerarToken();
    expect(hashToken(token)).toBe(hashToken(` ${token} `));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});
