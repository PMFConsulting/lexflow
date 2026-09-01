import { afterEach, describe, expect, it, vi } from "vitest";
import {
  criarBucketSociedade,
  nomeBaseDoBucket,
  nomeComSufixo,
  normalizarSlug,
} from "./criar-bucket";
import { ErroServidor } from "./tipos";

/**
 * Mocked at `fetch`, like `s3.test.ts` — no test here ever talks to AWS.
 */

const CREDENCIAIS = {
  regiao: "eu-central-1",
  accessKeyId: "AKIAEXEMPLO",
  secretAccessKey: "segredo-de-teste",
};

const ORG_ID = "01926a3e-1234-7abc-9def-000000000001";

const espiarFetch = (impl: (url: string, opcoes?: RequestInit) => Promise<Response>) => {
  const espia = vi.fn(impl);
  vi.stubGlobal("fetch", espia);
  return espia;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizarSlug", () => {
  it("baixa para minúsculas, tira acentos e troca o resto por hífens", () => {
    expect(normalizarSlug("Andrade & Costa, Lda.")).toBe("andrade-costa-lda");
    expect(normalizarSlug("Bernardino Lopes")).toBe("bernardino-lopes");
  });

  it("nunca devolve vazio", () => {
    expect(normalizarSlug("###")).toBe("sociedade");
  });
});

describe("nomeBaseDoBucket", () => {
  it("prefixa com lexflow- e não ultrapassa 63 caracteres", () => {
    expect(nomeBaseDoBucket("PMF Consulting")).toBe("lexflow-pmf-consulting");

    const nomeEnorme = "a".repeat(100);
    const nome = nomeBaseDoBucket(nomeEnorme);
    expect(nome.length).toBeLessThanOrEqual(63);
    expect(nome.endsWith("-")).toBe(false);
  });
});

describe("nomeComSufixo", () => {
  it("acrescenta um sufixo curto e determinístico da organização", () => {
    const a = nomeComSufixo("lexflow-jmassano", ORG_ID);
    const b = nomeComSufixo("lexflow-jmassano", ORG_ID);
    expect(a).toBe(b);
    expect(a).toMatch(/^lexflow-jmassano-[0-9a-f]{8}$/);
    expect(a.length).toBeLessThanOrEqual(63);
  });

  it("corta a base para o sufixo caber dentro de 63 caracteres", () => {
    const baseEnorme = `lexflow-${"a".repeat(80)}`;
    const nome = nomeComSufixo(baseEnorme, ORG_ID);
    expect(nome.length).toBeLessThanOrEqual(63);
    expect(nome.endsWith(ORG_ID.replace(/-/g, "").slice(0, 8))).toBe(true);
  });
});

describe("criarBucketSociedade", () => {
  it("cria o bucket e aplica as três configurações, nessa ordem", async () => {
    const espia = espiarFetch(async () => new Response(null, { status: 200 }));

    const bucket = await criarBucketSociedade("JMASSANO", ORG_ID, CREDENCIAIS);

    expect(bucket).toBe("lexflow-jmassano");
    expect(espia).toHaveBeenCalledTimes(4);

    const [urlCriar] = espia.mock.calls[0] as [string, RequestInit];
    expect(urlCriar).toBe("https://lexflow-jmassano.s3.eu-central-1.amazonaws.com/");
    const [, opcoesCriar] = espia.mock.calls[0] as [string, RequestInit];
    expect(String(opcoesCriar.body)).toContain("<LocationConstraint>eu-central-1</LocationConstraint>");

    const [urlBloqueio] = espia.mock.calls[1] as [string, RequestInit];
    expect(urlBloqueio).toContain("?publicAccessBlock=");

    const [urlEncriptacao] = espia.mock.calls[2] as [string, RequestInit];
    expect(urlEncriptacao).toContain("?encryption=");

    const [urlVersionamento] = espia.mock.calls[3] as [string, RequestInit];
    expect(urlVersionamento).toContain("?versioning=");
  });

  it("numa colisão (409), tenta de novo com o sufixo da organização", async () => {
    let chamadas = 0;
    const espia = espiarFetch(async (url) => {
      chamadas++;
      if (chamadas === 1) return new Response("BucketAlreadyExists", { status: 409 });
      return new Response(null, { status: 200 });
    });

    const bucket = await criarBucketSociedade("JMASSANO", ORG_ID, CREDENCIAIS);

    expect(bucket).toBe(nomeComSufixo("lexflow-jmassano", ORG_ID));
    // 1ª tentativa (409) + criação com sufixo + 3 configurações
    expect(espia).toHaveBeenCalledTimes(5);
  });

  it("propaga como ErroServidor quando a criação do bucket falha de vez", async () => {
    espiarFetch(async () => new Response("Forbidden", { status: 403 }));

    await expect(criarBucketSociedade("JMASSANO", ORG_ID, CREDENCIAIS)).rejects.toBeInstanceOf(
      ErroServidor,
    );
  });

  it("propaga como ErroServidor quando uma configuração falha depois de o bucket existir", async () => {
    let chamadas = 0;
    espiarFetch(async () => {
      chamadas++;
      // Bucket criado (1ª chamada), bloqueio de acesso público falha (2ª).
      return new Response(null, { status: chamadas === 1 ? 200 : 500 });
    });

    await expect(criarBucketSociedade("JMASSANO", ORG_ID, CREDENCIAIS)).rejects.toBeInstanceOf(
      ErroServidor,
    );
  });

  it("assina cada pedido com SigV4 e inclui Content-MD5 nas configurações", async () => {
    const espia = espiarFetch(async () => new Response(null, { status: 200 }));

    await criarBucketSociedade("JMASSANO", ORG_ID, CREDENCIAIS);

    const [, opcoesCriar] = espia.mock.calls[0] as [string, RequestInit];
    const cabecalhosCriar = opcoesCriar.headers as Record<string, string>;
    expect(cabecalhosCriar.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXEMPLO\//);

    const [, opcoesBloqueio] = espia.mock.calls[1] as [string, RequestInit];
    const cabecalhosBloqueio = opcoesBloqueio.headers as Record<string, string>;
    expect(cabecalhosBloqueio["content-md5"]).toBeTruthy();
  });
});
