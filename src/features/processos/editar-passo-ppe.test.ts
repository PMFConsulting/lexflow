import { beforeEach, describe, expect, it, vi } from "vitest";

type Linha = Record<string, unknown>;

const auditados: Linha[] = [];
const atualizacoesProcesso: Linha[] = [];
let linhas: Record<string, Linha[]> = {};

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "127.0.0.1", "user-agent": "vitest" }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c,
  eq: (...c: unknown[]) => c,
  isNull: (...c: unknown[]) => c,
}));

vi.mock("@/db/schema/organizacao", () => ({
  organizacao: "organizacao",
  contadorReferencia: { organizacaoId: "org_id", ano: "ano", ultimo: "ultimo" },
}));

vi.mock("@/db/schema/processo", () => ({
  processoOnboarding: "processo_onboarding",
  documento: "documento",
}));

vi.mock("@/db/schema/seccoes", () => ({
  identificacaoParticular: "identificacao_particular",
  identificacaoEmpresa: "identificacao_empresa",
  declaracaoPpe: { processoId: "processo_id" },
  relacaoNegocio: { processoId: "processo_id" },
  dadosIdentificacao: "dados_identificacao",
  dadosFaturacao: "dados_faturacao",
  fechoProposta: "fecho_proposta",
  moradaLegal: { processoId: "processo_id" },
  representanteLegal: { processoId: "processo_id" },
}));

vi.mock("@/features/auditoria/registar", () => ({
  registarEvento: async (e: Linha) => {
    auditados.push(e);
    return { ok: true };
  },
}));

vi.mock("@/lib/sessao", () => ({
  exigirEquipaOuSuperAdmin: async () => ({
    eu: { id: "user-1", papel: "society_admin", organizacaoId: "org-1" },
  }),
  podeAcederSociedade: () => true,
}));

vi.mock("@/features/onboarding/dados", () => ({
  acessoPorToken: async () => ({ estado: "desconhecido" }),
}));

vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({
      from: (t: unknown) => ({
        where: () => ({
          limit: async () => linhas[String(t)] ?? [],
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => Promise.resolve(),
      }),
    }),
    update: () => ({
      set: (valores: Linha) => ({
        where: () => {
          atualizacoesProcesso.push(valores);
          return Promise.resolve();
        },
      }),
    }),
  }),
}));

import { atualizarSeccaoProcesso } from "./acoes";

describe("atualizarSeccaoProcesso — Risco PPE no Backoffice", () => {
  beforeEach(() => {
    auditados.length = 0;
    atualizacoesProcesso.length = 0;
    linhas = {};
  });

  it("ao desmarcar PPE num processo com risco elevado, repõe risco baixo e limpa fatores de risco", async () => {
    linhas["processo_onboarding"] = [
      {
        id: "proc-1",
        organizacaoId: "org-1",
        referencia: "JM-2026-0001",
        tipoCliente: "particular",
        estado: "em_revisao",
        nivelRisco: "elevado",
        fatoresRisco: [
          { codigo: "ppe", descricao: "Pessoa politicamente exposta declarada", peso: 100 },
        ],
      },
    ];

    const r = await atualizarSeccaoProcesso("proc-1", 4, {
      ePpe: false,
      temRelacaoPpe: false,
      servicos: "Consultoria jurídica",
      origemFundos: "Rendimentos do trabalho",
    });

    expect(r.ok).toBe(true);

    const updateRisco = atualizacoesProcesso.find((u) => u.nivelRisco === "baixo");
    expect(updateRisco).toBeDefined();
    expect(updateRisco?.nivelRisco).toBe("baixo");
    expect(updateRisco?.fatoresRisco).toEqual([]);

    const eventoReposto = auditados.find((a) => a.acao === "risco.reposto");
    expect(eventoReposto).toBeDefined();
    expect(eventoReposto).toMatchObject({
      organizacaoId: "org-1",
      processoId: "proc-1",
      atorId: "user-1",
      entidade: "processo_onboarding",
      valorAnterior: { nivelRisco: "elevado", motivo: "ppe" },
      valorNovo: { nivelRisco: "baixo", motivo: "ppe_retirada" },
    });
  });

  it("ao marcar PPE num processo com risco baixo, atualiza risco para elevado", async () => {
    linhas["processo_onboarding"] = [
      {
        id: "proc-1",
        organizacaoId: "org-1",
        referencia: "JM-2026-0001",
        tipoCliente: "particular",
        estado: "em_revisao",
        nivelRisco: "baixo",
        fatoresRisco: [],
      },
    ];

    const r = await atualizarSeccaoProcesso("proc-1", 4, {
      ePpe: true,
      ppeCargo: "Deputado",
      ppePais: "Portugal",
      temRelacaoPpe: false,
      servicos: "Consultoria jurídica",
      origemFundos: "Rendimentos do trabalho",
    });

    expect(r.ok).toBe(true);

    const updateRisco = atualizacoesProcesso.find((u) => u.nivelRisco === "elevado");
    expect(updateRisco).toBeDefined();
    expect(updateRisco?.nivelRisco).toBe("elevado");
    expect(updateRisco?.fatoresRisco).toEqual([
      { codigo: "ppe", descricao: "Pessoa politicamente exposta declarada", peso: 100 },
    ]);

    const eventoElevado = auditados.find((a) => a.acao === "risco.elevado");
    expect(eventoElevado).toBeDefined();
  });
});
