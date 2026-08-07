import { describe, expect, it } from "vitest";
import { citarSftp, criarDestinoServidor, urlSftp } from "./servidor";
import type { ParametrosServidor } from "./tipos";

/**
 * Os dois sítios onde o nome de uma pasta de cliente sai daqui para fora: o URL
 * que o curl recebe e o comando `-Q mkdir`. Ambos partiam num espaço, e uma
 * pasta chama-se "Maria Silva (249886344)".
 */

const BASE: ParametrosServidor = {
  protocolo: "sftp",
  host: "arquivo.exemplo.pt",
  utilizador: "pmf",
  segredo: "s3gr3d0",
};

describe("urlSftp", () => {
  it("percent-encode dos segmentos", () => {
    expect(urlSftp(BASE, ["Clientes", "Maria Silva (249886344)", "PMF-2026-0001"])).toBe(
      "sftp://arquivo.exemplo.pt/Clientes/Maria%20Silva%20(249886344)/PMF-2026-0001",
    );
  });

  it("não deixa passar um espaço nem um acento em cru", () => {
    const url = urlSftp(BASE, ["Clientes", "António Sá"]);
    expect(url).not.toContain(" ");
    expect(url).toContain("Ant%C3%B3nio%20S%C3%A1");
  });

  it("aceita o caminho base e a porta", () => {
    expect(urlSftp({ ...BASE, porta: 2222, caminhoBase: "/dados/arquivo" }, ["Clientes"])).toBe(
      "sftp://arquivo.exemplo.pt:2222/dados/arquivo/Clientes",
    );
  });

  it("tira o esquema e o que venha atrás do host", () => {
    expect(urlSftp({ ...BASE, host: "sftp://arquivo.exemplo.pt/ignorado" }, ["Clientes"])).toBe(
      "sftp://arquivo.exemplo.pt/Clientes",
    );
  });

  it("sem segmentos, fica na raiz", () => {
    expect(urlSftp(BASE, [])).toBe("sftp://arquivo.exemplo.pt/");
  });
});

describe("citarSftp", () => {
  it("mete o caminho entre aspas para o comando não truncar no espaço", () => {
    expect(citarSftp("/Clientes/Maria Silva (249886344)")).toBe(
      '"/Clientes/Maria Silva (249886344)"',
    );
  });

  it("escapa as aspas e as barras invertidas", () => {
    expect(citarSftp('/a"b')).toBe('"/a\\"b"');
    expect(citarSftp("/a\\b")).toBe('"/a\\\\b"');
  });
});

describe("criarDestinoServidor", () => {
  it("devolve um destino com o contrato completo", () => {
    const destino = criarDestinoServidor(BASE);

    expect(typeof destino.garantirPasta).toBe("function");
    expect(typeof destino.enviar).toBe("function");
    expect(typeof destino.verificar).toBe("function");
  });
});
