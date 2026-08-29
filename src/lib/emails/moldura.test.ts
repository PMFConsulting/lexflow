import { describe, expect, it } from "vitest";
import { moldura, urlLogotipoSociedade } from "./moldura";

/**
 * O logo SVG nunca aparece no Gmail — bug reportado pelo cliente (PMF
 * Consulting). `urlLogotipoSociedade` deixa de devolver um `data:image/svg+xml`
 * e cai para o logo por omissão, que por sua vez passa a `.png`.
 */
describe("urlLogotipoSociedade", () => {
  it("devolve o data-URI para um logotipo PNG", () => {
    const url = urlLogotipoSociedade({
      id: "org-1",
      logotipoDados: "QUJD",
      logotipoMime: "image/png",
    });

    expect(url).toBe("data:image/png;base64,QUJD");
  });

  it("nunca devolve um data-URI de SVG — cai para o logo por omissão", () => {
    const url = urlLogotipoSociedade({
      id: "org-1",
      logotipoDados: "PHN2Zz4=",
      logotipoMime: "image/svg+xml",
    });

    expect(url).toBeNull();
  });

  it("sem logotipo, devolve null", () => {
    expect(urlLogotipoSociedade({ id: "org-1", logotipoDados: null })).toBeNull();
    expect(urlLogotipoSociedade(null)).toBeNull();
  });
});

describe("moldura — logo por omissão", () => {
  it("usa o lexflow.png, nunca o .svg (bloqueado pelo Gmail)", () => {
    const html = moldura("<p>corpo</p>");

    expect(html).toContain("/lexflow.png");
    expect(html).not.toContain("/lexflow.svg");
  });
});
