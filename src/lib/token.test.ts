import { describe, expect, it } from "vitest";
import { gerarToken, hashToken, normalizarToken, novoTokenAcesso } from "./token";

/**
 * O token do link mágico, do lado em que um link válido dá 404.
 *
 * São duas as maneiras de isso acontecer, e as duas se leem da mesma forma no
 * ecrã do cliente — "esta página não existe" — sem nada que distinga uma da
 * outra: ou o hash gravado não é o daquele token, ou o token que chega ao
 * servidor não é o que saiu daqui.
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
 * O que um token apanha entre o email e o servidor.
 *
 * Nenhum destes caracteres pode fazer parte de um token, e qualquer um deles
 * muda o SHA-256 por inteiro: o processo está lá, o link é o certo, e a
 * consulta por hash não devolve nada. É a forma mais banal de um link mágico
 * válido dar 404, e a mais difícil de acreditar — o URL, a olho, parece bem.
 *
 * Os invisíveis entram por código (`String.fromCharCode`) e não à letra: um
 * espaço duro e um espaço normal são a mesma coisa a olho e não são a mesma
 * coisa para o SHA-256, que é precisamente o defeito em teste. Escritos em cru
 * no ficheiro, o primeiro editor que "arrume os espaços" apagava o caso sem
 * ninguém dar por isso.
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
    // E — o que interessa de facto — passa a encontrar a mesma linha.
    expect(hashToken(sujo)).toBe(hashToken(t));
  });

  it("não mexe no meio: um token corrompido continua corrompido", () => {
    // Limpar o interior faria de um token partido um token possivelmente
    // válido, que é esconder a avaria em vez de a resolver.
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
