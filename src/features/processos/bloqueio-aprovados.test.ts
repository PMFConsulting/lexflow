import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { atualizarSeccaoProcesso } from "./acoes";
import { carregarPropostaComercial } from "./proposta";

type Linha = Record<string, unknown>;

let processoMock: {
  id: string;
  organizacaoId: string;
  referencia: string;
  estado: string;
  tipoCliente: string;
  passoAtual: number;
} | null = null;

const auditados: Linha[] = [];

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "127.0.0.1", "user-agent": "vitest" }),
}));

vi.mock("@/features/auditoria/registar", () => ({
  registarEvento: async (e: Linha) => {
    auditados.push(e);
  },
}));

vi.mock("@/lib/sessao", () => ({
  exigirEquipaOuSuperAdmin: async () => ({
    eu: {
      id: "user-1",
      papel: "society_admin",
      organizacaoId: "org-1",
    },
  }),
  podeAcederSociedade: () => true,
  podeAprovarProcesso: () => true,
}));

vi.mock("@/db", () => {
  return {
    db: () => ({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => (processoMock ? [processoMock] : []),
          }),
        }),
      }),
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: () => Promise.resolve(),
          returning: () => Promise.resolve([{ id: "doc-1", nome: "proposta.pdf" }]),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => Promise.resolve(),
        }),
      }),
      delete: () => ({
        where: () => Promise.resolve(),
      }),
    }),
  };
});

vi.mock("@/features/onboarding/formatos", () => ({
  assinaturaConfere: () => true,
  mensagemConteudo: () => "Ficheiro inválido",
}));

beforeEach(() => {
  auditados.length = 0;
  processoMock = {
    id: "proc-1",
    organizacaoId: "org-1",
    referencia: "PMF-2026-0001",
    estado: "aguardar_aprovacao",
    tipoCliente: "particular",
    passoAtual: 7,
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("bloqueio de edição de processos aprovados ou arquivados (Frente D)", () => {
  it("recusa atualizarSeccaoProcesso quando estado = aprovado", async () => {
    processoMock!.estado = "aprovado";

    const res = await atualizarSeccaoProcesso("proc-1", 1, {
      nome: "Novo Nome",
      nacionalidades: ["Portugal"],
    });

    expect(res).toEqual({
      ok: false,
      erro: "Processo aprovado — já não é editável.",
    });
  });

  it("recusa atualizarSeccaoProcesso quando estado = arquivado", async () => {
    processoMock!.estado = "arquivado";

    const res = await atualizarSeccaoProcesso("proc-1", 2, {
      nif: "123456789",
    });

    expect(res).toEqual({
      ok: false,
      erro: "Processo aprovado — já não é editável.",
    });
  });

  it("permite atualizarSeccaoProcesso quando processo está em revisão ou a aguardar aprovação", async () => {
    processoMock!.estado = "aguardar_aprovacao";

    const res = await atualizarSeccaoProcesso("proc-1", 1, {
      nome: "Novo Nome",
      nacionalidades: ["Portugal"],
    });

    expect(res.ok).toBe(true);
  });

  it("recusa carregarPropostaComercial quando estado = aprovado", async () => {
    processoMock!.estado = "aprovado";

    const formData = new FormData();
    const pdfBlob = new Blob(["%PDF-1.4 dummy content"], { type: "application/pdf" });
    const file = new File([pdfBlob], "proposta.pdf", { type: "application/pdf" });
    formData.set("ficheiro", file);

    const res = await carregarPropostaComercial("proc-1", formData);

    expect(res).toEqual({
      ok: false,
      erro: "Processo aprovado — já não é editável.",
    });
  });
});
