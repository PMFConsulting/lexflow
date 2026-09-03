import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O Resumo Diário, agora com quem o dispare.
 *
 * O defeito que estes testes fecham não era um erro — era um silêncio: as duas
 * `notificarDono*` escreviam na fila, `consultarNotificacoesPendentes` não
 * tinha chamador nenhum e o resumo nunca saía. Nada em `email_log`, nada na
 * consola, nada a que perguntar porquê. O que se pina aqui é o contrário
 * disso: que a fila é lida, que o email sai, e — a parte que mais custa
 * enganar-se — que a fila **só** é marcada depois de o envio ser aceite.
 */

type LinhaPendente = {
  id: string;
  tipo: string;
  organizacaoId: string | null;
  dados: Record<string, unknown>;
  processadoEm: Date | null;
  criadoEm: Date;
};

let ambiente: Record<string, unknown> = {};
let pendentes: LinhaPendente[] = [];
let processos24h = 0;
let envioOk = true;

/** O que `enviarEmail` recebeu, para o assunto e o destino serem verificáveis. */
const enviados: Record<string, unknown>[] = [];
/** As marcações de `processado_em`, para se ver se a fila foi limpa e quando. */
const marcacoes: { valores: Record<string, unknown> }[] = [];

vi.mock("@/env", () => ({ env: () => ambiente }));

vi.mock("@/db/schema/notificacao", () => ({
  notificacoesPendentes: { id: "id", processadoEm: "processado_em" },
}));

vi.mock("@/db/schema/processo", () => ({
  processoOnboarding: { estado: "estado", submetidoEm: "submetido_em" },
}));

vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => a,
  count: () => "count",
  gte: (...a: unknown[]) => a,
  inArray: (...a: unknown[]) => a,
  isNotNull: (...a: unknown[]) => a,
  isNull: (...a: unknown[]) => a,
}));

vi.mock("@/db", () => ({
  db: () => ({
    /** A contagem dos processos das últimas 24h. */
    select: () => ({
      from: () => ({
        where: async () => [{ total: processos24h }],
      }),
    }),
    update: () => ({
      set: (valores: Record<string, unknown>) => ({
        where: async () => {
          marcacoes.push({ valores });
        },
      }),
    }),
  }),
}));

vi.mock("@/lib/email", () => ({
  enviarEmail: async (p: Record<string, unknown>) => {
    enviados.push(p);
    return envioOk
      ? { ok: true, canal: "resend", mensagemId: "abc" }
      : { ok: false, erro: "Resend devolveu 403" };
  },
}));

vi.mock("./consultas", () => ({
  consultarNotificacoesPendentes: async () => pendentes,
}));

const { executarResumoDiario } = await import("./resumo-diario");

const sociedade = (nome: string): LinhaPendente => ({
  id: `soc-${nome}`,
  tipo: "sociedade_criada",
  organizacaoId: "org-1",
  dados: { nome, nif: "509442013", prefixo: "AC", adminEmail: "admin@ac.pt" },
  processadoEm: null,
  criadoEm: new Date(),
});

beforeEach(() => {
  enviados.length = 0;
  marcacoes.length = 0;
  pendentes = [];
  processos24h = 0;
  envioOk = true;
  ambiente = { EMAIL_NOTIFICACOES: "dono@terlicalabs.com" };
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("executarResumoDiario", () => {
  it("com a fila vazia e sem processos, não envia nada", async () => {
    await expect(executarResumoDiario()).resolves.toMatchObject({
      enviado: false,
      motivo: "sem_eventos",
    });
    expect(enviados).toHaveLength(0);
  });

  it("com --forcar, envia mesmo sem eventos", async () => {
    await expect(executarResumoDiario({ forcar: true })).resolves.toMatchObject({ enviado: true });
    expect(enviados).toHaveLength(1);
  });

  /**
   * Sem destino não há aviso, e é uma decisão e não uma falha — a mesma regra
   * do D37: não há endereço por omissão.
   */
  it("sem EMAIL_NOTIFICACOES, não envia e não lê a fila", async () => {
    ambiente = {};
    pendentes = [sociedade("Andrade & Costa")];

    await expect(executarResumoDiario()).resolves.toMatchObject({
      enviado: false,
      motivo: "sem_destino",
    });
    expect(enviados).toHaveLength(0);
  });

  /**
   * `env()` valida o ambiente todo e lança por qualquer variável em falta — a
   * armadilha da D42. Aqui não pode matar o temporizador que chama isto.
   */
  it("se o ambiente rebentar, não propaga", async () => {
    ambiente = {};
    vi.doMock("@/env", () => ({
      env: () => {
        throw new Error("DATABASE_URL em falta");
      },
    }));

    await expect(executarResumoDiario()).resolves.toMatchObject({ enviado: false });
  });

  it("envia um email só, com o assunto a contar o que aconteceu", async () => {
    pendentes = [sociedade("Andrade & Costa"), sociedade("Mota & Associados")];
    processos24h = 3;

    await expect(executarResumoDiario()).resolves.toMatchObject({
      enviado: true,
      pendentes: 2,
      processos24h: 3,
    });

    expect(enviados).toHaveLength(1);
    expect(enviados[0]?.para).toBe("dono@terlicalabs.com");
    expect(enviados[0]?.template).toBe("notificacao_backoffice");
    expect(String(enviados[0]?.assunto)).toContain("2 novas sociedades");
    expect(String(enviados[0]?.html)).toContain("Andrade &amp; Costa");
  });

  it("marca a fila como processada depois de o envio ser aceite", async () => {
    pendentes = [sociedade("Andrade & Costa")];

    await executarResumoDiario();

    expect(marcacoes).toHaveLength(1);
    expect(marcacoes[0]?.valores.processadoEm).toBeInstanceOf(Date);
  });

  /**
   * A parte que mais custa enganar-se: um envio falhado que apagasse a fila
   * levava com ele os únicos vestígios dos eventos desse dia. Fica por marcar,
   * e o resumo seguinte volta a tentar com o mesmo conteúdo.
   */
  it("com o envio falhado, a fila fica intacta", async () => {
    pendentes = [sociedade("Andrade & Costa")];
    envioOk = false;

    await expect(executarResumoDiario()).resolves.toMatchObject({
      enviado: false,
      motivo: "falha_envio",
      erro: "Resend devolveu 403",
    });
    expect(marcacoes).toHaveLength(0);
  });
});
