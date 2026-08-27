import { describe, expect, it, vi, beforeEach } from "vitest";

let sessaoMock: { eu?: { id: string; papel: string; organizacaoId: string | null } } | null = null;
let orgsDb: Record<string, { logotipoDados: string; logotipoMime: string; logotipoNome: string }> = {};

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c,
  eq: (...c: unknown[]) => c,
  isNull: (...c: unknown[]) => c,
}));

vi.mock("@/db/schema/organizacao", () => ({
  organizacao: "organizacao",
}));

vi.mock("@/lib/sessao", () => ({
  sessaoAtual: async () => sessaoMock,
}));

vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            const org = Object.values(orgsDb)[0];
            return org ? [org] : [];
          },
        }),
      }),
    }),
  }),
}));

import { GET } from "./route";

describe("GET /api/sociedade/logotipo — Proteção contra Enumeração", () => {
  beforeEach(() => {
    sessaoMock = null;
    orgsDb = {};
  });

  it("recusa pedido com ?sociedadeId= quando não existe sessão iniciada (401)", async () => {
    sessaoMock = null;
    const req = new Request("https://lexflow.pt/api/sociedade/logotipo?sociedadeId=0197a1c0-0000-7000-8000-000000000001");
    const res = await GET(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.erro).toBe("Sessão não autenticada.");
  });

  it("recusa pedido direto sem sessão (401)", async () => {
    sessaoMock = null;
    const req = new Request("https://lexflow.pt/api/sociedade/logotipo");
    const res = await GET(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.erro).toBe("Sessão não autenticada.");
  });

  it("recusa acesso a sociedade de terceiros por utilizador de outra sociedade (403)", async () => {
    sessaoMock = {
      eu: {
        id: "u-1",
        papel: "society_admin",
        organizacaoId: "0197a1c0-0000-7000-8000-000000000001",
      },
    };
    const req = new Request("https://lexflow.pt/api/sociedade/logotipo?sociedadeId=0197a1c0-0000-7000-8000-000000000002");
    const res = await GET(req);

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.erro).toBe("Acesso não autorizado.");
  });

  it("permite acesso ao logótipo da própria sociedade quando autenticado", async () => {
    sessaoMock = {
      eu: {
        id: "u-1",
        papel: "society_admin",
        organizacaoId: "0197a1c0-0000-7000-8000-000000000001",
      },
    };
    orgsDb["0197a1c0-0000-7000-8000-000000000001"] = {
      logotipoDados: Buffer.from("png-bytes").toString("base64"),
      logotipoMime: "image/png",
      logotipoNome: "logo.png",
    };

    const req = new Request("https://lexflow.pt/api/sociedade/logotipo");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
  });
});
