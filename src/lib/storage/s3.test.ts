import { afterEach, describe, expect, it, vi } from "vitest";
import { criarDestinoS3 } from "./s3";
import { ErroServidor } from "./tipos";
import type { ParametrosS3 } from "./tipos";

/**
 * The S3 driver, mocked at `fetch`: no test here ever talks to AWS. What
 * matters is the same as `servidor.test.ts` asked of SFTP — the bucket is the
 * society's own, the object path is the one the archive is searched by, and a
 * failure is never silent.
 */

const PARAMETROS_LEXFLOW: ParametrosS3 = {
  protocolo: "s3",
  regiao: "eu-central-1",
  bucket: "lexflow-jmassano",
  accessKeyId: "AKIAEXEMPLO",
  secretAccessKey: "segredo-de-teste",
};

const PARAMETROS_PMF: ParametrosS3 = {
  ...PARAMETROS_LEXFLOW,
  bucket: "lexflow-pmf-consulting",
};

const espiarFetch = (impl: (url: string, opcoes?: RequestInit) => Promise<Response>) => {
  const espia = vi.fn(impl);
  vi.stubGlobal("fetch", espia);
  return espia;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("criarDestinoS3 — enviar", () => {
  it("envia para o bucket da própria sociedade, nunca um partilhado", async () => {
    const espia = espiarFetch(async () => new Response(null, { status: 200 }));

    await criarDestinoS3(PARAMETROS_LEXFLOW).enviar(["Clientes", "Maria Silva (249886344)"], {
      nome: "summary.pdf",
      mime: "application/pdf",
      conteudo: Buffer.from("conteudo"),
    });

    const [url] = espia.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("lexflow-jmassano.s3.eu-central-1.amazonaws.com");

    espia.mockClear();
    await criarDestinoS3(PARAMETROS_PMF).enviar(["Clientes", "Ana"], {
      nome: "summary.pdf",
      mime: "application/pdf",
      conteudo: Buffer.from("x"),
    });
    const [urlPmf] = espia.mock.calls[0] as [string, RequestInit];
    expect(urlPmf).toContain("lexflow-pmf-consulting.s3.eu-central-1.amazonaws.com");
  });

  it("constrói a chave do objeto a partir dos segmentos, com o nome do ficheiro no fim", async () => {
    const espia = espiarFetch(async () => new Response(null, { status: 200 }));

    await criarDestinoS3(PARAMETROS_LEXFLOW).enviar(
      ["Clientes", "Maria Silva (249886344)", "PMF-2026-0001"],
      { nome: "summary.pdf", mime: "application/pdf", conteudo: Buffer.from("x") },
    );

    const [url] = espia.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://lexflow-jmassano.s3.eu-central-1.amazonaws.com/Clientes/Maria%20Silva%20(249886344)/PMF-2026-0001/summary.pdf",
    );
  });

  it("pede cifra do lado do servidor AES-256 em cada envio", async () => {
    const espia = espiarFetch(async () => new Response(null, { status: 200 }));

    await criarDestinoS3(PARAMETROS_LEXFLOW).enviar(["Clientes", "Ana"], {
      nome: "doc.pdf",
      mime: "application/pdf",
      conteudo: Buffer.from("x"),
    });

    const [, opcoes] = espia.mock.calls[0] as [string, RequestInit];
    const cabecalhos = opcoes.headers as Record<string, string>;
    expect(cabecalhos["x-amz-server-side-encryption"]).toBe("AES256");
    expect(cabecalhos["content-type"]).toBe("application/pdf");
  });

  it("assina o pedido com SigV4", async () => {
    const espia = espiarFetch(async () => new Response(null, { status: 200 }));

    await criarDestinoS3(PARAMETROS_LEXFLOW).enviar(["Clientes", "Ana"], {
      nome: "doc.pdf",
      mime: "application/pdf",
      conteudo: Buffer.from("x"),
    });

    const [, opcoes] = espia.mock.calls[0] as [string, RequestInit];
    const cabecalhos = opcoes.headers as Record<string, string>;
    expect(cabecalhos.Authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAEXEMPLO\/\d{8}\/eu-central-1\/s3\/aws4_request, SignedHeaders=.+, Signature=[0-9a-f]{64}$/,
    );
  });

  it("trata uma resposta de erro do S3 como ErroServidor", async () => {
    espiarFetch(async () => new Response("Access Denied", { status: 403 }));

    await expect(
      criarDestinoS3(PARAMETROS_LEXFLOW).enviar(["Clientes", "Ana"], {
        nome: "doc.pdf",
        mime: "application/pdf",
        conteudo: Buffer.from("x"),
      }),
    ).rejects.toBeInstanceOf(ErroServidor);
  });

  it("trata uma falha de rede como ErroServidor", async () => {
    espiarFetch(async () => {
      throw new Error("ECONNREFUSED");
    });

    await expect(
      criarDestinoS3(PARAMETROS_LEXFLOW).enviar(["Clientes", "Ana"], {
        nome: "doc.pdf",
        mime: "application/pdf",
        conteudo: Buffer.from("x"),
      }),
    ).rejects.toBeInstanceOf(ErroServidor);
  });
});

describe("criarDestinoS3 — garantirPasta", () => {
  it("não faz nenhum pedido — o S3 não tem pastas, só chaves", async () => {
    const espia = espiarFetch(async () => new Response(null, { status: 200 }));
    await criarDestinoS3(PARAMETROS_LEXFLOW).garantirPasta(["Clientes", "Ana"]);
    expect(espia).not.toHaveBeenCalled();
  });
});

describe("criarDestinoS3 — verificar", () => {
  it("confirma o bucket com um HEAD, sem escrever nada", async () => {
    const espia = espiarFetch(async () => new Response(null, { status: 200 }));

    const r = await criarDestinoS3(PARAMETROS_LEXFLOW).verificar();

    expect(r).toEqual({ ok: true, detalhe: "S3 acessível em lexflow-jmassano (eu-central-1)." });
    const [, opcoes] = espia.mock.calls[0] as [string, RequestInit];
    expect(opcoes.method).toBe("HEAD");
  });

  it("devolve ok:false quando o bucket não responde 200", async () => {
    espiarFetch(async () => new Response(null, { status: 404 }));

    const r = await criarDestinoS3(PARAMETROS_LEXFLOW).verificar();
    expect(r.ok).toBe(false);
    expect(r.detalhe).toContain("404");
  });

  it("nunca propaga — uma falha de rede também vira ok:false", async () => {
    espiarFetch(async () => {
      throw new Error("network down");
    });

    const r = await criarDestinoS3(PARAMETROS_LEXFLOW).verificar();
    expect(r.ok).toBe(false);
  });
});
