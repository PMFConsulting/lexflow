import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `origemPublica` — o anfitrião com que se montam os links que saem por email.
 *
 * O que aqui estava lia `x-forwarded-host ?? host` e devolvia-o tal e qual. Os
 * dois cabeçalhos são escritos por quem faz o pedido, e a consequência não era
 * um link feio: o email de registo leva o **token em claro** no caminho
 * (`/onboarding/<token>`), esse token é o único fator de autenticação do
 * dossier e vale 30 dias (D4). Um `POST` à Server Action com
 * `X-Forwarded-Host: atacante.pt` fazia a plataforma escrever, ela própria, o
 * segredo do dossier num endereço à escolha de terceiros — e enviá-lo ao
 * cliente com o remetente da sociedade, para ele carregar.
 *
 * A régua passa a ser uma allowlist de um valor só: o anfitrião configurado em
 * `BETTER_AUTH_URL`. Falha fechada — um pedido com outro anfitrião não produz
 * link nenhum, porque um link com ar de bom que leva o segredo é pior do que um
 * link em falta.
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

    // Nem o anfitrião nem o protocolo saem do pedido: os dois vêm do mesmo
    // sítio e nenhum é de confiança.
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
   * Fora de um pedido HTTP não há nada a comparar — é o caso de um script ou de
   * uma tarefa a montar um link. O valor configurado é a única resposta
   * possível, e é a certa.
   */
  it("sem cabeçalho de anfitrião, usa o configurado sem se queixar", async () => {
    expect(await origemPublica()).toBe("https://poc.terlicalabs.com");
  });
});
