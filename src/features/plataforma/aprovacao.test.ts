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
  isNotNull: (...c: unknown[]) => c,
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

/**
 * O `drizzle-orm` simulado lá em cima devolve cada comparação como
 * `[coluna, valor]` e o `and(...)` como um array delas. Estas duas funções leem
 * de lá o que a consulta está mesmo a pedir.
 *
 * Sem elas, qualquer `where` devolvia a tabela inteira — e um teste que espera
 * "esta conta não existe" passava por acidente, porque a primeira linha da lista
 * respondia a todas as perguntas.
 */
type Condicao = [coluna: string, valor: string];

function condicoesSobre(cond: unknown, tabela: string): Condicao[] {
  if (!Array.isArray(cond)) return [];
  return cond.filter(
    (c): c is Condicao =>
      Array.isArray(c) && c[0] === tabela && typeof c[1] === "string",
  );
}

/**
 * As linhas de `utilizador` que a condição seleciona.
 *
 * O id e o email distinguem-se pelo `@`: é grosseiro, e chega — nenhum
 * identificador desta simulação o contém, e a alternativa era ensinar o mock a
 * distinguir colunas que o `vi.mock` do drizzle reduz todas ao nome da tabela.
 */
function utilizadoresQueSatisfazem(list: Linha[], cond: unknown): Linha[] {
  const sobre = condicoesSobre(cond, "utilizador");

  const porId = sobre.find((c) => !c[1].includes("@"));
  if (porId) return list.filter((r) => r.id === porId[1]);

  const porEmail = sobre.find((c) => c[1].includes("@"));
  if (porEmail) return list.filter((r) => r.email === porEmail[1]);

  return list;
}

const consultar = (t: unknown, cond: unknown): Linha[] => {
  const list = linhas[String(t)] ?? [];
  return String(t) === "utilizador" ? utilizadoresQueSatisfazem(list, cond) : list;
};

const transacao = {
  select: () => ({
    from: (t: unknown) => ({
      where: (cond: unknown) => ({
        limit: async () => consultar(t, cond),
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
          limit: async () => consultar(t, cond),
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
const { ASSUNTO_CREDENCIAIS, ASSUNTO_AVISO_MULTI_SOCIEDADE } = await import("@/lib/emails/credenciais");

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
    linhas.user = [{ id: "auth-joana" }];
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
    expect(emailsEnviados[0]).toMatchObject({ assunto: ASSUNTO_CREDENCIAIS });
    expect(atualizados).toContainEqual(
      expect.objectContaining({
        tabela: "utilizador",
        valores: expect.objectContaining({
          aprovadoEm: expect.any(Date),
          deveRedefinirPassword: true,
        }),
      }),
    );
    expect(atualizados).toContainEqual(
      expect.objectContaining({
        tabela: "account",
        valores: expect.objectContaining({ password: expect.any(String) }),
      }),
    );
    expect(eventosAuditados).toContainEqual(
      expect.objectContaining({
        acao: "utilizador.aprovado",
        entidadeId: USER_ID,
      }),
    );
  });

  /**
   * BUG LFD2: `reaproveitada` estava sempre `true`, e uma conta nova nunca
   * recebia a palavra-passe temporária — só o aviso de "adicionado a outra
   * sociedade". `reaproveitada` só é `true` quando outra sociedade já tem
   * uma linha APROVADA a apontar para o mesmo `authUserId` (D64); esta conta
   * é a primeira aprovação sobre esta credencial, por isso gera e envia.
   */
  it("aprova conta nova sem nenhuma outra sociedade aprovada: gera e envia palavra-passe (reaproveitada=false)", async () => {
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
    linhas.user = [{ id: "auth-joana" }];
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
    expect(emailsEnviados[0]).toMatchObject({ assunto: ASSUNTO_CREDENCIAIS });
    expect(atualizados).toContainEqual(
      expect.objectContaining({
        tabela: "utilizador",
        valores: expect.objectContaining({ deveRedefinirPassword: true }),
      }),
    );
    expect(atualizados).toContainEqual(
      expect.objectContaining({
        tabela: "account",
        valores: expect.objectContaining({ password: expect.any(String) }),
      }),
    );
  });

  /**
   * A mesma pessoa já é `society_admin` aprovado noutra sociedade (mesmo
   * `authUserId`), e é agora convidada para uma segunda — linha pendente
   * criada por `criarConta` com a credencial intocada (D64). Aprovar não
   * pode gerar palavra-passe nova (partiria o login que já usa) nem
   * prometer credenciais que não saíram: só o aviso.
   */
  it("aprova conta cuja credencial já foi entregue noutra sociedade: preserva a palavra-passe e manda o aviso (reaproveitada=true)", async () => {
    linhas.utilizador = [
      {
        id: USER_ID,
        nome: "Rui Partilhado",
        email: "rui@sociedade-b.pt",
        papel: "society_admin",
        organizacaoId: ORG_ID,
        authUserId: "auth-partilhado",
        aprovadoEm: null,
        apagadoEm: null,
        gestorId: null,
      },
      {
        id: "0197a1c0-0000-7000-8000-000000000099",
        nome: "Rui Partilhado",
        email: "rui@sociedade-a.pt",
        papel: "society_admin",
        organizacaoId: "0197a1c0-0000-7000-8000-000000000098",
        authUserId: "auth-partilhado",
        aprovadoEm: new Date("2026-01-01T09:00:00Z"),
        apagadoEm: null,
        gestorId: null,
      },
    ];
    linhas.user = [{ id: "auth-partilhado" }];
    linhas.account = [
      {
        id: "acc-partilhada",
        userId: "auth-partilhado",
        providerId: "credential",
      },
    ];

    const res = await aprovarUtilizador(USER_ID);

    expect(res.ok).toBe(true);
    expect(emailsEnviados).toHaveLength(1);
    expect(emailsEnviados[0]).toMatchObject({ assunto: ASSUNTO_AVISO_MULTI_SOCIEDADE });
    expect(atualizados).toContainEqual(
      expect.objectContaining({
        tabela: "utilizador",
        valores: expect.objectContaining({
          aprovadoEm: expect.any(Date),
          deveRedefinirPassword: false,
        }),
      }),
    );
    expect(atualizados).not.toContainEqual(
      expect.objectContaining({ tabela: "account" }),
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
   * `auth_user_id` preenchido não prova que a conta do Better Auth exista: a
   * coluna não tem chave estrangeira, e `account` apaga em cascata com o `user`.
   * Apagada a linha do outro lado, fica aqui um identificador pendurado que
   * passa a verificação do `null` — e a aprovação seguia até bater na chave
   * estrangeira e responder «Tente de novo», sobre algo que nenhuma repetição
   * resolve.
   */
  it("recusa aprovar uma conta cujo auth_user_id já não existe", async () => {
    linhas.utilizador = [
      {
        id: USER_ID,
        nome: "Conta Pendurada",
        email: "pendurada@sociedade.pt",
        papel: "utilizador",
        organizacaoId: ORG_ID,
        authUserId: "auth-desaparecido",
        aprovadoEm: null,
        apagadoEm: null,
        gestorId: null,
      },
    ];
    linhas.user = [];

    const res = await aprovarUtilizador(USER_ID);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.erro).toMatch(/perdeu a ligação/i);
    expect(emailsEnviados).toHaveLength(0);
    expect(atualizados).toHaveLength(0);
    expect(inseridos).toHaveLength(0);
    expect(eventosAuditados).toHaveLength(0);
  });

  /**
   * A credencial em falta recupera-se — recusar trancava para sempre uma conta
   * que se resolve escrevendo a linha que falta. O que não pode é passar sem
   * rasto: a auditoria tem de distinguir «trocou-se a palavra-passe» de «não
   * havia nenhuma para trocar».
   */
  it("recria a credencial em falta e regista-o na auditoria", async () => {
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
    linhas.user = [{ id: "auth-joana" }];
    linhas.account = [];

    const res = await aprovarUtilizador(USER_ID);

    expect(res.ok).toBe(true);
    expect(inseridos).toContainEqual(
      expect.objectContaining({
        tabela: "account",
        valores: expect.objectContaining({
          userId: "auth-joana",
          providerId: "credential",
        }),
      }),
    );
    expect(eventosAuditados).toContainEqual(
      expect.objectContaining({
        acao: "utilizador.aprovado",
        valorNovo: expect.objectContaining({ credencialCriada: true }),
      }),
    );
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
