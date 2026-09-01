import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `criarProcesso`, do lado em que o email de registo se perde.
 *
 * O que estes testes fixam não é o envio — esse já estava certo, e está coberto
 * em `lib/email.test.ts`. É o **caminho até ao envio**: o `enviarEmail` está
 * atrás de um `if`, e chegar a esse `if` dependia de três `await` que ninguém
 * associava a email nenhum — `headers()`, o `registarEvento` do
 * `processo.criado` e o `origemPublica()`. Qualquer um deles a lançar deixava o
 * processo gravado e a Server Action rejeitada a meio, e o resultado era este:
 *
 *   · o processo em `/processos`;
 *   · `/emails` a «0 mensagens», porque quem escreve em `email_log` é o
 *     `enviarEmail` (D34) e ele nunca foi chamado;
 *   · nem `link.enviado`, nem `link.envio_falhou`, nem `link.sem_email`;
 *   · e a janela a dizer "o servidor não respondeu", que se lê como falha de
 *     rede e não como "este email nunca vai sair".
 *
 * Três avarias diferentes com um ecrã só — outra vez. Cada bloco em baixo
 * corresponde a uma delas, e o que asserta é sempre o mesmo: **o email foi
 * tentado à mesma**.
 */

const ORG = { id: "org-1", prefixoReferencia: "JM" };
const EU = { id: "utilizador-1", organizacaoId: "org-1", papel: "society_admin" };

let organizacoes: unknown[] = [ORG];
/** Falso quando se quer encenar uma chamada sem sessão iniciada. */
let haSessao = true;
const auditados: { acao: string; valorNovo?: Record<string, unknown> }[] = [];
const enviados: { para: string; template: string; html: string }[] = [];
const processosInseridos: Record<string, unknown>[] = [];

let auditoriaRebentaEm: string | null = null;
let envioRebenta = false;
let resultadoEnvio: { ok: boolean; erro?: string } = { ok: true };
let cabecalhosRebentam = false;
let origemRebenta = false;
let revalidacaoRebenta = false;

/**
 * O estado do "vai lá ver se o link abre".
 *
 * `acessoPorToken` é a mesma função que serve a página do cliente, e é ela que
 * `criarProcesso` usa para experimentar o link antes de o entregar a alguém.
 * Aqui controla-se o que ela responde: `ok` no percurso normal, `desconhecido`
 * para encenar um token que ficou gravado e não abre.
 */
let acessoDevolve: "ok" | "desconhecido" | "ok-depois-de-repor" = "ok";
let acessosPedidos = 0;
const atualizacoes: Record<string, unknown>[] = [];

/** Quantas vezes o INSERT do processo rebenta antes de deixar passar, e com que erro. */
let insercoesQueRebentam: { code: string; constraint_name: string }[] = [];

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    if (revalidacaoRebenta) throw new Error("revalidatePath fora de contexto");
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => {
    if (cabecalhosRebentam) throw new Error("headers() fora de um pedido");
    return new Headers({ "x-forwarded-for": "1.2.3.4", "user-agent": "vitest" });
  },
}));

/** Os construtores de condição do Drizzle não têm nada a dizer sobre tabelas falsas. */
vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c,
  eq: (...c: unknown[]) => c,
  sql: (...c: unknown[]) => c,
}));

vi.mock("@/db/schema/organizacao", () => ({
  organizacao: "organizacao",
  contadorReferencia: { organizacaoId: "org_id", ano: "ano", ultimo: "ultimo" },
}));

vi.mock("@/db/schema/processo", () => ({ processoOnboarding: "processo_onboarding" }));

/**
 * A sessão do back-office.
 *
 * `criarProcesso` deixou de ser uma ação pública (D59): sem sessão não há
 * processo nem email. O guard real redireciona para `/entrar`, e um
 * `redirect()` do Next é uma exceção — é isso que o mock imita, para o teste
 * poder afirmar que **nada** acontece do outro lado.
 *
 * `exigirEquipaDaSociedade` (D61) no lugar do antigo `exigirSessao`: além da
 * sessão, exige um papel **com** sociedade, e devolve `organizacaoId` já como
 * `string`. É o que impede o `super_admin` — que a tem a `null` — de abrir
 * processos numa sociedade que não é dele, porque não é de nenhuma.
 */
vi.mock("@/lib/sessao", () => ({
  exigirEquipaDaSociedade: async () => {
    if (!haSessao) throw new Error("NEXT_REDIRECT;/entrar");
    return { conta: { id: "auth-1" }, eu: EU };
  },
  exigirEquipaOuSuperAdmin: async () => {
    if (!haSessao) throw new Error("NEXT_REDIRECT;/entrar");
    return { conta: { id: "auth-1" }, eu: EU };
  },
  podeAcederSociedade: () => true,
  podeAprovarProcesso: () => true,
}));

vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        limit: async () => organizacoes,
        where: () => ({ limit: async () => organizacoes }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoNothing: async () => undefined,
        returning: async () => {
          const rebenta = insercoesQueRebentam.shift();
          if (rebenta) throw Object.assign(new Error("duplicate key"), rebenta);
          processosInseridos.push(v);
          return [{ ...v, id: "proc-1" }];
        },
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          // O contador da referência pede `returning()`; a reposição do token
          // não pede nada e é esperada tal como está. Guardar o `set` é o que
          // permite ver **o quê** é que a reposição escreveu.
          atualizacoes.push(v);
          return { returning: async () => [{ ultimo: 7 }] };
        },
      }),
    }),
  }),
}));

vi.mock("@/features/onboarding/dados", () => ({
  acessoPorToken: async (token: string) => {
    acessosPedidos++;
    if (acessoDevolve === "ok-depois-de-repor" && acessosPedidos === 1) {
      return { estado: "desconhecido" };
    }
    if (acessoDevolve === "desconhecido") return { estado: "desconhecido" };
    return {
      estado: "ok",
      token,
      processo: { id: "proc-1", referencia: "JM-2026-0007", tokenAcessoHash: "sha256-do-token" },
    };
  },
}));

vi.mock("@/features/auditoria/registar", () => ({
  registarEvento: async (e: { acao: string; valorNovo?: Record<string, unknown> }) => {
    if (auditoriaRebentaEm === e.acao) {
      throw new Error(`a cadeia de auditoria recusou ${e.acao}`);
    }
    auditados.push(e);
  },
}));

vi.mock("@/lib/email", () => ({
  enviarEmail: async (p: { para: string; template: string; html: string }) => {
    if (envioRebenta) throw new Error("o canal de email rebentou");
    enviados.push(p);
    return resultadoEnvio;
  },
}));

vi.mock("@/lib/emails/jmassano", () => ({
  ASSUNTO_REGISTO: "LexFlow | Registro",
  emailRegisto: ({ link }: { link: string }) => `<a href="${link}">link</a>`,
}));

vi.mock("@/lib/origem", () => ({
  origemPublica: async () => {
    if (origemRebenta) throw new Error("sem cabeçalho de anfitrião");
    return "https://poc.terlicalabs.com";
  },
}));

/**
 * O par sai da mesma chamada — é esse o ponto de `novoTokenAcesso`, e é por
 * isso que o mock não tem como devolver um hash que não seja o daquele token.
 */
vi.mock("@/lib/token", () => ({
  novoTokenAcesso: () => ({ token: "token-em-claro", hash: "sha256-do-token" }),
  expiraDaquiA: () => new Date("2027-01-01T00:00:00.000Z"),
}));

const { criarProcesso } = await import("./acoes");

/**
 * A carga exata que o `BotaoNovoProcesso` constrói para uma pessoa singular —
 * com a chave `nome` **presente** e a `undefined`, que não é o mesmo objeto que
 * `{ email }` para um `z.preprocess`.
 */
const carga = (email?: string) => ({ tipoCliente: "particular" as const, nome: undefined, email });

beforeEach(() => {
  organizacoes = [ORG];
  haSessao = true;
  auditados.length = 0;
  enviados.length = 0;
  processosInseridos.length = 0;
  auditoriaRebentaEm = null;
  envioRebenta = false;
  resultadoEnvio = { ok: true };
  cabecalhosRebentam = false;
  origemRebenta = false;
  revalidacaoRebenta = false;
  acessoDevolve = "ok";
  acessosPedidos = 0;
  atualizacoes.length = 0;
  insercoesQueRebentam = [];
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("criarProcesso — o percurso normal", () => {
  it("envia o email de registo quando o endereço vem preenchido", async () => {
    const r = await criarProcesso(carga("teste1@emalupe.com"));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({ para: "teste1@emalupe.com", template: "registo" });
    expect(enviados[0].html).toContain("https://poc.terlicalabs.com/onboarding/token-em-claro");
    expect(r.emailEnviado).toBe(true);
    expect(r.paraServidor).toBe("teste1@emalupe.com");
    expect(auditados.map((e) => e.acao)).toEqual(["processo.criado", "link.enviado"]);
  });

  it("guarda o endereço no processo, em minúsculas", async () => {
    await criarProcesso(carga("  TESTE1@Emalupe.COM  "));

    expect(processosInseridos.at(-1)).toMatchObject({ emailCliente: "teste1@emalupe.com" });
    expect(enviados[0]?.para).toBe("teste1@emalupe.com");
  });

  it("sem endereço, não tenta enviar e escreve link.sem_email", async () => {
    const r = await criarProcesso(carga(undefined));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(enviados).toHaveLength(0);
    expect(r.paraServidor).toBeNull();
    expect(auditados.map((e) => e.acao)).toEqual(["processo.criado", "link.sem_email"]);
  });

  it("o motivo de um envio recusado chega à janela e à auditoria", async () => {
    resultadoEnvio = { ok: false, erro: "Resend devolveu 403 (de=POC@jmassano.pt): not verified" };

    const r = await criarProcesso(carga("teste1@emalupe.com"));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.emailEnviado).toBe(false);
    expect(r.erroEmail).toContain("403");
    expect(auditados.at(-1)).toMatchObject({ acao: "link.envio_falhou" });
  });
});

/**
 * O bloco que este ficheiro existe para ter.
 *
 * Cada um destes três `await` corria sem rede por baixo, entre o INSERT do
 * processo e o `if (emailCliente)`. Nenhum deles tem nada a ver com email — e
 * era exatamente por isso que a leitura do caminho do envio nunca fechava o
 * caso: o caminho do envio estava certo, e nunca era percorrido.
 */
describe("criarProcesso — nada entre o processo gravado e o envio pode cancelá-lo", () => {
  it("uma auditoria do processo.criado que rebenta já não engole o email", async () => {
    auditoriaRebentaEm = "processo.criado";

    const r = await criarProcesso(carga("teste1@emalupe.com"));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(enviados).toHaveLength(1);
    expect(r.emailEnviado).toBe(true);
    // O evento perdeu-se — mas o do envio ficou, e o cliente recebeu.
    expect(auditados.map((e) => e.acao)).toEqual(["link.enviado"]);
  });

  it("um headers() que rebenta já não engole o email", async () => {
    cabecalhosRebentam = true;

    const r = await criarProcesso(carga("teste1@emalupe.com"));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(enviados).toHaveLength(1);
    expect(r.token).toBe("token-em-claro");
  });

  it("um origemPublica() que rebenta manda o email com o link relativo", async () => {
    origemRebenta = true;

    const r = await criarProcesso(carga("teste1@emalupe.com"));

    expect(r.ok).toBe(true);
    expect(enviados).toHaveLength(1);
    // Um link com o anfitrião em falta ainda se corrige a olho na caixa de
    // correio; um email que não sai não se corrige de todo.
    expect(enviados[0].html).toContain("/onboarding/token-em-claro");
  });

  it("um revalidatePath() que rebenta já não perde o token em claro", async () => {
    revalidacaoRebenta = true;

    const r = await criarProcesso(carga("teste1@emalupe.com"));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.token).toBe("token-em-claro");
    expect(enviados).toHaveLength(1);
  });

  it("uma auditoria do link.enviado que rebenta não desfaz o envio", async () => {
    auditoriaRebentaEm = "link.enviado";

    const r = await criarProcesso(carga("teste1@emalupe.com"));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(enviados).toHaveLength(1);
    // O email saiu; foi o registo dele que se perdeu. Dizer à janela que o
    // envio falhou por causa disso seria mandar procurar no Resend uma avaria
    // que está no Postgres.
    expect(r.emailEnviado).toBe(true);
    expect(r.token).toBe("token-em-claro");
  });

  it("um enviarEmail que rebenta devolve o motivo em vez de rejeitar a ação", async () => {
    envioRebenta = true;

    const r = await criarProcesso(carga("teste1@emalupe.com"));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.emailEnviado).toBe(false);
    expect(r.erroEmail).toContain("rebentou");
    expect(r.token).toBe("token-em-claro");
  });
});

describe("criarProcesso — o que o schema recusa, recusa antes de haver processo", () => {
  it("um email sem domínio não cria processo e diz qual é o campo", async () => {
    const r = await criarProcesso({ tipoCliente: "particular", email: "maria@exemplo" });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.campo).toBe("email");
    expect(processosInseridos).toHaveLength(0);
    expect(enviados).toHaveLength(0);
  });

  it("um NIPC com o dígito de controlo errado não cria processo", async () => {
    const r = await criarProcesso({
      tipoCliente: "empresa",
      nome: "Silva & Costa, Lda.",
      nif: "501442601",
      email: "geral@silvacosta.pt",
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.campo).toBe("nif");
    expect(processosInseridos).toHaveLength(0);
  });

  it("sem organização criada, não há processo nem email", async () => {
    organizacoes = [];

    const r = await criarProcesso(carga("teste1@emalupe.com"));

    expect(r.ok).toBe(false);
    expect(enviados).toHaveLength(0);
  });
});

/**
 * A porta da rua.
 *
 * Isto era uma Server Action pública: um `POST` ao identificador da ação criava
 * um processo e fazia sair o email de registo — em nome da sociedade, do
 * domínio da sociedade e à custa da quota do fornecedor — para qualquer
 * endereço que o corpo do pedido trouxesse. Não é uma fuga de dados; é um
 * remetente de spam com a assinatura de um escritório de advogados.
 */
describe("criarProcesso — sem sessão não há processo nem email", () => {
  it("uma chamada sem sessão não chega ao INSERT nem ao envio", async () => {
    haSessao = false;

    await expect(criarProcesso(carga("teste1@emalupe.com"))).rejects.toThrow("NEXT_REDIRECT");

    expect(processosInseridos).toHaveLength(0);
    expect(enviados).toHaveLength(0);
    expect(auditados).toHaveLength(0);
  });
});

/**
 * O link mágico, do lado em que ele dá 404.
 *
 * Um processo criado com um link que não abre é a avaria que só se manifesta
 * do lado do cliente, dias depois, e que do lado de cá não deixa nada: o
 * processo está em `/processos`, a janela mostrou um endereço com ar normal, e
 * quem o recebeu é que fica sem forma de provar que carregou no botão certo.
 * Cada bloco em baixo fecha uma das maneiras de lá chegar.
 */
describe("criarProcesso — o link entregue é o link que abre", () => {
  it("o link da janela é exatamente o que segue no email", async () => {
    const r = await criarProcesso(carga("teste1@emalupe.com"));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.link).toBe("https://poc.terlicalabs.com/onboarding/token-em-claro");
    // O mesmo texto nos dois sítios. Montado em dois sítios, bastava o
    // back-office estar aberto noutro anfitrião para passarem a ser dois.
    expect(enviados[0].html).toContain(r.link);
  });

  it("o link é montado mesmo quando não há email a enviar", async () => {
    const r = await criarProcesso(carga(undefined));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.link).toBe("https://poc.terlicalabs.com/onboarding/token-em-claro");
    expect(r.linkVerificado).toBe(true);
  });

  it("o token gravado é experimentado antes de ser entregue", async () => {
    const r = await criarProcesso(carga("teste1@emalupe.com"));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(acessosPedidos).toBeGreaterThanOrEqual(1);
    expect(r.linkVerificado).toBe(true);
  });

  it("um token que não abre é reposto, e a reposição escreve o hash daquele token", async () => {
    acessoDevolve = "ok-depois-de-repor";

    const r = await criarProcesso(carga("teste1@emalupe.com"));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(atualizacoes).toContainEqual(
      expect.objectContaining({ tokenAcessoHash: "sha256-do-token", apagadoEm: null }),
    );
    expect(r.linkVerificado).toBe(true);
  });

  it("um token que não abre nem depois de reposto avisa a janela e a auditoria", async () => {
    acessoDevolve = "desconhecido";

    const r = await criarProcesso(carga("teste1@emalupe.com"));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // O processo existe — não se desfaz um INSERT confirmado —, mas quem o
    // criou fica a saber no ecrã que o link não serve, em vez de o enviar.
    expect(r.linkVerificado).toBe(false);
    expect(auditados.map((e) => e.acao)).toContain("link.nao_resolve");
  });

  it("uma colisão na referência tira outro número e mantém o mesmo token", async () => {
    insercoesQueRebentam = [
      { code: "23505", constraint_name: "processo_referencia_org" },
    ];

    const r = await criarProcesso(carga("teste1@emalupe.com"));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(processosInseridos).toHaveLength(1);
    expect(r.token).toBe("token-em-claro");
    expect(enviados).toHaveLength(1);
  });

  it("uma colisão no token recupera a linha que já lá está, em vez de desistir", async () => {
    // O INSERT chegou a ser confirmado pelo Postgres e a resposta perdeu-se:
    // a linha existe com este token. Repetir com o mesmo token nunca podia
    // funcionar, e o que estava aqui repetia-o quatro vezes e desistia — com um
    // processo real do outro lado a que ninguém voltava a chegar, porque o
    // único token que o abre estava nesta chamada.
    insercoesQueRebentam = Array.from({ length: 5 }, () => ({
      code: "23505",
      constraint_name: "processo_token",
    }));

    const r = await criarProcesso(carga("teste1@emalupe.com"));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.referencia).toBe("JM-2026-0007");
    expect(r.token).toBe("token-em-claro");
    expect(r.linkVerificado).toBe(true);
    expect(enviados).toHaveLength(1);
  });

  it("super_admin pode criar processo numa sociedade fornecendo organizacaoId", async () => {
    const r = await criarProcesso({
      ...carga("cliente@empresa.pt"),
      organizacaoId: "org-1",
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.referencia).toBe("JM-2026-0007");
    expect(processosInseridos).toContainEqual(
      expect.objectContaining({ organizacaoId: "org-1" }),
    );
  });
});
