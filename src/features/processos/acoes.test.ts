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

let organizacoes: unknown[] = [ORG];
const auditados: { acao: string; valorNovo?: Record<string, unknown> }[] = [];
const enviados: { para: string; template: string; html: string }[] = [];
const processosInseridos: Record<string, unknown>[] = [];

let auditoriaRebentaEm: string | null = null;
let envioRebenta = false;
let resultadoEnvio: { ok: boolean; erro?: string } = { ok: true };
let cabecalhosRebentam = false;
let origemRebenta = false;
let revalidacaoRebenta = false;

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

vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({ from: () => ({ limit: async () => organizacoes }) }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoNothing: async () => undefined,
        returning: async () => {
          processosInseridos.push(v);
          return [{ ...v, id: "proc-1" }];
        },
      }),
    }),
    update: () => ({
      set: () => ({ where: () => ({ returning: async () => [{ ultimo: 7 }] }) }),
    }),
  }),
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
  ASSUNTO_REGISTO: "JMASSANO | Registro",
  emailRegisto: ({ link }: { link: string }) => `<a href="${link}">link</a>`,
}));

vi.mock("@/lib/origem", () => ({
  origemPublica: async () => {
    if (origemRebenta) throw new Error("sem cabeçalho de anfitrião");
    return "https://poc.terlicalabs.com";
  },
}));

vi.mock("@/lib/token", () => ({
  gerarToken: () => "token-em-claro",
  hashToken: () => "sha256-do-token",
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
  auditados.length = 0;
  enviados.length = 0;
  processosInseridos.length = 0;
  auditoriaRebentaEm = null;
  envioRebenta = false;
  resultadoEnvio = { ok: true };
  cabecalhosRebentam = false;
  origemRebenta = false;
  revalidacaoRebenta = false;
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
