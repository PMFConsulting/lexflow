import { beforeEach, describe, expect, it, vi } from "vitest";

type Linha = Record<string, unknown>;

const inseridos: { tabela: string; valores: Linha }[] = [];
const atualizados: { tabela: string; valores: Linha }[] = [];
let linhas: Record<string, Linha[]> = {};
const eventosAuditados: Linha[] = [];
const emailsEnviados: Linha[] = [];

const ORG_ID = "0197a1c0-0000-7000-8000-000000000001";
const USER_ID = "0197a1c0-0000-7000-8000-000000000002";

let usuarioAutenticado: { id: string; papel: string; organizacaoId: string | null } = {
  id: "super-1",
  papel: "super_admin",
  organizacaoId: null,
};

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "127.0.0.1" }),
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

vi.mock("@/lib/email", () => ({
  enviarEmail: async (e: Linha) => {
    emailsEnviados.push(e);
    return { ok: true, canal: "resend", mensagemId: "msg-1" };
  },
}));

vi.mock("@/lib/origem", () => ({
  origemPublica: async () => "https://exemplo.pt",
}));

const transacao = {
  select: () => ({
    from: (t: unknown) => ({
      where: (cond: unknown) => ({
        limit: async () => {
          const list = linhas[String(t)] ?? [];
          if (String(t) === "utilizador" && Array.isArray(cond)) {
            const idClause = cond.find(
              (c: any) =>
                Array.isArray(c) &&
                c[0] === "utilizador" &&
                typeof c[1] === "string" &&
                !c[1].includes("@"),
            );
            if (idClause) return list.filter((r) => r.id === idClause[1]);
            const emailClause = cond.find(
              (c: any) =>
                Array.isArray(c) &&
                c[0] === "utilizador" &&
                typeof c[1] === "string" &&
                c[1].includes("@"),
            );
            if (emailClause) return list.filter((r) => r.email === emailClause[1]);
          }
          return list;
        },
      }),
    }),
  }),
  insert: (t: unknown) => ({
    values: async (v: Linha) => {
      inseridos.push({ tabela: String(t), valores: v });
    },
  }),
  update: (t: unknown) => ({
    set: (v: Linha) => ({
      where: async () => {
        atualizados.push({ tabela: String(t), valores: v });
      },
    }),
  }),
};

vi.mock("@/db", () => ({
  db: () => ({
    transaction: async (f: (t: unknown) => Promise<unknown>) => f(transacao),
    select: () => ({
      from: (t: unknown) => ({
        where: (cond: unknown) => ({
          limit: async () => {
            const list = linhas[String(t)] ?? [];
            if (String(t) === "utilizador" && Array.isArray(cond)) {
              const idClause = cond.find(
                (c: any) =>
                  Array.isArray(c) &&
                  c[0] === "utilizador" &&
                  typeof c[1] === "string" &&
                  !c[1].includes("@"),
              );
              if (idClause) return list.filter((r) => r.id === idClause[1]);
              const emailClause = cond.find(
                (c: any) =>
                  Array.isArray(c) &&
                  c[0] === "utilizador" &&
                  typeof c[1] === "string" &&
                  c[1].includes("@"),
              );
              if (emailClause) return list.filter((r) => r.email === emailClause[1]);
            }
            return list;
          },
        }),
      }),
    }),
    update: (t: unknown) => ({
      set: (v: Linha) => ({
        where: async () => {
          atualizados.push({ tabela: String(t), valores: v });
        },
      }),
    }),
  }),
}));

vi.mock("@/lib/sessao", () => ({
  exigirSuperAdmin: async () => {
    if (usuarioAutenticado.papel !== "super_admin") {
      throw new Error("NEXT_REDIRECT;/");
    }
    return { eu: usuarioAutenticado };
  },
  exigirGestorDeUtilizadores: async () => {
    if (
      usuarioAutenticado.papel !== "super_admin" &&
      usuarioAutenticado.papel !== "society_admin"
    ) {
      throw new Error("NEXT_REDIRECT;/meus-processos");
    }
    return { eu: usuarioAutenticado };
  },
}));

const { aprovarUtilizador, criarUtilizador, rejeitarUtilizador } = await import("./acoes");

describe("fluxo de aprovação e criação de utilizadores", () => {
  beforeEach(() => {
    inseridos.length = 0;
    atualizados.length = 0;
    eventosAuditados.length = 0;
    emailsEnviados.length = 0;
    linhas = {};
    usuarioAutenticado = {
      id: "super-1",
      papel: "super_admin",
      organizacaoId: null,
    };
  });

  it("super_admin cria utilizador já aprovado e envia credenciais de imediato", async () => {
    linhas.organizacao = [{ id: ORG_ID }];

    const res = await criarUtilizador({
      nome: "Carlos Advogado",
      email: "carlos@sociedade.pt",
      papel: "utilizador",
      organizacaoId: ORG_ID,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.conta.aprovadoEm).toBeInstanceOf(Date);
      expect(res.conta.emailEnviado).toBe(true);
    }
    expect(emailsEnviados).toHaveLength(1);
    expect(eventosAuditados).toContainEqual(
      expect.objectContaining({
        acao: "utilizador.criado",
        valorNovo: expect.objectContaining({
          pendenteAprovacao: false,
          credenciaisEnviadas: true,
        }),
      }),
    );
  });

  it("society_admin cria utilizador pendente (sem envio imediato de credenciais)", async () => {
    usuarioAutenticado = {
      id: "soc-admin-1",
      papel: "society_admin",
      organizacaoId: ORG_ID,
    };
    linhas.organizacao = [{ id: ORG_ID }];

    const res = await criarUtilizador({
      nome: "Joana Colaboradora",
      email: "joana@sociedade.pt",
      papel: "utilizador",
      organizacaoId: ORG_ID,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.conta.aprovadoEm).toBeNull();
      expect(res.conta.emailEnviado).toBeNull();
    }
    expect(emailsEnviados).toHaveLength(0);
    expect(eventosAuditados).toContainEqual(
      expect.objectContaining({
        acao: "utilizador.criado",
        valorNovo: expect.objectContaining({
          pendenteAprovacao: true,
          credenciaisEnviadas: null,
        }),
      }),
    );
  });

  it("aprovarUtilizador aprova conta pendente, gera senha e envia credenciais", async () => {
    linhas.utilizador = [
      {
        id: USER_ID,
        nome: "Joana Colaboradora",
        email: "joana@sociedade.pt",
        papel: "utilizador",
        organizacaoId: ORG_ID,
        authUserId: "auth-joana",
        aprovadoEm: null,
        apagadoEm: null,
        gestorId: null,
      },
    ];
    linhas.account = [
      {
        id: "acc-joana",
        userId: "auth-joana",
        providerId: "credential",
      },
    ];

    const res = await aprovarUtilizador(USER_ID);
    expect(res.ok).toBe(true);
    expect(emailsEnviados).toHaveLength(1);
    expect(atualizados).toContainEqual(
      expect.objectContaining({
        tabela: "utilizador",
        valores: expect.objectContaining({
          aprovadoEm: expect.any(Date),
          deveRedefinirPassword: true,
        }),
      }),
    );
    expect(eventosAuditados).toContainEqual(
      expect.objectContaining({
        acao: "utilizador.aprovado",
        entidadeId: USER_ID,
      }),
    );
  });

  it("rejeitarUtilizador faz soft delete e regista auditoria", async () => {
    linhas.utilizador = [
      {
        id: USER_ID,
        nome: "Manuel Candidato",
        email: "manuel@sociedade.pt",
        papel: "utilizador",
        organizacaoId: ORG_ID,
        authUserId: "auth-manuel",
        aprovadoEm: null,
        apagadoEm: null,
      },
    ];

    const res = await rejeitarUtilizador(USER_ID, "Não pertence aos quadros.");
    expect(res.ok).toBe(true);
    expect(atualizados).toContainEqual(
      expect.objectContaining({
        tabela: "utilizador",
        valores: expect.objectContaining({
          ativo: false,
          apagadoEm: expect.any(Date),
        }),
      }),
    );
    expect(eventosAuditados).toContainEqual(
      expect.objectContaining({
        acao: "utilizador.rejeitado",
        entidadeId: USER_ID,
        valorNovo: expect.objectContaining({
          motivo: "Não pertence aos quadros.",
        }),
      }),
    );
  });

  /* --- os limites da aprovação e da recusa -------------------------------- */

  /**
   * Dois separadores abertos sobre a mesma lista de pendentes, ou dois cliques
   * seguidos. A segunda passagem não pode gerar uma palavra-passe nova (que
   * invalidaria a que a pessoa já recebeu, e talvez já trocou) nem afirmar que
   * as credenciais saíram quando nenhum email foi mandado.
   */
  it("aprovar uma conta já aprovada não repete nada nem promete email", async () => {
    linhas.utilizador = [
      {
        id: USER_ID,
        nome: "Joana Colaboradora",
        email: "joana@sociedade.pt",
        papel: "utilizador",
        organizacaoId: ORG_ID,
        authUserId: "auth-joana",
        aprovadoEm: new Date("2026-08-01T10:00:00Z"),
        apagadoEm: null,
        gestorId: null,
      },
    ];

    const res = await aprovarUtilizador(USER_ID);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.jaAprovado).toBe(true);
      expect(res.emailEnviado).toBeNull();
    }
    expect(emailsEnviados).toHaveLength(0);
    expect(atualizados).toHaveLength(0);
  });

  /**
   * Sem `auth_user_id` não há onde guardar a palavra-passe: aprovar e mandar o
   * email era entregar credenciais que não abrem nada — o login passa e a
   * sessão não resolve, com um email por cima a dizer que está tudo bem.
   */
  it("recusa aprovar uma conta que não está ligada ao início de sessão", async () => {
    linhas.utilizador = [
      {
        id: USER_ID,
        nome: "Conta Solta",
        email: "solta@sociedade.pt",
        papel: "utilizador",
        organizacaoId: ORG_ID,
        authUserId: null,
        aprovadoEm: null,
        apagadoEm: null,
        gestorId: null,
      },
    ];

    const res = await aprovarUtilizador(USER_ID);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.erro).toMatch(/não está ligada/i);
    expect(emailsEnviados).toHaveLength(0);
    expect(atualizados).toHaveLength(0);
  });

  /**
   * O botão só aparece nas contas pendentes, mas um Server Action é um endereço
   * alcançável a partir do browser. Sem esta verificação, o identificador de uma
   * conta em uso há meses era suficiente para a apagar por um caminho que na
   * auditoria fica a dizer que uma proposta foi recusada.
   */
  it("recusa rejeitar uma conta que já foi aprovada", async () => {
    linhas.utilizador = [
      {
        id: USER_ID,
        nome: "Administrador Em Funções",
        email: "admin@sociedade.pt",
        papel: "society_admin",
        organizacaoId: ORG_ID,
        authUserId: "auth-admin",
        aprovadoEm: new Date("2026-01-15T09:00:00Z"),
        apagadoEm: null,
      },
    ];

    const res = await rejeitarUtilizador(USER_ID, "engano");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.erro).toMatch(/já foi aprovada/i);
    expect(atualizados).toHaveLength(0);
    expect(eventosAuditados).toHaveLength(0);
  });

  it("recusa aprovação ou rejeição se não for super_admin", async () => {
    usuarioAutenticado = {
      id: "soc-admin-1",
      papel: "society_admin",
      organizacaoId: ORG_ID,
    };

    await expect(aprovarUtilizador(USER_ID)).rejects.toThrow("NEXT_REDIRECT;/");
    await expect(rejeitarUtilizador(USER_ID)).rejects.toThrow("NEXT_REDIRECT;/");
  });
});
