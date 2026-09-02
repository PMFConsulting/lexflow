import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { associarUtilizadorEquipa, removerUtilizadorEquipa } from "./acoes";

type Linha = Record<string, unknown>;

const ORG_ID = "a0000000-0000-4000-8000-000000000001";
const GESTOR_ID = "b0000000-0000-4000-8000-000000000001";
const USER_1_ID = "c0000000-0000-4000-8000-000000000001";
const USER_2_ID = "c0000000-0000-4000-8000-000000000002";

const auditados: { acao: string; valorNovo?: Linha; valorAnterior?: Linha; organizacaoId: string; atorId: string }[] = [];
let papelAtual = "gestor";
let organizacaoIdSessao: string | null = ORG_ID;
let actorIdSessao: string = GESTOR_ID;
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
  exigirEquipaDaSociedade: async () => ({
    eu: {
      id: actorIdSessao,
      papel: papelAtual,
      organizacaoId: organizacaoIdSessao,
    },
  }),
}));

vi.mock("@/db", () => {
  return {
    db: () => ({
      select: () => ({
        from: (tabela: unknown) => ({
          where: (cond: unknown) => {
            return {
              limit: async () => {
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
          where: (cond: unknown) => {
            const alvoId =
              cond && typeof cond === "object" && "val" in cond && typeof (cond as { val: unknown }).val === "string"
                ? (cond as { val: string }).val
                : undefined;
            if (alvoId && utilizadoresDb[alvoId]) {
              utilizadoresDb[alvoId] = { ...utilizadoresDb[alvoId], ...valores };
            }
            return {
              then: (cb: (v: unknown) => unknown) => Promise.resolve(valores).then(cb),
            };
          },
        }),
      }),
    }),
  };
});

beforeEach(() => {
  auditados.length = 0;
  papelAtual = "gestor";
  organizacaoIdSessao = ORG_ID;
  actorIdSessao = GESTOR_ID;
  for (const k of Object.keys(utilizadoresDb)) delete utilizadoresDb[k];

  utilizadoresDb[GESTOR_ID] = {
    id: GESTOR_ID,
    nome: "Gestor Carlos",
    email: "carlos@sociedade.pt",
    papel: "gestor",
    organizacaoId: ORG_ID,
    ativo: true,
    gestorId: null,
  };

  utilizadoresDb[USER_1_ID] = {
    id: USER_1_ID,
    nome: "Utilizador João",
    email: "joao@sociedade.pt",
    papel: "utilizador",
    organizacaoId: ORG_ID,
    ativo: true,
    gestorId: null, // elegível
  };
  
  utilizadoresDb[USER_2_ID] = {
    id: USER_2_ID,
    nome: "Utilizador Maria",
    email: "maria@sociedade.pt",
    papel: "utilizador",
    organizacaoId: ORG_ID,
    ativo: true,
    gestorId: GESTOR_ID, // já do gestor
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Gestão de Equipa pelo Próprio Gestor", () => {
  describe("associarUtilizadorEquipa", () => {
    it("gestor pode associar um utilizador sem gestor à sua equipa", async () => {
      const res = await associarUtilizadorEquipa(USER_1_ID);

      expect(res).toEqual({ ok: true });
      expect(utilizadoresDb[USER_1_ID].gestorId).toBe(GESTOR_ID);
      expect(auditados).toContainEqual(
        expect.objectContaining({
          acao: "utilizador.gestor_atualizado",
          organizacaoId: ORG_ID,
          atorId: GESTOR_ID,
          valorNovo: { gestorId: GESTOR_ID },
        })
      );
    });

    it("falha se o alvo não tiver papel 'utilizador'", async () => {
      utilizadoresDb[USER_1_ID].papel = "gestor";
      const res = await associarUtilizadorEquipa(USER_1_ID);
      expect(res.ok).toBe(false);
      expect((res as any).erro).toContain("papel 'utilizador'");
    });

    it("falha se o utilizador já tiver outro gestor", async () => {
      utilizadoresDb[USER_1_ID].gestorId = "outro-gestor";
      const res = await associarUtilizadorEquipa(USER_1_ID);
      expect(res.ok).toBe(false);
      expect((res as any).erro).toContain("já tem um gestor");
    });
    
    it("falha se o ator não for gestor", async () => {
      papelAtual = "society_admin";
      const res = await associarUtilizadorEquipa(USER_1_ID);
      expect(res.ok).toBe(false);
    });
  });

  describe("removerUtilizadorEquipa", () => {
    it("gestor pode remover um utilizador da sua equipa", async () => {
      const res = await removerUtilizadorEquipa(USER_2_ID);

      expect(res).toEqual({ ok: true });
      expect(utilizadoresDb[USER_2_ID].gestorId).toBeNull();
      expect(auditados).toContainEqual(
        expect.objectContaining({
          acao: "utilizador.gestor_atualizado",
          organizacaoId: ORG_ID,
          atorId: GESTOR_ID,
          valorNovo: { gestorId: null },
        })
      );
    });

    it("falha se tentar remover utilizador que não é da sua equipa", async () => {
      utilizadoresDb[USER_2_ID].gestorId = "outro-gestor";
      const res = await removerUtilizadorEquipa(USER_2_ID);
      expect(res.ok).toBe(false);
      expect((res as any).erro).toContain("não pertence à sua equipa");
    });
  });
});
