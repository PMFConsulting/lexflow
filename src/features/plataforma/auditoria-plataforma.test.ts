import { beforeEach, describe, expect, it, vi } from "vitest";

type Linha = Record<string, unknown>;

const eventosAuditados: Linha[] = [];
let linhas: Record<string, Linha[]> = {};
let utilizadoresInseridos: Linha[] = [];

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "127.0.0.1", "user-agent": "vitest" }),
}));

vi.mock("better-auth/crypto", () => ({
  hashPassword: async (p: string) => `scrypt$${p}`,
}));

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c,
  eq: (...c: unknown[]) => c,
  isNull: (...c: unknown[]) => c,
  ne: (...c: unknown[]) => c,
  or: (...c: unknown[]) => c,
  asc: (...c: unknown[]) => c,
  desc: (...c: unknown[]) => c,
  count: () => "count",
  sql: () => "sql",
  ilike: () => "ilike",
  aliasedTable: (t: unknown) => t,
}));

vi.mock("@/db/schema/auth", () => ({
  user: "user",
  account: "account",
}));

vi.mock("@/db/schema/organizacao", () => ({
  utilizador: "utilizador",
  organizacao: "organizacao",
}));

vi.mock("@/features/auditoria/registar", () => ({
  registarEvento: async (e: Linha) => {
    eventosAuditados.push(e);
    return { ok: true };
  },
}));

vi.mock("@/lib/sessao", () => ({
  exigirSuperAdmin: async () => ({
    eu: { id: "super-admin-1", papel: "super_admin", email: "admin@lexflow.pt", organizacaoId: null },
  }),
  exigirGestorDeUtilizadores: async () => ({
    eu: { id: "super-admin-1", papel: "super_admin", email: "admin@lexflow.pt", organizacaoId: null },
  }),
}));

vi.mock("@/lib/email", () => ({
  enviarEmail: async () => ({ ok: true }),
}));

vi.mock("@/lib/origem", () => ({
  origemPublica: async () => "https://exemplo.pt",
}));

vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({
      from: (t: unknown) => ({
        where: () => ({
          limit: async () => linhas[String(t)] ?? [],
          orderBy: () => ({
            limit: async () => linhas[String(t)] ?? [],
          }),
        }),
      }),
    }),
    insert: (t: unknown) => ({
      values: (v: unknown) => ({
        returning: async () => {
          const arr = Array.isArray(v) ? v : [v];
          for (const item of arr) utilizadoresInseridos.push(item as Linha);
          return arr;
        },
        then: (resolve: (v: unknown) => unknown) => {
          const arr = Array.isArray(v) ? v : [v];
          for (const item of arr) utilizadoresInseridos.push(item as Linha);
          return Promise.resolve(arr).then(resolve);
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => [{ id: "u-1" }],
          then: (resolve: (v: unknown) => unknown) => Promise.resolve([{ id: "u-1" }]).then(resolve),
        }),
      }),
    }),
    transaction: async (cb: (tx: unknown) => unknown) => cb({
      select: () => ({
        from: (t: unknown) => ({
          where: () => ({
            limit: async () => linhas[String(t)] ?? [],
          }),
        }),
      }),
      insert: (t: unknown) => ({
        values: (v: unknown) => ({
          returning: async () => {
            const arr = Array.isArray(v) ? v : [v];
            for (const item of arr) utilizadoresInseridos.push(item as Linha);
            return arr;
          },
          then: (resolve: (v: unknown) => unknown) => {
            const arr = Array.isArray(v) ? v : [v];
            for (const item of arr) utilizadoresInseridos.push(item as Linha);
            return Promise.resolve(arr).then(resolve);
          },
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            then: (resolve: (v: unknown) => unknown) => Promise.resolve().then(resolve),
          }),
        }),
      }),
    }),
  }),
}));

import {
  alterarEstadoDaConta,
  criarAdministradorDePlataforma,
} from "./acoes";
import { ORGANIZACAO_PLATAFORMA_ID } from "@/features/auditoria/constantes";

describe("Auditoria de Super Admin e Plataforma", () => {
  beforeEach(() => {
    eventosAuditados.length = 0;
    utilizadoresInseridos.length = 0;
    linhas = {};
  });

  it("criarAdministradorDePlataforma grava evento de auditoria imutável com ID de plataforma", async () => {
    const r = await criarAdministradorDePlataforma({
      nome: "Novo Super Admin",
      email: "novo_super@lexflow.pt",
    });

    expect(r.ok).toBe(true);
    expect(eventosAuditados).toHaveLength(1);
    expect(eventosAuditados[0]).toMatchObject({
      organizacaoId: ORGANIZACAO_PLATAFORMA_ID,
      atorId: "super-admin-1",
      acao: "utilizador.criado",
      entidade: "utilizador",
      valorNovo: {
        email: "novo_super@lexflow.pt",
        papel: "super_admin",
      },
    });
  });

  it("alterarEstadoDaConta num super_admin (sem organizacaoId) audita sob ORGANIZACAO_PLATAFORMA_ID", async () => {
    linhas["utilizador"] = [
      {
        id: "super-admin-2",
        email: "outro_super@lexflow.pt",
        papel: "super_admin",
        organizacaoId: null,
        ativo: true,
      },
    ];

    const r = await alterarEstadoDaConta("super-admin-2", false);

    expect(r).toEqual({ ok: true });
    expect(eventosAuditados).toHaveLength(1);
    expect(eventosAuditados[0]).toMatchObject({
      organizacaoId: ORGANIZACAO_PLATAFORMA_ID,
      atorId: "super-admin-1",
      acao: "utilizador.desativado",
      entidade: "utilizador",
      entidadeId: "super-admin-2",
      valorAnterior: { ativo: true },
      valorNovo: { ativo: false },
    });
  });

  it("alterarEstadoDaConta num utilizador de sociedade audita sob o organizacaoId da sociedade", async () => {
    linhas["utilizador"] = [
      {
        id: "user-soc-1",
        email: "advogado@sociedade.pt",
        papel: "utilizador",
        organizacaoId: "org-sociedade-1",
        ativo: false,
      },
    ];

    const r = await alterarEstadoDaConta("user-soc-1", true);

    expect(r).toEqual({ ok: true });
    expect(eventosAuditados).toHaveLength(1);
    expect(eventosAuditados[0]).toMatchObject({
      organizacaoId: "org-sociedade-1",
      atorId: "super-admin-1",
      acao: "utilizador.reativado",
      entidade: "utilizador",
      entidadeId: "user-soc-1",
      valorAnterior: { ativo: false },
      valorNovo: { ativo: true },
    });
  });
});
