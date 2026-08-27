import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CredencialPorEnviar, Transacao } from "./contas";

/**
 * O serviço de criação de contas.
 *
 * O que aqui se fixa são duas coisas.
 *
 * **As duas escritas** (decisão D2): a conta do Better Auth (`user` + `account`,
 * onde vive a palavra-passe) e o utilizador de domínio (`utilizador`, que tem
 * papel e sociedade). Falhar a segunda produz o defeito mais confuso que este
 * sistema sabe dar — o início de sessão passa, `sessaoAtual()` não encontra
 * ninguém por `auth_user_id` e a pessoa volta para `/entrar` sem uma única
 * mensagem de erro.
 *
 * **E o percurso da palavra-passe**: gerada aqui, nunca escolhida por quem
 * administra, nunca devolvida a quem chama, enviada por email para a pessoa a
 * quem pertence, e marcada como temporária na base de dados. Cada um destes
 * quatro tem um teste, porque cada um deles calado sozinho reabre o processo
 * antigo sem partir compilação nenhuma.
 *
 * O `hashPassword` é falsificado: o real é scrypt e leva ~100 ms por chamada, o
 * que num ficheiro de testes é meio minuto para não medir nada — o que interessa
 * é **que a palavra-passe nunca é gravada em claro**, e isso vê-se na mesma.
 */

type Linha = Record<string, unknown>;

const inseridos: { tabela: string; valores: Linha }[] = [];
const atualizados: { tabela: string; valores: Linha }[] = [];
let linhas: Record<string, Linha[]> = {};

/** Os emails que saíram, com o corpo, para se poder olhar lá dentro. */
type EmailEnviado = { para: string; assunto: string; html: string; template: string };
const emails: EmailEnviado[] = [];
let envioFalha: string | null = null;

vi.mock("better-auth/crypto", () => ({
  hashPassword: async (p: string) => `scrypt$${p}`,
}));

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c,
  eq: (...c: unknown[]) => c,
  isNull: (...c: unknown[]) => c,
}));

vi.mock("@/db/schema/auth", () => ({ user: "user", account: "account" }));
vi.mock("@/db/schema/organizacao", () => ({
  utilizador: {
    id: "col_id",
    email: "col_email",
    papel: "col_papel",
    organizacaoId: "col_org",
    apagadoEm: "col_apagado",
    authUserId: "col_auth",
  },
  organizacao: { id: "col_org_id", nome: "col_nome" },
}));

vi.mock("@/lib/email", () => ({
  enviarEmail: async (p: EmailEnviado) => {
    emails.push(p);
    return envioFalha
      ? { ok: false as const, erro: envioFalha }
      : { ok: true as const, canal: "resend" as const, mensagemId: "m-1" };
  },
}));

vi.mock("@/lib/origem", () => ({
  origemPublica: async () => "https://exemplo.pt",
}));

/**
 * A tabela que uma consulta está a usar.
 *
 * O `vi.mock` de `@/db/schema/organizacao` dá à `utilizador` um objeto com os
 * nomes das colunas (é o que permite distinguir uma procura por id de uma por
 * email); as outras continuam a ser strings. `String(objeto)` daria
 * `"[object Object]"` para todas, que é o mesmo balde para tabelas diferentes.
 */
const tabelaDe = (t: unknown) => (typeof t === "object" ? "utilizador" : String(t));

/**
 * O `drizzle-orm` simulado devolve cada comparação como `[coluna, valor]` e o
 * `and(...)` como um array delas. Isto lê de lá o que a consulta está mesmo a
 * pedir — sem isso, qualquer `where` devolvia a lista inteira e a validação do
 * gestor encontrava sempre a primeira linha, fosse ela qual fosse.
 */
type Condicao = [coluna: string, valor: string];

const clausulaSobre = (cond: unknown, coluna: string): Condicao | undefined =>
  Array.isArray(cond)
    ? cond.find((c): c is Condicao => Array.isArray(c) && c[0] === coluna)
    : undefined;

const consultar = (t: unknown, cond: unknown): Linha[] => {
  const list = linhas[tabelaDe(t)] ?? [];

  const porId = clausulaSobre(cond, "col_id");
  if (porId) return list.filter((r) => r.id === porId[1]);

  const porEmail = clausulaSobre(cond, "col_email");
  if (porEmail) return list.filter((r) => !r.email || r.email === porEmail[1]);

  return list;
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
      inseridos.push({ tabela: tabelaDe(t), valores: v });
    },
  }),
  update: (t: unknown) => ({
    set: (v: Linha) => ({
      where: async () => {
        atualizados.push({ tabela: tabelaDe(t), valores: v });
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
  emails.length = 0;
  envioFalha = null;
  linhas = {};
});

/** A palavra-passe que saiu no email — a única cópia em claro que existe. */
const palavraPasseDoEmail = () => {
  const hash = String(inseridoEm("account")?.password ?? "");
  return hash.replace(/^scrypt\$/, "");
};

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
    await criarConta(PEDIDO);

    const clara = palavraPasseDoEmail();
    expect(clara.length).toBeGreaterThanOrEqual(12);
    expect(inseridoEm("account")!.password).toBe(`scrypt$${clara}`);

    // Em lado nenhum da base de dados — nem na `user`, nem na `utilizador`.
    const gravado = JSON.stringify([...inseridos, ...atualizados]);
    expect(gravado.split(clara)).toHaveLength(2); // só o `scrypt$…` da `account`
  });

  /**
   * A decisão de produto deste ficheiro, fixada aqui: **a resposta não leva a
   * palavra-passe**. Enquanto ela vinha, havia um cartão no ecrã de quem
   * administra a mostrá-la — e a pessoa a quem ela pertence recebia-a de
   * terceiros e não era obrigada a trocá-la nunca.
   */
  it("não devolve a palavra-passe a quem criou a conta", async () => {
    const conta = await criarConta(PEDIDO);
    expect(JSON.stringify(conta)).not.toContain(palavraPasseDoEmail());
    expect(Object.keys(conta)).not.toContain("palavraPasse");
  });

  it("manda as credenciais para a pessoa, e a palavra-passe vai lá dentro", async () => {
    const conta = await criarConta(PEDIDO);

    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({
      para: "maria@exemplo.pt",
      template: "credenciais_acesso",
    });
    // O email é o único sítio onde ela circula em claro — é para isso que ele
    // existe, e é o que substitui o cartão que aqui estava.
    expect(emails[0].html).toContain(palavraPasseDoEmail());
    expect(conta.emailEnviado).toBe(true);
    expect(conta.erroEmail).toBeNull();
  });

  /**
   * Uma conta criada cuja mensagem não saiu é uma pessoa que não entra. Se isso
   * não vier na resposta, descobre-se por telefone dias depois — que é
   * exactamente o silêncio da D48, deste lado.
   */
  it("a conta fica criada mesmo quando o email não sai, e a resposta di-lo", async () => {
    envioFalha = "Resend devolveu 403";

    const conta = await criarConta(PEDIDO);

    expect(inseridos.map((i) => i.tabela)).toContain("utilizador");
    expect(conta.emailEnviado).toBe(false);
    expect(conta.erroEmail).toBe("Resend devolveu 403");
  });

  it("marca a conta para redefinir a palavra-passe no primeiro início de sessão", async () => {
    await criarConta(PEDIDO);
    expect(inseridoEm("utilizador")).toMatchObject({ deveRedefinirPassword: true });
  });

  /**
   * Dentro de uma transação, o envio espera por ela. Enviado lá de dentro, um
   * `ROLLBACK` na linha seguinte entregava a palavra-passe de uma conta que
   * deixou de existir.
   */
  it("adia o envio quando corre dentro de uma transação de outrem", async () => {
    const pendentes: CredencialPorEnviar[] = [];

    const conta = await criarConta(PEDIDO, transacao as unknown as Transacao, pendentes);

    expect(emails).toHaveLength(0);
    expect(pendentes).toHaveLength(1);
    expect(pendentes[0].conta).toBe(conta);
    expect(conta.emailEnviado).toBeNull();
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

    await criarConta(PEDIDO);

    const escrita = atualizados.find((a) => a.tabela === "account");
    expect(escrita).toBeDefined();
    expect(String(escrita!.valores.password)).toMatch(/^scrypt\$/);
    // E é essa mesma que sai no email — não uma qualquer outra gerada pelo
    // caminho, que era uma conta com uma palavra-passe que ninguém tem.
    expect(emails[0].html).toContain(String(escrita!.valores.password).replace(/^scrypt\$/, ""));
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
        valores: expect.objectContaining({
          ativo: true,
          apagadoEm: null,
          // É uma conta acabada de criar como qualquer outra: a palavra-passe
          // que acabou de sair por email é temporária também para ela.
          deveRedefinirPassword: true,
        }),
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

  it("recusa um nome vazio — a coluna é NOT NULL", async () => {
    await expect(criarConta({ ...PEDIDO, nome: "   " })).rejects.toThrow(/nome/);
    expect(inseridos).toHaveLength(0);
  });

  /* --- fluxo de aprovação e gestor ---------------------------------------- */

  it("cria a conta como pendente (aprovadoEm = null) sem enviar credenciais", async () => {
    const conta = await criarConta({ ...PEDIDO, aprovadoEm: null });
    expect(conta.aprovadoEm).toBeNull();
    expect(conta.emailEnviado).toBeNull();
    expect(emails).toHaveLength(0);
    expect(inseridoEm("utilizador")).toMatchObject({
      aprovadoEm: null,
      deveRedefinirPassword: true,
    });
  });

  it("cria a conta como aprovada por omissão e envia as credenciais", async () => {
    const conta = await criarConta(PEDIDO);
    expect(conta.aprovadoEm).toBeInstanceOf(Date);
    expect(conta.emailEnviado).toBe(true);
    expect(emails).toHaveLength(1);
    expect(inseridoEm("utilizador")!.aprovadoEm).toBeInstanceOf(Date);
  });

  it("associa um gestor válido a um utilizador", async () => {
    linhas.utilizador = [
      {
        id: "gestor-1",
        email: "gestor@exemplo.pt",
        papel: "gestor",
        organizacaoId: "org-1",
        apagadoEm: null,
      },
    ];

    const conta = await criarConta({
      ...PEDIDO,
      papel: "utilizador",
      gestorId: "gestor-1",
    });

    expect(conta.gestorId).toBe("gestor-1");
    expect(inseridoEm("utilizador")).toMatchObject({
      gestorId: "gestor-1",
      papel: "utilizador",
    });
  });

  it("recusa associar um gestor a uma conta que não seja utilizador", async () => {
    await expect(
      criarConta({
        ...PEDIDO,
        papel: "society_admin",
        gestorId: "gestor-1",
      }),
    ).rejects.toThrow(/Apenas utilizadores com papel 'utilizador'/);
  });

  it("recusa associar um gestor que não tenha papel de gestor", async () => {
    linhas.utilizador = [
      {
        id: "user-outro",
        email: "outro@exemplo.pt",
        papel: "utilizador",
        organizacaoId: "org-1",
        apagadoEm: null,
      },
    ];

    await expect(
      criarConta({
        ...PEDIDO,
        papel: "utilizador",
        gestorId: "user-outro",
      }),
    ).rejects.toThrow(/papel de gestor/);
  });

  it("recusa associar um gestor de outra sociedade", async () => {
    linhas.utilizador = [
      {
        id: "gestor-outra-org",
        email: "gestor-outro@exemplo.pt",
        papel: "gestor",
        organizacaoId: "org-outra",
        apagadoEm: null,
      },
    ];

    await expect(
      criarConta({
        ...PEDIDO,
        papel: "utilizador",
        gestorId: "gestor-outra-org",
      }),
    ).rejects.toThrow(/mesma sociedade/);
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
