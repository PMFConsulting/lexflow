import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A consulta das mensagens de um processo.
 *
 * O que estes testes seguram não é o SQL — é a **condição**: sem o filtro da
 * sociedade, um identificador de processo vindo do URL bastava para servir os
 * endereços dos clientes de outra sociedade na secção «Emails» do dossier. É a
 * mesma regra que abre `listarEmails`, e é a que se perde primeiro quando
 * alguém acrescenta uma coluna à mão.
 */

type Condicao = unknown;

const chamadas: {
  colunas: Record<string, unknown>;
  condicao: Condicao;
  ordem: Condicao;
  limite: number | null;
} = { colunas: {}, condicao: null, ordem: null, limite: null };

let resultado: unknown[] = [];

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => ({ op: "and", c }),
  eq: (col: unknown, v: unknown) => ({ op: "eq", col, v }),
  asc: (col: unknown) => ({ op: "asc", col }),
  desc: (col: unknown) => ({ op: "desc", col }),
  or: (...c: unknown[]) => ({ op: "or", c }),
  ilike: (col: unknown, v: unknown) => ({ op: "ilike", col, v }),
  inArray: (col: unknown, v: unknown) => ({ op: "inArray", col, v }),
  count: () => "count",
  sql: () => "sql",
}));

vi.mock("@/db/schema/email", () => ({
  emailLog: {
    id: "email_log.id",
    para: "email_log.para",
    assunto: "email_log.assunto",
    template: "email_log.template",
    estado: "email_log.estado",
    erro: "email_log.erro",
    canal: "email_log.canal",
    criadoEm: "email_log.criado_em",
    processoId: "email_log.processo_id",
    organizacaoId: "email_log.organizacao_id",
    mensagemId: "email_log.mensagem_id",
    verificadoEm: "email_log.verificado_em",
  },
}));

vi.mock("@/db/schema/processo", () => ({
  processoOnboarding: { id: "processo.id", referencia: "processo.referencia" },
}));

vi.mock("@/db", () => ({
  db: () => ({
    select: (colunas: Record<string, unknown>) => {
      chamadas.colunas = colunas;
      return {
        from: () => ({
          where: (condicao: Condicao) => {
            chamadas.condicao = condicao;
            return {
              orderBy: (ordem: Condicao) => {
                chamadas.ordem = ordem;
                return {
                  limit: async (n: number) => {
                    chamadas.limite = n;
                    return resultado;
                  },
                };
              },
            };
          },
        }),
      };
    },
  }),
}));

const { emailsDoProcesso, LIMITE } = await import("./consultas");

const PROCESSO = "0197a1c0-0000-7000-8000-0000000000aa";
const ORG = "0197a1c0-0000-7000-8000-0000000000bb";

/** As condições dentro do `and(...)`, achatadas para se poderem procurar. */
function condicoesDe(condicao: unknown): { col: unknown; v: unknown }[] {
  const c = condicao as { op?: string; c?: unknown[] };
  if (c?.op !== "and" || !Array.isArray(c.c)) return [];
  return c.c as { col: unknown; v: unknown }[];
}

describe("emailsDoProcesso", () => {
  beforeEach(() => {
    chamadas.colunas = {};
    chamadas.condicao = null;
    chamadas.ordem = null;
    chamadas.limite = null;
    resultado = [];
  });

  /**
   * O filtro que impede a fuga. Um processo e uma sociedade que não combinam
   * têm de dar zero linhas, e não as linhas do processo.
   */
  it("filtra pelo processo **e** pela sociedade", async () => {
    await emailsDoProcesso(PROCESSO, ORG);

    const condicoes = condicoesDe(chamadas.condicao);

    expect(condicoes).toContainEqual(
      expect.objectContaining({ col: "email_log.processo_id", v: PROCESSO }),
    );
    expect(condicoes).toContainEqual(
      expect.objectContaining({ col: "email_log.organizacao_id", v: ORG }),
    );
  });

  /**
   * A secção fica encostada à auditoria, que corre do mais antigo para o mais
   * recente. Duas cronologias lado a lado em sentidos opostos leem-se mal.
   */
  it("devolve por ordem cronológica crescente, ao contrário de /emails", async () => {
    await emailsDoProcesso(PROCESSO, ORG);

    expect(chamadas.ordem).toEqual({ op: "asc", col: "email_log.criado_em" });
    expect(chamadas.limite).toBe(LIMITE);
  });

  /**
   * A secção mostra o destinatário, o assunto, o template, o estado, o canal e
   * a data — e o erro, que é o que explica um estado de falha. Sem o `erro`, uma
   * linha a carmim dizia que algo correu mal e não dizia o quê.
   */
  it("traz as colunas que a secção mostra, incluindo o motivo da falha", async () => {
    await emailsDoProcesso(PROCESSO, ORG);

    expect(Object.keys(chamadas.colunas).sort()).toEqual(
      ["assunto", "canal", "criadoEm", "erro", "estado", "id", "para", "template"].sort(),
    );
  });

  /**
   * Não repete o que a página já sabe: a referência e o identificador do
   * processo seriam a mesma informação em todas as linhas.
   */
  it("não repete a referência nem o identificador do processo", async () => {
    await emailsDoProcesso(PROCESSO, ORG);

    expect(chamadas.colunas).not.toHaveProperty("referencia");
    expect(chamadas.colunas).not.toHaveProperty("processoId");
  });

  it("devolve as linhas tal como vêm da base de dados", async () => {
    const linha = {
      id: "1",
      para: "cliente@exemplo.pt",
      assunto: "LexFlow | Registro",
      template: "registo",
      estado: "entregue",
      erro: null,
      canal: "resend",
      criadoEm: new Date("2026-08-20T09:00:00Z"),
    };
    resultado = [linha];

    await expect(emailsDoProcesso(PROCESSO, ORG)).resolves.toEqual([linha]);
  });
});
