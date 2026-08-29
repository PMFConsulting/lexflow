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

/**
 * `linhasUtilizador` simula a tabela inteira: uma conta de autenticação pode
 * ter mais do que uma linha (BUG3-002, uma por sociedade), e é por isso que
 * deixou de fazer sentido guardar "a sessão" como um objeto só.
 */
let contaAutenticada: { id: string } | null = null;
let linhasUtilizador: Record<string, unknown>[] = [];
let cookieSociedadeAtiva: string | undefined;

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (nome: string) =>
      nome === "sociedade_ativa" && cookieSociedadeAtiva
        ? { value: cookieSociedadeAtiva }
        : undefined,
  }),
}));

vi.mock("@/lib/auth", () => ({
  auth: () => ({
    api: {
      getSession: async () => (contaAutenticada ? { user: contaAutenticada } : null),
    },
  }),
}));

vi.mock("drizzle-orm", () => ({ eq: (...c: unknown[]) => c, asc: (...c: unknown[]) => c }));
vi.mock("@/db/schema/organizacao", () => ({ utilizador: "utilizador" }));

vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          // O `ORDER BY criadoEm, id` é o que o Postgres real aplicaria — o
          // mock simula-o em vez de devolver as linhas na ordem em que os
          // testes as escreveram em `linhasUtilizador`, que é exatamente o
          // que o teste de determinismo precisa de não poder assumir.
          orderBy: async () =>
            contaAutenticada
              ? linhasUtilizador
                  .filter((l) => l.authUserId === contaAutenticada?.id)
                  .slice()
                  .sort((a, b) => {
                    const t =
                      (a.criadoEm as Date).getTime() - (b.criadoEm as Date).getTime();
                    return t !== 0 ? t : String(a.id).localeCompare(String(b.id));
                  })
              : [],
        }),
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
  podeAprovarUtilizadores,
  podeGerirUtilizadores,
  podeReenviarLinkProcesso,
  podeVerEmails,
  podeVerPpe,
  portalDoPapel,
  sessaoAtual,
  ROTA_AGUARDA_APROVACAO,
  COOKIE_SOCIEDADE_ATIVA,
} = await import("./sessao");

const PAPEIS = ["super_admin", "society_admin", "gestor", "utilizador"] as const;

/** Entra em sessão como um papel, com uma única linha `utilizador`. O `super_admin` nunca tem sociedade. */
function entrarComo(papel: (typeof PAPEIS)[number], extra: Record<string, unknown> = {}) {
  contaAutenticada = { id: "auth-1" };
  linhasUtilizador = [
    {
      id: "user-1",
      authUserId: "auth-1",
      nome: "Quem quer que seja",
      email: "x@exemplo.pt",
      papel,
      organizacaoId: papel === "super_admin" ? null : "org-1",
      aprovadoEm: new Date(),
      ativo: true,
      apagadoEm: null,
      criadoEm: new Date("2026-01-01T00:00:00.000Z"),
      ...extra,
    },
  ];
}

beforeEach(() => {
  redirecionamentos.length = 0;
  contaAutenticada = null;
  linhasUtilizador = [];
  cookieSociedadeAtiva = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------- capacidades */

describe("as capacidades de cada papel", () => {
  it("os emails são do administrador da sociedade, e só dele", () => {
    expect(podeVerEmails("society_admin")).toBe(true);
    expect(podeVerEmails("gestor")).toBe(false);
    expect(podeVerEmails("utilizador")).toBe(false);
    // O dono da plataforma também não: os emails são de uma sociedade, e ele
    // não está em nenhuma.
    expect(podeVerEmails("super_admin")).toBe(false);
  });

  /**
   * Aprovação de processos:
   * A equipa da sociedade (society_admin, gestor, utilizador) pode aprovar.
   * O super_admin NÃO pode aprovar processos.
   */
  it("a aprovação e edição de processos é permitida à equipa da sociedade, mas não ao super_admin", () => {
    expect(podeAprovarProcesso("utilizador")).toBe(true);
    expect(podeAprovarProcesso("gestor")).toBe(true);
    expect(podeAprovarProcesso("society_admin")).toBe(true);
    expect(podeAprovarProcesso("super_admin")).toBe(false);
  });

  it("apenas a equipa da sociedade vê PPE, super_admin não vê", () => {
    expect(podeVerPpe("super_admin")).toBe(false);
    expect(podeVerPpe("society_admin")).toBe(true);
    expect(podeVerPpe("gestor")).toBe(true);
    expect(podeVerPpe("utilizador")).toBe(true);
  });

  it("podeAcederSociedade confere acesso transversal ao super_admin e restrito aos restantes", () => {
    expect(podeAcederSociedade({ papel: "super_admin", organizacaoId: null }, "org-qualquer")).toBe(true);
    expect(podeAcederSociedade({ papel: "society_admin", organizacaoId: "org-1" }, "org-1")).toBe(true);
    expect(podeAcederSociedade({ papel: "society_admin", organizacaoId: "org-1" }, "org-2")).toBe(false);
    expect(podeAcederSociedade({ papel: "gestor", organizacaoId: "org-1" }, "org-1")).toBe(true);
    expect(podeAcederSociedade({ papel: "gestor", organizacaoId: "org-1" }, "org-2")).toBe(false);
    expect(podeAcederSociedade({ papel: "utilizador", organizacaoId: "org-1" }, "org-1")).toBe(true);
    expect(podeAcederSociedade({ papel: "utilizador", organizacaoId: "org-1" }, "org-2")).toBe(false);
  });

  it("contas criam-se por administração (super_admin ou society_admin)", () => {
    expect(podeGerirUtilizadores("super_admin")).toBe(true);
    expect(podeGerirUtilizadores("society_admin")).toBe(true);
    expect(podeGerirUtilizadores("gestor")).toBe(false);
    expect(podeGerirUtilizadores("utilizador")).toBe(false);
  });

  it("aprovar utilizadores é exclusivo do super_admin", () => {
    expect(podeAprovarUtilizadores("super_admin")).toBe(true);
    expect(podeAprovarUtilizadores("society_admin")).toBe(false);
    expect(podeAprovarUtilizadores("gestor")).toBe(false);
    expect(podeAprovarUtilizadores("utilizador")).toBe(false);
  });

  it("eSuperAdmin distingue só o nível de plataforma", () => {
    expect(eSuperAdmin("super_admin")).toBe(true);
    expect(eSuperAdmin("society_admin")).toBe(false);
    expect(eSuperAdmin("gestor")).toBe(false);
    expect(eSuperAdmin("utilizador")).toBe(false);
  });
});

/* ----------------------------------------------------------------- portais */

describe("portalDoPapel", () => {
  it("cada papel tem um portal, e são quatro diferentes", () => {
    expect(portalDoPapel("super_admin")).toBe("/admin");
    expect(portalDoPapel("society_admin")).toBe("/");
    expect(portalDoPapel("gestor")).toBe("/processos");
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
    contaAutenticada = null;
    linhasUtilizador = [];
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

    entrarComo("gestor");
    expect(await destinoDe(exigirSuperAdmin)).toBe("/processos");
    expect(await destinoDe(exigirSocietyAdmin)).toBe("/processos");

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

    entrarComo("gestor");
    expect(await destinoDe(exigirEquipaDaSociedade)).toBeNull();

    entrarComo("utilizador");
    expect(await destinoDe(exigirEquipaDaSociedade)).toBeNull();
  });

  it("a área de trabalho é dos três papéis da sociedade", async () => {
    for (const papel of ["society_admin", "gestor", "utilizador"] as const) {
      entrarComo(papel);
      expect(await destinoDe(exigirEquipaDaSociedade)).toBeNull();
    }
  });

  it("criar contas é dos dois níveis de administração", async () => {
    for (const papel of ["super_admin", "society_admin"] as const) {
      entrarComo(papel);
      expect(await destinoDe(exigirGestorDeUtilizadores)).toBeNull();
    }
    entrarComo("gestor");
    expect(await destinoDe(exigirGestorDeUtilizadores)).toBe("/processos");
    entrarComo("utilizador");
    expect(await destinoDe(exigirGestorDeUtilizadores)).toBe("/meus-processos");
  });

  it("exigirEquipaOuSuperAdmin deixa passar os quatro papéis", async () => {
    for (const papel of PAPEIS) {
      entrarComo(papel);
      expect(await destinoDe(exigirEquipaOuSuperAdmin)).toBeNull();
    }
  });

  it("utilizadores não aprovados são desviados para aguarda-aprovacao", async () => {
    entrarComo("utilizador", { aprovadoEm: null });
    expect(await destinoDe(exigirEquipaDaSociedade)).toBe(ROTA_AGUARDA_APROVACAO);

    entrarComo("gestor", { aprovadoEm: null });
    expect(await destinoDe(exigirEquipaDaSociedade)).toBe(ROTA_AGUARDA_APROVACAO);

    entrarComo("society_admin", { aprovadoEm: null });
    expect(await destinoDe(exigirSocietyAdmin)).toBe(ROTA_AGUARDA_APROVACAO);

    // O super_admin nunca aguarda aprovação
    entrarComo("super_admin", { aprovadoEm: null });
    expect(await destinoDe(exigirSuperAdmin)).toBeNull();
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
    contaAutenticada = null;
    linhasUtilizador = [];
    expect(await sessaoAtual()).toBeNull();
  });

  it("uma conta com uma só sociedade não traz outras", async () => {
    entrarComo("society_admin");
    const s = await sessaoAtual();
    expect(s?.outrasOrganizacoes).toEqual([]);
  });
});

/* --------------------------------------- BUG3-002: multi-sociedade */

describe("BUG3-002 — sessão multi-sociedade determinística", () => {
  /** Duas linhas `utilizador` para a mesma conta de autenticação, em sociedades diferentes. */
  function entrarComDuasSociedades() {
    contaAutenticada = { id: "auth-1" };
    linhasUtilizador = [
      {
        id: "user-org-2",
        authUserId: "auth-1",
        nome: "Admin de Duas Sociedades",
        email: "admin@exemplo.pt",
        papel: "society_admin",
        organizacaoId: "org-2",
        aprovadoEm: new Date(),
        ativo: true,
        apagadoEm: null,
        // Mais recente — entra depois da org-1 na lista, e é por isso que o
        // teste de determinismo confirma que a ordenação, e não a ordem de
        // inserção, é o que decide.
        criadoEm: new Date("2026-03-01T00:00:00.000Z"),
      },
      {
        id: "user-org-1",
        authUserId: "auth-1",
        nome: "Admin de Duas Sociedades",
        email: "admin@exemplo.pt",
        papel: "society_admin",
        organizacaoId: "org-1",
        aprovadoEm: new Date(),
        ativo: true,
        apagadoEm: null,
        criadoEm: new Date("2026-01-01T00:00:00.000Z"),
      },
    ];
  }

  it("sem cookie, cai sempre na sociedade mais antiga (criadoEm), nunca ao acaso", async () => {
    entrarComDuasSociedades();
    const s1 = await sessaoAtual();
    expect(s1?.eu.organizacaoId).toBe("org-1");

    // A mesma chamada, outra vez — determinístico é não variar entre pedidos,
    // mesmo com as linhas devolvidas na mesma ordem (o mock simula o que o
    // `ORDER BY` real garante).
    const s2 = await sessaoAtual();
    expect(s2?.eu.organizacaoId).toBe("org-1");
  });

  it("a sessão devolve as outras sociedades da conta, para o seletor decidir se aparece", async () => {
    entrarComDuasSociedades();
    const s = await sessaoAtual();
    expect(s?.eu.organizacaoId).toBe("org-1");
    expect(s?.outrasOrganizacoes).toEqual(["org-2"]);
  });

  it("com o cookie a apontar para uma sociedade da conta, essa é a escolhida", async () => {
    entrarComDuasSociedades();
    cookieSociedadeAtiva = "org-2";
    const s = await sessaoAtual();
    expect(s?.eu.organizacaoId).toBe("org-2");
    expect(s?.outrasOrganizacoes).toEqual(["org-1"]);
  });

  it("um cookie apontando para uma sociedade alheia é ignorado — cai na ordenação, nunca num acesso não autorizado", async () => {
    entrarComDuasSociedades();
    cookieSociedadeAtiva = "org-alheia";
    const s = await sessaoAtual();
    expect(s?.eu.organizacaoId).toBe("org-1");
  });

  it("o cookie não tem efeito nenhum com uma única sociedade", async () => {
    entrarComo("society_admin");
    cookieSociedadeAtiva = "org-1";
    const s = await sessaoAtual();
    expect(s?.eu.organizacaoId).toBe("org-1");
    expect(s?.outrasOrganizacoes).toEqual([]);
  });

  it("o nome do cookie é o mesmo que sessaoAtual() e trocarSociedade() combinam", () => {
    expect(COOKIE_SOCIEDADE_ATIVA).toBe("sociedade_ativa");
  });
});
