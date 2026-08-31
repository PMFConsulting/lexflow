import { describe, expect, it } from "vitest";
import { moldura, urlLogotipoSociedade } from "./moldura";

/**
 * O Gmail Mobile bloqueia/adia imagens com data-URI base64 por poupança de dados.
 * `urlLogotipoSociedade` passa a devolver um URL HTTP público estável
 * (/api/sociedade/logotipo/[id]) e nunca um data-URI.
 *
 * Para SVG (não suportado pelo Gmail em <img>) ou sociedade sem logotipo,
 * o fallback devolve o URL público do logo por omissão (/lexflow.png).
 */
describe("urlLogotipoSociedade", () => {
  it("devolve o URL público (não data-URI) para um logotipo PNG", () => {
    const url = urlLogotipoSociedade({
      id: "org-1",
      logotipoDados: "QUJD",
      logotipoMime: "image/png",
    });

    expect(url).toContain("/api/sociedade/logotipo/org-1");
    expect(url.startsWith("data:")).toBe(false);
  });

  it("nunca devolve um data-URI de SVG — devolve o URL público do logo por omissão", () => {
    const url = urlLogotipoSociedade({
      id: "org-1",
      logotipoDados: "PHN2Zz4=",
      logotipoMime: "image/svg+xml",
    });

    expect(url).toContain("/lexflow.png");
    expect(url.startsWith("data:")).toBe(false);
  });

  it("sem logotipo ou org nula, devolve o URL público do logo por omissão", () => {
    expect(urlLogotipoSociedade({ id: "org-1", logotipoDados: null })).toContain("/lexflow.png");
    expect(urlLogotipoSociedade(null)).toContain("/lexflow.png");
    expect(urlLogotipoSociedade(undefined)).toContain("/lexflow.png");
  });
});

describe("moldura — transporte do logotipo", () => {
  it("usa o lexflow.png por omissão, nunca o .svg (bloqueado pelo Gmail)", () => {
    const html = moldura("<p>corpo</p>");

    expect(html).toContain("/lexflow.png");
    expect(html).not.toContain("/lexflow.svg");
    expect(html).not.toContain("data:image");
  });

  it("renderiza <img src=\"URL\"> com o URL público quando fornecido", () => {
    const urlPublica = "https://lexflow.terlicalabs.com/api/sociedade/logotipo/org-123";
    const html = moldura("<p>corpo</p>", undefined, urlPublica);

    expect(html).toContain(`<img src="${urlPublica}"`);
    expect(html).not.toContain("data:image");
  });
});
