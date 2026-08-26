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
  exigirEquipaOuSuperAdmin,
  exigirGestorDeUtilizadores,
  exigirSocietyAdmin,
  exigirSuperAdmin,
  podeAcederSociedade,
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
   * Aprovação de processos:
   *
   * O dono da plataforma (`super_admin`) tem acesso transversal para aprovar/rejeitar
   * e editar dados, e a equipa da sociedade (`society_admin`, `utilizador`) mantém a
   * sua aprovação.
   */
  it("a aprovação e edição de processos é permitida aos três papéis", () => {
    expect(podeAprovarProcesso("utilizador")).toBe(true);
    expect(podeAprovarProcesso("society_admin")).toBe(true);
    expect(podeAprovarProcesso("super_admin")).toBe(true);
  });

  it("o dono da plataforma e a equipa da sociedade veem PPE", () => {
    expect(podeVerPpe("super_admin")).toBe(true);
    expect(podeVerPpe("utilizador")).toBe(true);
    expect(podeVerPpe("society_admin")).toBe(true);
  });

  it("podeAcederSociedade confere acesso transversal ao super_admin e restrito aos restantes", () => {
    expect(podeAcederSociedade({ papel: "super_admin", organizacaoId: null }, "org-qualquer")).toBe(true);
    expect(podeAcederSociedade({ papel: "society_admin", organizacaoId: "org-1" }, "org-1")).toBe(true);
    expect(podeAcederSociedade({ papel: "society_admin", organizacaoId: "org-1" }, "org-2")).toBe(false);
    expect(podeAcederSociedade({ papel: "utilizador", organizacaoId: "org-1" }, "org-1")).toBe(true);
    expect(podeAcederSociedade({ papel: "utilizador", organizacaoId: "org-1" }, "org-2")).toBe(false);
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

  it("exigirEquipaOuSuperAdmin deixa passar os três papéis", async () => {
    for (const papel of PAPEIS) {
      entrarComo(papel);
      expect(await destinoDe(exigirEquipaOuSuperAdmin)).toBeNull();
    }
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

/* ------------------------------------------- a redefinição obrigatória */

/**
 * A conta criada por um administrador nasce com uma palavra-passe gerada e
 * enviada por email — um segredo que já viajou por um canal que não é secreto.
 * Enquanto ela não for trocada, a plataforma inteira está fechada.
 *
 * O desvio está em `exigirSessao` de propósito, e é isso que estes testes
 * fixam: **todos** os guards de papel passam por lá, por isso não há página nem
 * Server Action autenticado que possa esquecer-se dele. Um desvio posto em cada
 * página seria um desvio esquecido na página seguinte.
 */
describe("a redefinição obrigatória da palavra-passe", () => {
  it("qualquer guard manda para o ecrã de definição, seja qual for o papel", async () => {
    entrarComo("super_admin", { deveRedefinirPassword: true });
    expect(await destinoDe(exigirSuperAdmin)).toBe("/definir-palavra-passe");
    expect(await destinoDe(exigirGestorDeUtilizadores)).toBe("/definir-palavra-passe");

    entrarComo("society_admin", { deveRedefinirPassword: true });
    expect(await destinoDe(exigirSocietyAdmin)).toBe("/definir-palavra-passe");

    entrarComo("utilizador", { deveRedefinirPassword: true });
    expect(await destinoDe(exigirEquipaDaSociedade)).toBe("/definir-palavra-passe");
  });

  /**
   * O desvio vem **antes** da verificação de papel: quem tem a marca não deve
   * receber "esta página não é para si" sobre uma página onde o problema é
   * outro, nem ser mandado para um portal em que também não pode entrar.
   */
  it("a marca decide antes do papel", async () => {
    entrarComo("utilizador", { deveRedefinirPassword: true });
    expect(await destinoDe(exigirSuperAdmin)).toBe("/definir-palavra-passe");
  });

  it("sem a marca, nada muda", async () => {
    entrarComo("society_admin", { deveRedefinirPassword: false });
    expect(await destinoDe(exigirSocietyAdmin)).toBeNull();
  });

  /**
   * A coluna é `not null` na base de dados, mas uma sessão montada por um teste
   * — ou uma leitura de uma base anterior à `0020` — pode não a trazer. O recuo
   * tem de ser "não é preciso redefinir": o contrário trancava toda a gente
   * fora da plataforma num ecrã que não tem saída.
   */
  it("uma coluna ausente não tranca ninguém", async () => {
    entrarComo("society_admin");
    expect(await destinoDe(exigirSocietyAdmin)).toBeNull();
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
