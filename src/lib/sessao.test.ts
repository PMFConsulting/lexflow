import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Os três níveis: quem pode o quê, e onde é que cada um cai.
 *
 * Estes testes não olham para a base de dados — olham para a **tabela de
 * decisões**, que é o que a migração `0016` mudou e o que, mudando outra vez,
 * cala uma permissão sem ninguém dar por isso. Um papel que deixe de aprovar
 * processos não parte compilação nenhuma; parte só o trabalho de alguém, três
 * semanas depois.
 */

const redirecionamentos: string[] = [];

/**
 * O `redirect()` do Next lança uma exceção para interromper o render — é assim
 * que ele funciona, e é o que permite ao guard fazer `redirect(...)` sem um
 * `return` a seguir. Sem o `throw` aqui, o teste do guard media a função a
 * continuar depois de reencaminhar, que é o oposto do que ela faz.
 */
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    redirecionamentos.push(destino);
    throw new Error(`NEXT_REDIRECT;${destino}`);
  },
}));

let sessao: { conta: { id: string }; eu: Record<string, unknown> } | null = null;

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("@/lib/auth", () => ({
  auth: () => ({
    api: {
      getSession: async () => (sessao ? { user: sessao.conta } : null),
    },
  }),
}));

vi.mock("drizzle-orm", () => ({ eq: (...c: unknown[]) => c }));
vi.mock("@/db/schema/organizacao", () => ({ utilizador: "utilizador" }));

vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (sessao ? [sessao.eu] : []) }),
      }),
    }),
  }),
}));

const {
  eSuperAdmin,
  exigirEquipaDaSociedade,
  exigirGestorDeUtilizadores,
  exigirSocietyAdmin,
  exigirSuperAdmin,
  podeAprovarProcesso,
  podeGerirUtilizadores,
  podeVerEmails,
  podeVerPpe,
  portalDoPapel,
  sessaoAtual,
} = await import("./sessao");

const PAPEIS = ["super_admin", "society_admin", "utilizador"] as const;

/** Entra em sessão como um papel. O `super_admin` nunca tem sociedade. */
function entrarComo(papel: (typeof PAPEIS)[number], extra: Record<string, unknown> = {}) {
  sessao = {
    conta: { id: "auth-1" },
    eu: {
      id: "user-1",
      nome: "Quem quer que seja",
      email: "x@exemplo.pt",
      papel,
      organizacaoId: papel === "super_admin" ? null : "org-1",
      ativo: true,
      apagadoEm: null,
      ...extra,
    },
  };
}

beforeEach(() => {
  redirecionamentos.length = 0;
  sessao = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------- capacidades */

describe("as capacidades de cada papel", () => {
  it("os emails são do administrador da sociedade, e só dele", () => {
    expect(podeVerEmails("society_admin")).toBe(true);
    expect(podeVerEmails("utilizador")).toBe(false);
    // O dono da plataforma também não: os emails são de uma sociedade, e ele
    // não está em nenhuma.
    expect(podeVerEmails("super_admin")).toBe(false);
  });

  /**
   * A decisão conservadora da migração, fixada aqui.
   *
   * O `utilizador` herda o `advogado`, que aprovava. Se algum dia isto passar a
   * `false`, é uma capacidade a desaparecer de uma migração — e é este teste
   * que obriga a que seja uma decisão e não um efeito lateral.
   */
  it("o utilizador mantém a aprovação que o advogado tinha", () => {
    expect(podeAprovarProcesso("utilizador")).toBe(true);
    expect(podeAprovarProcesso("society_admin")).toBe(true);
  });

  it("o dono da plataforma não decide sobre o cliente de uma sociedade", () => {
    expect(podeAprovarProcesso("super_admin")).toBe(false);
    expect(podeVerPpe("super_admin")).toBe(false);
  });

  it("quem trabalha processos vê o processo todo, PPE incluída", () => {
    expect(podeVerPpe("utilizador")).toBe(true);
    expect(podeVerPpe("society_admin")).toBe(true);
  });

  it("contas criam-se por administração, de um lado ou do outro", () => {
    expect(podeGerirUtilizadores("super_admin")).toBe(true);
    expect(podeGerirUtilizadores("society_admin")).toBe(true);
    expect(podeGerirUtilizadores("utilizador")).toBe(false);
  });

  it("eSuperAdmin distingue só o nível de plataforma", () => {
    expect(eSuperAdmin("super_admin")).toBe(true);
    expect(eSuperAdmin("society_admin")).toBe(false);
    expect(eSuperAdmin("utilizador")).toBe(false);
  });
});

/* ----------------------------------------------------------------- portais */

describe("portalDoPapel", () => {
  it("cada papel tem um portal, e são três diferentes", () => {
    expect(portalDoPapel("super_admin")).toBe("/admin");
    expect(portalDoPapel("society_admin")).toBe("/");
    expect(portalDoPapel("utilizador")).toBe("/meus-processos");

    const destinos = PAPEIS.map(portalDoPapel);
    expect(new Set(destinos).size).toBe(PAPEIS.length);
  });

  /**
   * Um papel desconhecido só aparece numa base a meio de uma migração ou numa
   * versão anterior do código a ler dados novos. Cair no portal com menos
   * permissões é a resposta certa: o pior que acontece é a pessoa ver menos do
   * que devia, e não mais.
   */
  it("um papel desconhecido cai no portal mais restrito", () => {
    expect(portalDoPapel("advogado")).toBe("/meus-processos");
    expect(portalDoPapel("")).toBe("/meus-processos");
  });
});

/* ------------------------------------------------------------------ guards */

/** Um guard que reencaminha lança — é o `redirect()` do Next. */
async function destinoDe(guard: () => Promise<unknown>) {
  try {
    await guard();
    return null;
  } catch {
    return redirecionamentos.at(-1) ?? null;
  }
}

describe("os guards", () => {
  it("sem sessão, todos vão para o início de sessão", async () => {
    sessao = null;
    expect(await destinoDe(exigirSuperAdmin)).toBe("/entrar");
    expect(await destinoDe(exigirSocietyAdmin)).toBe("/entrar");
    expect(await destinoDe(exigirEquipaDaSociedade)).toBe("/entrar");
  });

  /**
   * Reencaminhar para o portal do papel e não para `/entrar`: quem chega a uma
   * página sem ter papel para ela **tem** sessão válida, e mandá-lo autenticar
   * outra vez sugeria que o problema era a sessão.
   */
  it("quem não pertence a um portal cai no seu, não no início de sessão", async () => {
    entrarComo("utilizador");
    expect(await destinoDe(exigirSuperAdmin)).toBe("/meus-processos");
    expect(await destinoDe(exigirSocietyAdmin)).toBe("/meus-processos");

    entrarComo("super_admin");
    expect(await destinoDe(exigirSocietyAdmin)).toBe("/admin");
    expect(await destinoDe(exigirEquipaDaSociedade)).toBe("/admin");

    entrarComo("society_admin");
    expect(await destinoDe(exigirSuperAdmin)).toBe("/");
  });

  it("cada papel entra no seu", async () => {
    entrarComo("super_admin");
    expect(await destinoDe(exigirSuperAdmin)).toBeNull();

    entrarComo("society_admin");
    expect(await destinoDe(exigirSocietyAdmin)).toBeNull();
    expect(await destinoDe(exigirEquipaDaSociedade)).toBeNull();

    entrarComo("utilizador");
    expect(await destinoDe(exigirEquipaDaSociedade)).toBeNull();
  });

  it("a área de trabalho é dos dois papéis da sociedade", async () => {
    for (const papel of ["society_admin", "utilizador"] as const) {
      entrarComo(papel);
      expect(await destinoDe(exigirEquipaDaSociedade)).toBeNull();
    }
  });

  it("criar contas é dos dois níveis de administração", async () => {
    for (const papel of ["super_admin", "society_admin"] as const) {
      entrarComo(papel);
      expect(await destinoDe(exigirGestorDeUtilizadores)).toBeNull();
    }
    entrarComo("utilizador");
    expect(await destinoDe(exigirGestorDeUtilizadores)).toBe("/meus-processos");
  });
});

/* --------------------------------------------------- o gate da organização */

describe("o gate da organização", () => {
  /**
   * O que a restrição `utilizador_org_por_papel` garante na base de dados,
   * traduzido para o sistema de tipos: os guards da sociedade devolvem
   * `organizacaoId` como `string`, e é isso que permite às consultas compará-lo
   * sem um `!` em cada uma.
   */
  it("os papéis de sociedade trazem a organização já resolvida", async () => {
    entrarComo("society_admin");
    const s = await exigirSocietyAdmin();
    expect(s.eu.organizacaoId).toBe("org-1");

    entrarComo("utilizador");
    const t = await exigirEquipaDaSociedade();
    expect(t.eu.organizacaoId).toBe("org-1");
  });

  it("o dono da plataforma não tem organização nenhuma", async () => {
    entrarComo("super_admin");
    const s = await exigirSuperAdmin();
    expect(s.eu.organizacaoId).toBeNull();
  });

  /**
   * Com a restrição em vigor não há linha que chegue aqui — mas uma base
   * anterior à `0016`, ou um `UPDATE` infeliz, produzem-na. O que ela precisa é
   * de parar à entrada, e não de descobrir a meio de uma consulta que não tem
   * organização para comparar.
   */
  it("um papel de sociedade sem organização é barrado, não deixado passar", async () => {
    entrarComo("society_admin", { organizacaoId: null });
    expect(await destinoDe(exigirSocietyAdmin)).toBe("/entrar");

    entrarComo("utilizador", { organizacaoId: null });
    expect(await destinoDe(exigirEquipaDaSociedade)).toBe("/entrar");
  });
});

/* ---------------------------------------------------------------- a sessão */

describe("sessaoAtual", () => {
  it("uma conta desativada não tem sessão", async () => {
    entrarComo("society_admin", { ativo: false });
    expect(await sessaoAtual()).toBeNull();
  });

  it("uma conta apagada não tem sessão", async () => {
    entrarComo("society_admin", { apagadoEm: new Date() });
    expect(await sessaoAtual()).toBeNull();
  });

  it("sem conta de autenticação não há sessão", async () => {
    sessao = null;
    expect(await sessaoAtual()).toBeNull();
  });
});
