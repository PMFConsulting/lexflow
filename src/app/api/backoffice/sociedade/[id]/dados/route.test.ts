import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A rota de exportação/eliminação de dados da sociedade.
 *
 * O que aqui se fixa é a **fronteira**: quem pode pedir o quê, e como o
 * DELETE pede a simulação por omissão. O comportamento das funções de serviço
 * está coberto em `features/sociedade/direitos.test.ts`.
 */

const ID_SOCIEDADE = "018f1e2a-0000-7000-8000-000000000001";

const exportarMock = vi.fn(async (organizacaoId: string) => ({
  geradoEm: new Date(),
  plataforma: "LexFlow",
  sociedade: { id: organizacaoId, nome: "Sociedade Exemplo" },
  onboarding: null,
  utilizadores: [],
  convites: [],
  perfis: [],
  aceitacoesTermos: [],
  documentos: [],
  registosEmail: [],
  auditoria: [],
  nota: "",
}));
const eliminarMock = vi.fn(async (organizacaoId: string, opcoes?: unknown) => ({
  modo: opcoes && typeof opcoes === "object" && "confirmar" in opcoes ? "executado" : "simulacao",
  geradoEm: new Date(),
  organizacaoId,
}));

vi.mock("@/features/sociedade/direitos", () => ({
  exportarDadosDaSociedade: (organizacaoId: string) => exportarMock(organizacaoId),
  eliminarDadosDaSociedade: (organizacaoId: string, opcoes?: unknown) =>
    eliminarMock(organizacaoId, opcoes),
}));

let papelAtual = "society_admin";
let organizacaoDoUtilizador: string | null = ID_SOCIEDADE;

vi.mock("@/lib/sessao", () => ({
  exigirEquipaOuSuperAdmin: async () => ({
    eu: { id: "user-1", papel: papelAtual, organizacaoId: organizacaoDoUtilizador },
  }),
  exigirSuperAdmin: async () => ({
    eu: { id: "user-1", papel: papelAtual, organizacaoId: organizacaoDoUtilizador },
  }),
  podeAcederSociedade: (
    eu: { papel: string; organizacaoId: string | null },
    organizacaoIdAlvo: string,
  ) => eu.papel === "super_admin" || eu.organizacaoId === organizacaoIdAlvo,
}));

const { GET, DELETE } = await import("./route");

function pedir(method: string, corpo?: unknown) {
  return new Request(`https://poc.terlicalabs.com/api/backoffice/sociedade/${ID_SOCIEDADE}/dados`, {
    method,
    headers: { "user-agent": "vitest" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
}

function params() {
  return Promise.resolve({ id: ID_SOCIEDADE });
}

beforeEach(() => {
  papelAtual = "society_admin";
  organizacaoDoUtilizador = ID_SOCIEDADE;
  exportarMock.mockClear();
  eliminarMock.mockClear();
});

describe("GET — exportação de dados (artigos 15.º e 20.º)", () => {
  it("devolve a exportação a um membro da própria sociedade", async () => {
    const r = await GET(pedir("GET"), { params: params() });

    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.plataforma).toBe("LexFlow");
    expect(exportarMock).toHaveBeenCalledWith(ID_SOCIEDADE);
  });

  it("permite ao super_admin exportar qualquer sociedade", async () => {
    papelAtual = "super_admin";
    organizacaoDoUtilizador = null;

    const r = await GET(pedir("GET"), { params: params() });

    expect(r.status).toBe(200);
    expect(exportarMock).toHaveBeenCalledTimes(1);
  });

  it("responde 404 a quem não pertence à sociedade, sem chamar o serviço", async () => {
    organizacaoDoUtilizador = "org-outra";

    const r = await GET(pedir("GET"), { params: params() });

    expect(r.status).toBe(404);
    expect(exportarMock).not.toHaveBeenCalled();
  });
});

describe("DELETE — eliminação (artigo 17.º)", () => {
  it("sem corpo é uma simulação (dry-run)", async () => {
    const r = await DELETE(pedir("DELETE"), { params: params() });

    expect(r.status).toBe(200);
    expect(eliminarMock).toHaveBeenCalledWith(
      ID_SOCIEDADE,
      expect.objectContaining({ confirmar: false }),
    );
  });

  it("com confirmação e motivo executa", async () => {
    const r = await DELETE(
      pedir("DELETE", { confirmar: true, motivo: "Pedido da sociedade (art. 17.º)." }),
      { params: params() },
    );

    expect(r.status).toBe(200);
    expect(eliminarMock).toHaveBeenCalledWith(
      ID_SOCIEDADE,
      expect.objectContaining({ confirmar: true, motivo: "Pedido da sociedade (art. 17.º)." }),
    );
  });

  it("o serviço recusa sem motivo e a rota traduz em 400", async () => {
    eliminarMock.mockRejectedValueOnce(
      new Error("Para eliminar dados é obrigatório indicar o motivo (parâmetro «motivo»)."),
    );

    const r = await DELETE(pedir("DELETE", { confirmar: true }), { params: params() });

    expect(r.status).toBe(400);
  });
});
