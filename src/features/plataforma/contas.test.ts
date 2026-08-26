import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O serviço de criação de contas.
 *
 * O que aqui se fixa é a razão de o serviço existir: **as duas escritas**
 * (decisão D2). A conta do Better Auth (`user` + `account`, onde vive a
 * palavra-passe) e o utilizador de domínio (`utilizador`, que tem papel e
 * sociedade). Falhar a segunda produz o defeito mais confuso que este sistema
 * sabe dar — o início de sessão passa, `sessaoAtual()` não encontra ninguém por
 * `auth_user_id` e a pessoa volta para `/entrar` sem uma única mensagem de erro.
 *
 * O `hashPassword` é falsificado: o real é scrypt e leva ~100 ms por chamada, o
 * que num ficheiro de testes é meio minuto para não medir nada — o que interessa
 * é **que a palavra-passe nunca é gravada em claro**, e isso vê-se na mesma.
 */

type Linha = Record<string, unknown>;

const inseridos: { tabela: string; valores: Linha }[] = [];
const atualizados: { tabela: string; valores: Linha }[] = [];
let linhas: Record<string, Linha[]> = {};

vi.mock("better-auth/crypto", () => ({
  hashPassword: async (p: string) => `scrypt$${p}`,
}));

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c,
  eq: (...c: unknown[]) => c,
  isNull: (...c: unknown[]) => c,
}));

vi.mock("@/db/schema/auth", () => ({ user: "user", account: "account" }));
vi.mock("@/db/schema/organizacao", () => ({ utilizador: "utilizador" }));

const transacao = {
  select: () => ({
    from: (t: unknown) => ({
      where: () => ({ limit: async () => linhas[String(t)] ?? [] }),
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
  }),
}));

const { criarConta, ErroDeConta, gerarPalavraPasse, normalizarEmail } = await import("./contas");

const PEDIDO = {
  nome: "Maria Silva",
  email: "maria@exemplo.pt",
  papel: "utilizador" as const,
  organizacaoId: "org-1",
};

const inseridoEm = (tabela: string) => inseridos.find((i) => i.tabela === tabela)?.valores;

beforeEach(() => {
  inseridos.length = 0;
  atualizados.length = 0;
  linhas = {};
});

describe("criarConta", () => {
  it("escreve as três linhas que uma conta precisa", async () => {
    const conta = await criarConta(PEDIDO);

    expect(inseridos.map((i) => i.tabela)).toEqual(["user", "account", "utilizador"]);

    // A palavra-passe não vive em `user`: vive na `account` com
    // `provider_id = 'credential'`, e é lá que o login a vai buscar.
    expect(inseridoEm("account")).toMatchObject({ providerId: "credential" });

    // As duas metades ligadas pelo mesmo `auth_user_id` — sem isso, o login
    // passa e a sessão não resolve.
    expect(inseridoEm("utilizador")!.authUserId).toBe(inseridoEm("user")!.id);
    expect(conta.utilizadorId).toBe(inseridoEm("utilizador")!.id);
  });

  it("guarda o hash e nunca a palavra-passe em claro", async () => {
    const conta = await criarConta({ ...PEDIDO, palavraPasse: "palavra-passe-longa" });

    expect(inseridoEm("account")!.password).toBe("scrypt$palavra-passe-longa");

    const gravado = JSON.stringify([...inseridos, ...atualizados]);
    expect(gravado).not.toContain('"palavra-passe-longa"');

    // Em claro só na resposta desta chamada, que é o que o ecrã mostra uma vez.
    expect(conta.palavraPasse).toBe("palavra-passe-longa");
  });

  it("sem palavra-passe indicada, gera uma que o Better Auth aceita", async () => {
    const conta = await criarConta(PEDIDO);
    expect(conta.palavraPasse.length).toBeGreaterThanOrEqual(12);
  });

  it("normaliza o email antes de o gravar", async () => {
    const conta = await criarConta({ ...PEDIDO, email: "  MARIA@Exemplo.PT " });

    expect(conta.email).toBe("maria@exemplo.pt");
    expect(inseridoEm("user")!.email).toBe("maria@exemplo.pt");
    expect(inseridoEm("utilizador")!.email).toBe("maria@exemplo.pt");
  });

  /**
   * `user.email` é único **global** e o `utilizador` é único por sociedade. Os
   * dois níveis não coincidem: a mesma pessoa em duas sociedades tem dois
   * `utilizador` e uma só conta de acesso. Sem reaproveitar, o insert batia no
   * índice único e a mensagem falava de uma tabela que quem está no ecrã não
   * sabe que existe.
   */
  it("reaproveita a conta de acesso quando o email já existe noutra sociedade", async () => {
    linhas["user"] = [{ id: "auth-ja-existia" }];

    await criarConta(PEDIDO);

    expect(inseridos.map((i) => i.tabela)).toEqual(["account", "utilizador"]);
    expect(inseridoEm("utilizador")!.authUserId).toBe("auth-ja-existia");
  });

  it("substitui a palavra-passe quando a credencial já existe", async () => {
    linhas["user"] = [{ id: "auth-1" }];
    linhas["account"] = [{ id: "cred-1" }];

    await criarConta({ ...PEDIDO, palavraPasse: "outra-palavra-passe" });

    expect(atualizados).toContainEqual(
      expect.objectContaining({
        tabela: "account",
        valores: expect.objectContaining({ password: "scrypt$outra-palavra-passe" }),
      }),
    );
  });

  it("recusa quem já lá está na mesma sociedade", async () => {
    linhas["utilizador"] = [{ id: "u-1", apagadoEm: null }];

    await expect(criarConta(PEDIDO)).rejects.toBeInstanceOf(ErroDeConta);
    expect(inseridoEm("utilizador")).toBeUndefined();
  });

  /**
   * Recusar "já existe" sobre uma conta que ninguém vê em lado nenhum é a pior
   * resposta possível — e um insert novo batia no índice único, porque a linha
   * apagada continua lá.
   */
  it("repõe uma conta apagada em vez de recusar", async () => {
    linhas["utilizador"] = [{ id: "u-1", apagadoEm: new Date() }];

    const conta = await criarConta(PEDIDO);

    expect(conta.utilizadorId).toBe("u-1");
    expect(atualizados).toContainEqual(
      expect.objectContaining({
        tabela: "utilizador",
        valores: expect.objectContaining({ ativo: true, apagadoEm: null }),
      }),
    );
  });

  /* --- o gate da organização, no sítio onde se escreve -------------------- */

  it("recusa um papel de sociedade sem sociedade", async () => {
    await expect(
      criarConta({ ...PEDIDO, papel: "society_admin", organizacaoId: null }),
    ).rejects.toThrow(/Escolha a sociedade/);
    expect(inseridos).toHaveLength(0);
  });

  it("recusa um super_admin com sociedade", async () => {
    await expect(
      criarConta({ ...PEDIDO, papel: "super_admin", organizacaoId: "org-1" }),
    ).rejects.toThrow(/não pertence/);
    expect(inseridos).toHaveLength(0);
  });

  it("cria o super_admin com a organização a NULL", async () => {
    await criarConta({ ...PEDIDO, papel: "super_admin", organizacaoId: null });
    expect(inseridoEm("utilizador")).toMatchObject({
      organizacaoId: null,
      papel: "super_admin",
    });
  });

  it("recusa uma palavra-passe curta antes de tocar na base de dados", async () => {
    await expect(criarConta({ ...PEDIDO, palavraPasse: "curta" })).rejects.toThrow(
      /pelo menos 12/,
    );
    expect(inseridos).toHaveLength(0);
  });

  it("recusa um nome vazio — a coluna é NOT NULL", async () => {
    await expect(criarConta({ ...PEDIDO, nome: "   " })).rejects.toThrow(/nome/);
    expect(inseridos).toHaveLength(0);
  });
});

describe("gerarPalavraPasse", () => {
  it("evita os caracteres que se leem mal ao telefone", () => {
    const amostra = Array.from({ length: 50 }, () => gerarPalavraPasse(32)).join("");
    // Sem l/I/1/O/0: a conta que "não funciona" porque alguém leu um 1 onde
    // estava um l é o modo de falha mais irritante deste processo.
    expect(amostra).not.toMatch(/[lI1O0]/);
  });

  it("não repete a mesma palavra-passe", () => {
    const geradas = new Set(Array.from({ length: 200 }, () => gerarPalavraPasse()));
    expect(geradas.size).toBe(200);
  });
});

describe("normalizarEmail", () => {
  it("corta espaços e baixa as maiúsculas", () => {
    expect(normalizarEmail("  MARIA@Exemplo.PT ")).toBe("maria@exemplo.pt");
  });
});
