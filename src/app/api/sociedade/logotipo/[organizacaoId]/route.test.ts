import { describe, expect, it, vi, beforeEach } from "vitest";

let orgsDb: Record<
  string,
  { logotipoDados: string | null; logotipoMime: string | null; logotipoNome: string | null }
> = {};

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c,
  eq: (...c: unknown[]) => c,
  isNull: (...c: unknown[]) => c,
}));

vi.mock("@/db/schema/organizacao", () => ({
  organizacao: {
    id: "id",
    logotipoDados: "logotipoDados",
    logotipoMime: "logotipoMime",
    logotipoNome: "logotipoNome",
    apagadoEm: "apagadoEm",
  },
}));

vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: (conditions: unknown) => ({
          limit: async () => {
            // Find matched org from mock database
            const orgId = Object.keys(orgsDb)[0];
            const org = orgId ? orgsDb[orgId] : undefined;
            return org ? [org] : [];
          },
        }),
      }),
    }),
  }),
}));

import { GET } from "./route";

describe("GET /api/sociedade/logotipo/[organizacaoId] — Acesso Público para Emails", () => {
  beforeEach(() => {
    orgsDb = {};
  });

  it("recusa identificador de sociedade com formato inválido (404)", async () => {
    const req = new Request("https://lexflow.pt/api/sociedade/logotipo/invalido");
    const res = await GET(req, {
      params: Promise.resolve({ organizacaoId: "invalido" }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.erro).toBe("Identificador de sociedade inválido.");
  });

  it("devolve 404 quando a sociedade não existe na BD", async () => {
    orgsDb = {};
    const req = new Request(
      "https://lexflow.pt/api/sociedade/logotipo/0197a1c0-0000-7000-8000-000000000001",
    );
    const res = await GET(req, {
      params: Promise.resolve({ organizacaoId: "0197a1c0-0000-7000-8000-000000000001" }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.erro).toBe("Esta sociedade não tem logótipo configurado.");
  });

  it("devolve 404 quando a sociedade não tem logótipo configurado", async () => {
    orgsDb["0197a1c0-0000-7000-8000-000000000001"] = {
      logotipoDados: null,
      logotipoMime: null,
      logotipoNome: null,
    };
    const req = new Request(
      "https://lexflow.pt/api/sociedade/logotipo/0197a1c0-0000-7000-8000-000000000001",
    );
    const res = await GET(req, {
      params: Promise.resolve({ organizacaoId: "0197a1c0-0000-7000-8000-000000000001" }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.erro).toBe("Esta sociedade não tem logótipo configurado.");
  });

  it("serve o logótipo PNG publicamente sem sessão com cabeçalhos de cache de 24h", async () => {
    const dadosPng = Buffer.from("imagem-png-simulada");
    orgsDb["0197a1c0-0000-7000-8000-000000000001"] = {
      logotipoDados: dadosPng.toString("base64"),
      logotipoMime: "image/png",
      logotipoNome: "escritorio.png",
    };

    const req = new Request(
      "https://lexflow.pt/api/sociedade/logotipo/0197a1c0-0000-7000-8000-000000000001",
    );
    const res = await GET(req, {
      params: Promise.resolve({ organizacaoId: "0197a1c0-0000-7000-8000-000000000001" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400, immutable");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Length")).toBe(String(dadosPng.length));

    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.toString()).toBe("imagem-png-simulada");
  });

  it("serve logótipo JPEG com o MIME correto e cache longa", async () => {
    const dadosJpeg = Buffer.from("imagem-jpeg-simulada");
    orgsDb["0197a1c0-0000-7000-8000-000000000001"] = {
      logotipoDados: dadosJpeg.toString("base64"),
      logotipoMime: "image/jpeg",
      logotipoNome: "logo.jpg",
    };

    const req = new Request(
      "https://lexflow.pt/api/sociedade/logotipo/0197a1c0-0000-7000-8000-000000000001",
    );
    const res = await GET(req, {
      params: Promise.resolve({ organizacaoId: "0197a1c0-0000-7000-8000-000000000001" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400, immutable");
  });
});
