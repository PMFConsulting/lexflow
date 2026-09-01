import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `aprovarProcesso` e `rejeitarProcesso` — a decisão do back-office sobre um
 * processo em `aguardar_aprovacao`.
 *
 * Separado de `acoes.test.ts` (que fixa `criarProcesso`) porque o harness de
 * base de dados aqui precisa de dispatchar por tabela — o mesmo padrão do
 * `features/onboarding/acoes.test.ts` — e misturar os dois num só ficheiro
 * tornava os mocks difíceis de ler.
 */

type Linha = Record<string, unknown>;

const auditados: { acao: string; valorAnterior?: Linha; valorNovo?: Linha }[] = [];
const enviados: { para: string; template: string; html: string }[] = [];
const boasVindasEnviadas: { processoId: string; para: string; nome: string | null }[] = [];
const atualizacoes: { tabela: string; valores: Linha }[] = [];

let linhas: Record<string, Linha[]> = {};
let papelAtual = "utilizador";
let boasVindasRebenta = false;
let emailRejeicaoRebenta = false;

const PROCESSO = (extra: Linha = {}): Linha => ({
  id: "proc-1",
  organizacaoId: "org-1",
  referencia: "JM-2026-0007",
  tipoCliente: "particular",
  estado: "aguardar_aprovacao",
  motivoRejeicao: null,
  ...extra,
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "1.2.3.4", "user-agent": "vitest" }),
}));

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

vi.mock("@/db/schema/seccoes", () => ({
  dadosIdentificacao: "dados_identificacao",
  dadosFaturacao: "dados_faturacao",
}));

let auditoriaRebenta = false;
/**
 * TOCTOU: encena outro pedido a decidir o mesmo processo entre o SELECT de
 * `processoParaDecisao` e este UPDATE — a guarda de estado no próprio UPDATE
 * (`WHERE id = ? AND estado = 'aguardar_aprovacao'`) devolve zero linhas
 * quando isso acontece, e é isso que o mock aqui imita.
 */
let updateNaoAfetaLinhas = false;

/** Um SELECT por tabela (dispatchado pelo nome) e um diário de UPDATEs. */
vi.mock("@/db", () => {
  const esperavel = <T extends object>(extra: T) => ({
    ...extra,
    then: (aceitar: (v: unknown) => unknown) => Promise.resolve(undefined).then(aceitar),
  });

  const api = {
    select: () => ({
      from: (t: unknown) => ({
        where: () => ({
          limit: async () => linhas[String(t)] ?? [],
        }),
      }),
    }),
    update: (t: unknown) => ({
      set: (v: Linha) => ({
        where: () => {
          if (updateNaoAfetaLinhas) {
            return esperavel({ returning: async () => [] });
          }
          atualizacoes.push({ tabela: String(t), valores: v });
          return esperavel({
            returning: async () => [{ ...(linhas[String(t)]?.[0] ?? {}), ...v }],
          });
        },
      }),
    }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(api),
  };

  return {
    db: () => api,
  };
});

vi.mock("@/features/onboarding/dados", () => ({
  acessoPorToken: async () => ({ estado: "desconhecido" }),
}));

vi.mock("@/features/auditoria/registar", () => ({
  registarEvento: async (e: { acao: string; valorAnterior?: Linha; valorNovo?: Linha }) => {
    if (auditoriaRebenta) throw new Error("a auditoria falhou");
    auditados.push(e);
  },
}));

vi.mock("@/lib/email", () => ({
  enviarEmail: async (p: { para: string; template: string; html: string }) => {
    if (emailRejeicaoRebenta) throw new Error("o canal de email rebentou");
    enviados.push(p);
    return { ok: true, canal: "resend", mensagemId: null };
  },
}));

vi.mock("@/lib/emails/boas-vindas", () => ({
  enviarBoasVindas: async (
    processo: { id: string },
    para: string,
    nome: string | null,
  ) => {
    if (boasVindasRebenta) throw new Error("as boas-vindas rebentaram");
    boasVindasEnviadas.push({ processoId: processo.id, para, nome });
    return { ok: true, canal: "resend", mensagemId: null };
  },
}));

vi.mock("@/lib/emails/jmassano", () => ({
  ASSUNTO_REGISTO: "LexFlow | Registro",
  emailRegisto: ({ link }: { link: string }) => `<a href="${link}">link</a>`,
  ASSUNTO_REJEICAO: "LexFlow | Feedback Registro",
  emailRejeicao: () => "<p>rejeição</p>",
}));

vi.mock("@/lib/origem", () => ({ origemPublica: async () => "https://poc.terlicalabs.com" }));

vi.mock("@/lib/token", () => ({
  novoTokenAcesso: () => ({ token: "token-em-claro", hash: "sha256-do-token" }),
  expiraDaquiA: () => new Date("2027-01-01T00:00:00.000Z"),
}));

/**
 * Os papéis mudaram (migração `0016`), a regra não.
 *
 * `advogado` — que aprovava — passou a `utilizador`, e continua a aprovar: essa
 * era a decisão conservadora da migração, porque tirar a aprovação a quem a
 * tinha é uma capacidade que desaparece sem aviso. Quem passou a não decidir é
 * o `super_admin`, e por uma razão diferente da do antigo `assistente`: a
 * decisão sobre um cliente é da sociedade que o aceita, e ele não está em
 * nenhuma.
 */
vi.mock("@/lib/sessao", () => ({
  exigirEquipaDaSociedade: async () => ({
    eu: { id: "user-1", papel: papelAtual, organizacaoId: "org-1" },
  }),
  exigirEquipaOuSuperAdmin: async () => ({
    eu: { id: "user-1", papel: papelAtual, organizacaoId: papelAtual === "super_admin" ? null : "org-1" },
  }),
  podeAcederSociedade: (eu: { papel: string; organizacaoId: string | null }, orgAlvo: string) =>
    eu.papel === "super_admin" || eu.organizacaoId === orgAlvo,
  podeAprovarProcesso: (papel: string) =>
    papel !== "desconhecido" && papel !== "super_admin",
  podeReabrirProcesso: (papel: string) =>
    papel === "society_admin" || papel === "gestor" || papel === "super_admin",
}));

const { aprovarProcesso, rejeitarProcesso } = await import("./acoes");

beforeEach(() => {
  auditados.length = 0;
  enviados.length = 0;
  boasVindasEnviadas.length = 0;
  atualizacoes.length = 0;
  linhas = { processo_onboarding: [PROCESSO()] };
  papelAtual = "utilizador";
  boasVindasRebenta = false;
  emailRejeicaoRebenta = false;
  auditoriaRebenta = false;
  updateNaoAfetaLinhas = false;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("aprovarProcesso", () => {
  it("aprova, grava quem e quando, e envia as boas-vindas ao cliente", async () => {
    linhas["dados_identificacao"] = [{ email: "maria@exemplo.pt", nome: "Maria Silva" }];

    const r = await aprovarProcesso("proc-1");

    expect(r).toEqual({ ok: true });
    expect(atualizacoes).toContainEqual({
      tabela: "processo_onboarding",
      valores: expect.objectContaining({
        estado: "aprovado",
        aprovadoPor: "user-1",
        aprovadoEm: expect.any(Date),
      }),
    });
    expect(auditados).toContainEqual(
      expect.objectContaining({
        acao: "processo.aprovado",
        valorAnterior: { estado: "aguardar_aprovacao" },
        valorNovo: { estado: "aprovado" },
      }),
    );
    expect(boasVindasEnviadas).toEqual([
      { processoId: "proc-1", para: "maria@exemplo.pt", nome: "Maria Silva" },
    ]);
  });

  it("sem endereço de email, aprova na mesma e não tenta enviar boas-vindas", async () => {
    linhas["dados_identificacao"] = [];
    linhas["dados_faturacao"] = [];

    const r = await aprovarProcesso("proc-1");

    expect(r).toEqual({ ok: true });
    expect(boasVindasEnviadas).toHaveLength(0);
  });

  it("uma falha a enviar as boas-vindas não desfaz a aprovação", async () => {
    linhas["dados_identificacao"] = [{ email: "maria@exemplo.pt", nome: "Maria Silva" }];
    boasVindasRebenta = true;

    const r = await aprovarProcesso("proc-1");

    expect(r).toEqual({ ok: true });
    expect(atualizacoes.some((a) => a.valores.estado === "aprovado")).toBe(true);
  });

  it("recusa um processo que não está à espera de aprovação", async () => {
    linhas["processo_onboarding"] = [PROCESSO({ estado: "rascunho" })];

    const r = await aprovarProcesso("proc-1");

    expect(r.ok).toBe(false);
    expect(atualizacoes).toHaveLength(0);
    expect(auditados).toHaveLength(0);
  });

  it("recusa quando o papel não pode decidir", async () => {
    papelAtual = "desconhecido";

    const r = await aprovarProcesso("proc-1");

    expect(r.ok).toBe(false);
    expect(atualizacoes).toHaveLength(0);
  });

  it("o super_admin não pode aprovar processos", async () => {
    papelAtual = "super_admin";
    linhas["dados_identificacao"] = [{ email: "maria@exemplo.pt", nome: "Maria Silva" }];

    const r = await aprovarProcesso("proc-1");

    expect(r.ok).toBe(false);
    expect(atualizacoes).toHaveLength(0);
  });

  it("falha de registarEvento na transação reverte a aprovação e devolve erro (BUG-008)", async () => {
    linhas["dados_identificacao"] = [{ email: "maria@exemplo.pt", nome: "Maria Silva" }];
    auditoriaRebenta = true;

    const r = await aprovarProcesso("proc-1");

    expect(r).toEqual({ ok: false, erro: "Não foi possível aprovar o processo." });
    expect(boasVindasEnviadas).toHaveLength(0);
  });

  it("um utilizador de outra organização não encontra o processo", async () => {
    papelAtual = "utilizador";
    linhas["processo_onboarding"] = [PROCESSO({ organizacaoId: "outra-org" })];

    const r = await aprovarProcesso("proc-1");

    expect(r.ok).toBe(false);
    expect(atualizacoes).toHaveLength(0);
  });

  it("TOCTOU: se o estado mudou entre o SELECT e o UPDATE, recusa em vez de decidir sobre dados obsoletos", async () => {
    linhas["dados_identificacao"] = [{ email: "maria@exemplo.pt", nome: "Maria Silva" }];
    updateNaoAfetaLinhas = true;

    const r = await aprovarProcesso("proc-1");

    expect(r).toEqual({ ok: false, erro: "O processo já mudou de estado — recarregue a página." });
    expect(auditados).toHaveLength(0);
    expect(boasVindasEnviadas).toHaveLength(0);
  });
});

describe("rejeitarProcesso", () => {
  it("exige o motivo antes de tocar na base de dados", async () => {
    const r = await rejeitarProcesso("proc-1", "   ");

    expect(r).toEqual({ ok: false, erro: "Indique o motivo da rejeição." });
    expect(atualizacoes).toHaveLength(0);
  });

  it("rejeita, grava o motivo e avisa o cliente por email", async () => {
    linhas["dados_identificacao"] = [{ email: "maria@exemplo.pt", nome: "Maria Silva" }];

    const r = await rejeitarProcesso("proc-1", "  Documentação incompleta  ");

    expect(r).toEqual({ ok: true });
    expect(atualizacoes).toContainEqual({
      tabela: "processo_onboarding",
      valores: { estado: "rejeitado", motivoRejeicao: "Documentação incompleta" },
    });
    expect(auditados).toContainEqual(
      expect.objectContaining({
        acao: "processo.rejeitado",
        valorAnterior: { estado: "aguardar_aprovacao" },
        valorNovo: { estado: "rejeitado", motivo: "Documentação incompleta" },
      }),
    );
    expect(enviados).toEqual([
      {
        para: "maria@exemplo.pt",
        template: "rejeicao",
        assunto: "LexFlow | Feedback Registro",
        html: "<p>rejeição</p>",
        organizacaoId: "org-1",
        processoId: "proc-1",
      },
    ]);
  });

  it("falha de registarEvento na transação reverte a rejeição e devolve erro (BUG-008)", async () => {
    linhas["dados_identificacao"] = [{ email: "maria@exemplo.pt", nome: "Maria Silva" }];
    auditoriaRebenta = true;

    const r = await rejeitarProcesso("proc-1", "Documentação incompleta");

    expect(r).toEqual({ ok: false, erro: "Não foi possível rejeitar o processo." });
    expect(enviados).toHaveLength(0);
  });

  it("sem endereço de email, rejeita na mesma e não notifica ninguém", async () => {
    linhas["dados_identificacao"] = [];
    linhas["dados_faturacao"] = [];

    const r = await rejeitarProcesso("proc-1", "Documentação incompleta");

    expect(r).toEqual({ ok: true });
    expect(enviados).toHaveLength(0);
  });

  it("uma falha a enviar o email de rejeição não desfaz a decisão", async () => {
    linhas["dados_identificacao"] = [{ email: "maria@exemplo.pt", nome: "Maria Silva" }];
    emailRejeicaoRebenta = true;

    const r = await rejeitarProcesso("proc-1", "Documentação incompleta");

    expect(r).toEqual({ ok: true });
    expect(atualizacoes.some((a) => a.valores.estado === "rejeitado")).toBe(true);
  });

  it("recusa um processo que não está à espera de aprovação", async () => {
    linhas["processo_onboarding"] = [PROCESSO({ estado: "aprovado" })];

    const r = await rejeitarProcesso("proc-1", "Documentação incompleta");

    expect(r.ok).toBe(false);
    expect(atualizacoes).toHaveLength(0);
  });

  it("recusa quando o papel não pode decidir", async () => {
    papelAtual = "desconhecido";

    const r = await rejeitarProcesso("proc-1", "Documentação incompleta");

    expect(r.ok).toBe(false);
    expect(atualizacoes).toHaveLength(0);
  });

  it("o super_admin não pode rejeitar processos", async () => {
    papelAtual = "super_admin";
    linhas["dados_identificacao"] = [{ email: "maria@exemplo.pt", nome: "Maria Silva" }];

    const r = await rejeitarProcesso("proc-1", "Documentação incompleta");

    expect(r.ok).toBe(false);
    expect(atualizacoes).toHaveLength(0);
  });

  it("TOCTOU: se o estado mudou entre o SELECT e o UPDATE, recusa em vez de sobrepor a decisão", async () => {
    linhas["dados_identificacao"] = [{ email: "maria@exemplo.pt", nome: "Maria Silva" }];
    updateNaoAfetaLinhas = true;

    const r = await rejeitarProcesso("proc-1", "Documentação incompleta");

    expect(r).toEqual({ ok: false, erro: "O processo já mudou de estado — recarregue a página." });
    expect(auditados).toHaveLength(0);
    expect(enviados).toHaveLength(0);
  });
});
