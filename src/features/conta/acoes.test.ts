import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A definição da palavra-passe própria.
 *
 * O que aqui se fixa é o par de escritas que fecha a janela aberta pelo email
 * de credenciais: **o hash novo na `account` e a marca a `false` na
 * `utilizador`**. Uma sem a outra é um dos dois defeitos que não têm saída —
 * só o hash é uma pessoa presa para sempre no ecrã de definição, com a
 * palavra-passe já trocada; só a marca é a plataforma aberta com a credencial
 * do email ainda a valer.
 *
 * E fixa-se a recusa de repetir a palavra-passe temporária: sem ela, submeter o
 * valor que veio no email passava, e o ecrã dizia que estava tudo tratado sobre
 * uma palavra-passe que continua escrita numa caixa de correio.
 */

type Linha = Record<string, unknown>;

const atualizados: { tabela: string; valores: Linha }[] = [];
let credenciais: Linha[] = [];
let sessao: { conta: { id: string }; eu: Linha } | null = null;
let transacaoRebenta = false;

const eventos: { acao: string; organizacaoId: string }[] = [];

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c,
  eq: (...c: unknown[]) => c,
}));

vi.mock("@/db/schema/auth", () => ({ account: "account" }));
vi.mock("@/db/schema/organizacao", () => ({ utilizador: "utilizador" }));

vi.mock("better-auth/crypto", () => ({
  hashPassword: async (p: string) => `scrypt$${p}`,
  // O hash falsificado carrega a palavra-passe: comparar é desfazer o prefixo.
  verifyPassword: async ({ hash, password }: { hash: string; password: string }) =>
    hash === `scrypt$${password}`,
}));

vi.mock("@/lib/sessao", () => ({ sessaoAtual: async () => sessao }));

vi.mock("@/features/auditoria/registar", () => ({
  registarEvento: async (e: { acao: string; organizacaoId: string }) => {
    eventos.push(e);
  },
}));

const transacao = {
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
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => credenciais }) }),
    }),
    transaction: async (f: (t: unknown) => Promise<unknown>) => {
      if (transacaoRebenta) throw new Error("a base de dados caiu");
      return f(transacao);
    },
  }),
}));

const { redefinirPalavraPasse } = await import("./acoes");

const NOVA = { palavraPasse: "uma-palavra-passe-nova", confirmacao: "uma-palavra-passe-nova" };

beforeEach(() => {
  atualizados.length = 0;
  eventos.length = 0;
  transacaoRebenta = false;
  credenciais = [{ id: "cred-1", password: "scrypt$temporaria-do-email" }];
  sessao = {
    conta: { id: "auth-1" },
    eu: { id: "u-1", email: "maria@exemplo.pt", papel: "utilizador", organizacaoId: "org-1" },
  };
});

const escritaEm = (tabela: string) => atualizados.find((a) => a.tabela === tabela)?.valores;

describe("redefinirPalavraPasse", () => {
  it("grava o hash novo e limpa a marca, as duas juntas", async () => {
    const r = await redefinirPalavraPasse(NOVA);

    expect(r.ok).toBe(true);
    expect(escritaEm("account")).toMatchObject({ password: "scrypt$uma-palavra-passe-nova" });
    expect(escritaEm("utilizador")).toMatchObject({ deveRedefinirPassword: false });
  });

  it("nunca grava a palavra-passe em claro", async () => {
    await redefinirPalavraPasse(NOVA);
    const gravado = JSON.stringify(atualizados);
    expect(gravado.split("uma-palavra-passe-nova")).toHaveLength(2); // só o `scrypt$…`
  });

  /**
   * Sem isto, a redefinição deixava de ser uma redefinição e passava a ser um
   * clique: a palavra-passe continuava a ser a que está escrita no email.
   */
  it("recusa repetir a palavra-passe que veio no email", async () => {
    const r = await redefinirPalavraPasse({
      palavraPasse: "temporaria-do-email",
      confirmacao: "temporaria-do-email",
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros.palavraPasse).toMatch(/diferente/);
    expect(atualizados).toHaveLength(0);
  });

  it("exige que as duas caixas sejam iguais", async () => {
    const r = await redefinirPalavraPasse({
      palavraPasse: "uma-palavra-passe-nova",
      confirmacao: "uma-palavra-passe-nov",
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros.confirmacao).toBeDefined();
    expect(atualizados).toHaveLength(0);
  });

  it("recusa uma palavra-passe abaixo do mínimo do Better Auth", async () => {
    const r = await redefinirPalavraPasse({ palavraPasse: "curta", confirmacao: "curta" });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros.palavraPasse).toMatch(/pelo menos 12/);
    expect(atualizados).toHaveLength(0);
  });

  it("sem sessão não define nada — é uma ação autenticada", async () => {
    sessao = null;
    const r = await redefinirPalavraPasse(NOVA);

    expect(r.ok).toBe(false);
    expect(atualizados).toHaveLength(0);
  });

  /**
   * Escrever a marca a `false` sobre uma conta sem credencial era destrancar a
   * plataforma a alguém que continua sem forma de voltar a entrar amanhã.
   */
  it("uma conta sem credencial não é destrancada", async () => {
    credenciais = [];
    const r = await redefinirPalavraPasse(NOVA);

    expect(r.ok).toBe(false);
    expect(atualizados).toHaveLength(0);
  });

  it("uma escrita falhada não diz que correu bem", async () => {
    transacaoRebenta = true;
    const r = await redefinirPalavraPasse(NOVA);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros._).toMatch(/Não foi possível gravar/);
  });

  it("regista na auditoria da sociedade, e sem nada da palavra-passe", async () => {
    await redefinirPalavraPasse(NOVA);

    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      acao: "utilizador.palavra_passe_definida",
      organizacaoId: "org-1",
    });
    expect(JSON.stringify(eventos)).not.toContain("uma-palavra-passe-nova");
  });

  /**
   * A cadeia de auditoria é por organização (D6) e o `super_admin` não tem
   * nenhuma. Pendurar o evento numa sociedade a que ele não pertence corrompia
   * a leitura da auditoria dessa sociedade — fica o registo no console.
   */
  it("o dono da plataforma não escreve na cadeia de sociedade nenhuma", async () => {
    sessao = {
      conta: { id: "auth-1" },
      eu: { id: "u-1", email: "p@exemplo.pt", papel: "super_admin", organizacaoId: null },
    };

    const r = await redefinirPalavraPasse(NOVA);

    expect(r.ok).toBe(true);
    expect(eventos).toHaveLength(0);
    expect(escritaEm("utilizador")).toMatchObject({ deveRedefinirPassword: false });
  });
});
