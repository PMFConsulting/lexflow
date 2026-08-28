import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { associarGestor, criarUtilizador } from "./acoes";

type Linha = Record<string, unknown>;

const ORG_ID = "a0000000-0000-4000-8000-000000000001";
const GESTOR_1_ID = "b0000000-0000-4000-8000-000000000001";
const GESTOR_2_ID = "b0000000-0000-4000-8000-000000000002";
const USER_1_ID = "c0000000-0000-4000-8000-000000000001";

const auditados: { acao: string; valorNovo?: Linha; valorAnterior?: Linha; organizacaoId: string; atorId: string }[] = [];
let papelAtual = "society_admin";
let organizacaoIdSessao: string | null = ORG_ID;
const utilizadoresDb: Record<string, Linha> = {};

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "127.0.0.1", "user-agent": "vitest" }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c,
  eq: (a: unknown, b: unknown) => ({ col: a, val: b }),
  isNull: () => true,
  isNotNull: () => true,
  ne: () => true,
  sql: (...c: unknown[]) => c,
}));

vi.mock("@/db/schema/organizacao", () => ({
  organizacao: "organizacao",
  utilizador: "utilizador",
}));

vi.mock("@/features/auditoria/registar", () => ({
  registarEvento: async (e: {
    acao: string;
    valorNovo?: Linha;
    valorAnterior?: Linha;
    organizacaoId: string;
    atorId: string;
  }) => {
    auditados.push(e);
  },
}));

vi.mock("@/lib/sessao", () => ({
  exigirGestorDeUtilizadores: async () => ({
    eu: {
      id: "user-actor-1",
      papel: papelAtual,
      organizacaoId: organizacaoIdSessao,
    },
  }),
}));

vi.mock("./contas", () => ({
  criarConta: async (dados: {
    nome: string;
    email: string;
    papel: string;
    organizacaoId: string;
    gestorId?: string | null;
    aprovadoEm?: Date | null;
  }) => {
    const id = `user-${Math.random().toString(36).slice(2, 7)}`;
    utilizadoresDb[id] = {
      id,
      nome: dados.nome,
      email: dados.email,
      papel: dados.papel,
      organizacaoId: dados.organizacaoId,
      gestorId: dados.gestorId ?? null,
      aprovadoEm: dados.aprovadoEm ?? null,
      ativo: true,
    };
    return {
      utilizadorId: id,
      email: dados.email,
      nome: dados.nome,
      papel: dados.papel,
      aprovadoEm: dados.aprovadoEm ?? null,
      gestorId: dados.gestorId ?? null,
      emailEnviado: true,
      erroEmail: null,
    };
  },
  enviarCredenciais: async () => undefined,
  enviarCredenciaisPendentes: async () => undefined,
  gerarPalavraPasse: () => "temp-pass-1234",
  ErroDeConta: class ErroDeConta extends Error {
    motivo: string;
    constructor(motivo: string) {
      super(motivo);
      this.motivo = motivo;
    }
  },
}));

vi.mock("@/db", () => {
  return {
    db: () => ({
      select: () => ({
        from: (tabela: unknown) => ({
          where: (cond: unknown) => {
            return {
              limit: async () => {
                const tab = String(tabela);
                if (tab === "organizacao" || (typeof tabela === "object" && tabela !== null && "prefixoReferencia" in tabela)) {
                  return [{ id: ORG_ID, nome: "Sociedade Teste", prefixoReferencia: "PMF", nif: "501234567" }];
                }
                if (Array.isArray(cond)) {
                  for (const c of cond) {
                    if (c && typeof c === "object" && "val" in c && typeof c.val === "string" && utilizadoresDb[c.val]) {
                      return [utilizadoresDb[c.val]];
                    }
                  }
                }
                return Object.values(utilizadoresDb).slice(0, 1);
              },
            };
          },
        }),
      }),
      update: () => ({
        set: (valores: Linha) => ({
          where: () => {
            return {
              then: (cb: (v: unknown) => unknown) => Promise.resolve(valores).then(cb),
            };
          },
        }),
      }),
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => Promise.resolve(),
        }),
      }),
    }),
  };
});

beforeEach(() => {
  auditados.length = 0;
  papelAtual = "society_admin";
  organizacaoIdSessao = ORG_ID;
  for (const k of Object.keys(utilizadoresDb)) delete utilizadoresDb[k];

  // Gestor G1 na org-1
  utilizadoresDb[GESTOR_1_ID] = {
    id: GESTOR_1_ID,
    nome: "Gestor Carlos",
    email: "carlos@sociedade.pt",
    papel: "gestor",
    organizacaoId: ORG_ID,
    ativo: true,
    gestorId: null,
  };

  // Gestor G2 na org-1
  utilizadoresDb[GESTOR_2_ID] = {
    id: GESTOR_2_ID,
    nome: "Gestora Diana",
    email: "diana@sociedade.pt",
    papel: "gestor",
    organizacaoId: ORG_ID,
    ativo: true,
    gestorId: null,
  };

  // Utilizador U1 na org-1
  utilizadoresDb[USER_1_ID] = {
    id: USER_1_ID,
    nome: "Utilizador João",
    email: "joao@sociedade.pt",
    papel: "utilizador",
    organizacaoId: ORG_ID,
    ativo: true,
    gestorId: GESTOR_1_ID,
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Gestão de Gestores (Regra do Diogo)", () => {
  describe("associarGestor", () => {
    it("society_admin associa e move utilizador entre gestores sem aprovação", async () => {
      const res = await associarGestor(USER_1_ID, GESTOR_2_ID);

      expect(res).toEqual({ ok: true });
      expect(auditados).toContainEqual(
        expect.objectContaining({
          acao: "utilizador.gestor_atualizado",
          organizacaoId: ORG_ID,
          atorId: "user-actor-1",
          valorNovo: { gestorId: GESTOR_2_ID },
        }),
      );
    });

    it("super_admin é recusado ao tentar associar gestor", async () => {
      papelAtual = "super_admin";
      organizacaoIdSessao = null;

      const res = await associarGestor(USER_1_ID, GESTOR_2_ID);

      expect(res.ok).toBe(false);
      expect((res as { erro: string }).erro).toContain("Apenas o administrador da sociedade");
    });
  });

  describe("criarUtilizador e seleção de gestor", () => {
    it("super_admin não escolhe gestor ao criar utilizador (gestorId é forçado a null)", async () => {
      papelAtual = "super_admin";
      organizacaoIdSessao = null;

      const res = await criarUtilizador({
        nome: "Novo Colaborador",
        email: "novo@sociedade.pt",
        papel: "utilizador",
        gestorId: GESTOR_1_ID,
        organizacaoId: ORG_ID,
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.conta.gestorId).toBeNull();
      }
    });

    it("society_admin pode associar gestor logo na criação do utilizador", async () => {
      papelAtual = "society_admin";
      organizacaoIdSessao = ORG_ID;

      const res = await criarUtilizador({
        nome: "Novo Colaborador",
        email: "novo@sociedade.pt",
        papel: "utilizador",
        gestorId: GESTOR_1_ID,
        organizacaoId: ORG_ID,
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.conta.gestorId).toBe(GESTOR_1_ID);
      }
    });
  });
});
