import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `origemPublica` — the host used to build the links that go out by email.
 *
 * What was here read `x-forwarded-host ?? host` and returned it as-is. Both
 * headers are written by whoever makes the request, and the consequence was not
 * an ugly link: the registration email carries the **plaintext token** in the
 * path (`/onboarding/<token>`), that token is the case file's only
 * authentication factor and is valid for 30 days (D4). A `POST` to the Server
 * Action with `X-Forwarded-Host: attacker.pt` made the platform write, itself,
 * the case file's secret to an address of a third party's choosing — and send
 * it to the client with the firm as sender, for them to click.
 *
 * The rule becomes a one-value allowlist: the host configured in
 * `BETTER_AUTH_URL`. It fails closed — a request with any other host produces
 * no link at all, because a good-looking link carrying the secret is worse than
 * a missing link.
 */

let cabecalhos = new Headers();
let urlConfigurado = "https://poc.terlicalabs.com";

vi.mock("next/headers", () => ({ headers: async () => cabecalhos }));
vi.mock("@/env", () => ({ env: () => ({ BETTER_AUTH_URL: urlConfigurado }) }));

const { origemPublica } = await import("./origem");

beforeEach(() => {
  cabecalhos = new Headers();
  urlConfigurado = "https://poc.terlicalabs.com";
});

describe("origemPublica", () => {
  it("devolve o endereço configurado quando o anfitrião bate certo", async () => {
    cabecalhos = new Headers({ host: "poc.terlicalabs.com" });
    expect(await origemPublica()).toBe("https://poc.terlicalabs.com");
  });

  it("ignora o x-forwarded-host por completo", async () => {
    cabecalhos = new Headers({
      host: "poc.terlicalabs.com",
      "x-forwarded-host": "atacante.pt",
      "x-forwarded-proto": "http",
    });

    // Neither the host nor the protocol comes from the request: both come from
    // the same place and neither is trustworthy.
    expect(await origemPublica()).toBe("https://poc.terlicalabs.com");
  });

  it("recusa um Host que não está na allowlist, em vez de o usar", async () => {
    cabecalhos = new Headers({ host: "atacante.pt" });

    await expect(origemPublica()).rejects.toThrow("Anfitrião não reconhecido");
  });

  it("um Host com a porta explícita do esquema continua a ser o mesmo anfitrião", async () => {
    cabecalhos = new Headers({ host: "poc.terlicalabs.com:443" });
    expect(await origemPublica()).toBe("https://poc.terlicalabs.com");
  });

  it("em desenvolvimento vale o localhost com porta, tal como está configurado", async () => {
    urlConfigurado = "http://localhost:3000";
    cabecalhos = new Headers({ host: "localhost:3000" });

    expect(await origemPublica()).toBe("http://localhost:3000");
  });

  it("uma porta diferente da configurada não passa por a mesma máquina", async () => {
    urlConfigurado = "http://localhost:3000";
    cabecalhos = new Headers({ host: "localhost:9999" });

    await expect(origemPublica()).rejects.toThrow("Anfitrião não reconhecido");
  });

  /**
   * Outside an HTTP request there is nothing to compare — that is the case of a
   * script or a task building a link. The configured value is the only possible
   * answer, and it is the right one.
   */
  it("sem cabeçalho de anfitrião, usa o configurado sem se queixar", async () => {
    expect(await origemPublica()).toBe("https://poc.terlicalabs.com");
  });
});
