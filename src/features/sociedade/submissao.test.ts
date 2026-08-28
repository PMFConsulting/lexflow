import { beforeEach, describe, expect, it, vi } from "vitest";

type Escrita = Record<string, unknown>;

let acessoDevolve: "ok" | "desconhecido" = "ok";
let orgMock: Escrita = {};
let onboardingMock: Escrita = {};
let docsMock: { id: string; nome: string; tipo: string; bytes: number; criadoEm: Date }[] = [];
const atualizacoes: Escrita[] = [];
const insercoes: { tabela: string; valores: Escrita }[] = [];

vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "1.2.3.4", "user-agent": "vitest" }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c,
  eq: (coluna: unknown, valor: unknown) => ({ coluna, valor }),
  isNull: (c: unknown) => c,
  sql: (...c: unknown[]) => c,
}));

vi.mock("@/db/schema/organizacao", () => ({
  organizacao: { id: "organizacao.id" },
}));

vi.mock("@/db/schema/sociedade", () => ({
  onboardingSociedade: { id: "onboardingSociedade.id" },
  documentoOrganizacao: { id: "documentoOrganizacao.id" },
  conviteUtilizador: { id: "conviteUtilizador.id" },
}));

vi.mock("@/db", () => ({
  db: () => ({
    update: () => ({
      set: (v: Escrita) => ({
        where: async () => {
          atualizacoes.push(v);
        },
      }),
    }),
    insert: (t: unknown) => ({
      values: (v: Escrita) => ({
        returning: async () => {
          insercoes.push({ tabela: String(t), valores: v });
          return [{ id: "convite-1" }];
        },
      }),
    }),
  }),
}));

vi.mock("./dados", async () => {
  const actual = await vi.importActual<typeof import("./dados")>("./dados");
  return {
    ...actual,
    acessoSociedadePorToken: async () => {
      if (acessoDevolve === "desconhecido") return { estado: "desconhecido" };
      return {
        estado: "ok",
        org: orgMock,
        onboarding: onboardingMock,
        token: "token-limpo",
      };
    },
    documentosDaSociedade: async () => docsMock,
  };
});

vi.mock("@/features/auditoria/registar", () => ({
  registarEvento: async () => {},
}));

vi.mock("@/lib/email", () => ({
  enviarEmail: async () => ({ ok: true, canal: "resend", mensagemId: "m-1" }),
}));

vi.mock("@/lib/origem", () => ({
  origemPublica: async () => "https://poc.terlicalabs.com",
}));

const { submeterSociedade } = await import("./acoes");

beforeEach(() => {
  acessoDevolve = "ok";
  orgMock = {
    id: "org-1",
    nome: "Sociedade Teste",
    nif: "501234567",
    naturezaJuridica: "sociedade_unipessoal",
    morada: "Rua A, 1",
    codigoPostal: "1000-001",
    emailGeral: "geral@sociedade.pt",
    termosDocumentoRef: "termos/ref1",
    termosVersao: "v1",
  };
  onboardingMock = {
    id: "onb-1",
    adminNome: "Admin Silva",
    adminEmail: "admin@sociedade.pt",
    declaracaoVinculo: true,
    estado: "rascunho",
  };
  docsMock = [{ id: "doc-1", nome: "certidao.pdf", tipo: "certidao_sociedade", bytes: 1000, criadoEm: new Date() }];
  atualizacoes.length = 0;
  insercoes.length = 0;
});

describe("submeterSociedade (BUG-002)", () => {
  it("recusa a submissão quando faltam os passos 1 a 3", async () => {
    // Missing step 1 (no nif), step 2 (no morada), step 3 (no certidao)
    orgMock = {
      id: "org-1",
      nome: "Sociedade Incompleta",
      nif: null,
      naturezaJuridica: null,
      morada: null,
      codigoPostal: null,
      emailGeral: null,
      termosDocumentoRef: "termos/ref1",
      termosVersao: "v1",
    };
    docsMock = []; // no certidao_sociedade

    const r = await submeterSociedade("token-limpo");

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.mensagem).toMatch(/Passo 1/i);
      expect(r.mensagem).toMatch(/Passo 2/i);
      expect(r.mensagem).toMatch(/Passo 3/i);
    }
    // Should NOT have updated onboarding state in database
    expect(atualizacoes).toHaveLength(0);
    expect(insercoes).toHaveLength(0);
  });

  it("submete com sucesso quando todos os 6 passos estão completos", async () => {
    const r = await submeterSociedade("token-limpo");

    expect(r.ok).toBe(true);
    expect(atualizacoes).toContainEqual(
      expect.objectContaining({
        estado: "submetido",
        submetidoEm: expect.any(Date),
      }),
    );
    expect(insercoes).toContainEqual(
      expect.objectContaining({
        valores: expect.objectContaining({
          email: "admin@sociedade.pt",
          nome: "Admin Silva",
          papel: "society_admin",
        }),
      }),
    );
  });
});
