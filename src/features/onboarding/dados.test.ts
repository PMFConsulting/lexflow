import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `acessoPorToken` — o que responde a um link que não abre.
 *
 * O que aqui se fixa é a diferença entre quatro coisas que o `notFound()`
 * dizia todas com a mesma frase: o link expirou, o dossier foi arquivado, o
 * endereço não corresponde a nada, e está tudo bem. As três primeiras têm
 * saídas diferentes — pedir a renovação, falar com a sociedade, voltar ao email
 * e copiar o link inteiro — e nenhuma delas é "voltar ao início".
 *
 * E fixa-se também o que **não** se revela: quem anda a adivinhar tokens
 * continua a receber `desconhecido` e mais nada.
 */

const AGORA = new Date("2026-08-10T12:00:00.000Z");

/** A linha que o Postgres devolve, ou nenhuma. */
let linha: Record<string, unknown> | undefined;
let condicoes: unknown[] = [];

vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: (c: unknown) => {
          condicoes.push(c);
          return { limit: async () => (linha ? [linha] : []) };
        },
      }),
    }),
  }),
}));

const { acessoPorToken, motivoDoAcesso } = await import("./dados");
const { hashToken } = await import("@/lib/token");

const TOKEN = "abcDEF123_-abcDEF123_-abcDEF123_-abcDEF123x";

const processo = (extra: Record<string, unknown> = {}) => ({
  id: "proc-1",
  referencia: "JM-2026-0007",
  tokenAcessoHash: hashToken(TOKEN),
  apagadoEm: null,
  expiraEm: new Date("2026-09-01T00:00:00.000Z"),
  ...extra,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  linha = processo();
  condicoes = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("acessoPorToken", () => {
  it("um token válido devolve o processo e o token já normalizado", async () => {
    const r = await acessoPorToken(`  ${TOKEN}.`);

    expect(r.estado).toBe("ok");
    if (r.estado !== "ok") return;
    expect(r.processo.referencia).toBe("JM-2026-0007");
    // O ponto final que veio colado da frase do email não segue para os links
    // dos passos seguintes — é aqui que ele sai do endereço.
    expect(r.token).toBe(TOKEN);
  });

  it("um processo arquivado diz que foi arquivado, com a referência", async () => {
    linha = processo({ apagadoEm: new Date("2026-08-01T00:00:00.000Z") });

    const r = await acessoPorToken(TOKEN);

    expect(r).toEqual({ estado: "arquivado", referencia: "JM-2026-0007" });
  });

  it("um link expirado diz que expirou, e não que a página não existe", async () => {
    const expirouEm = new Date("2026-08-01T00:00:00.000Z");
    linha = processo({ expiraEm: expirouEm });

    const r = await acessoPorToken(TOKEN);

    expect(r).toEqual({ estado: "expirado", referencia: "JM-2026-0007", expirouEm });
  });

  it("um processo sem data de validade não expira", async () => {
    linha = processo({ expiraEm: null });

    expect((await acessoPorToken(TOKEN)).estado).toBe("ok");
  });

  it("um token que não bate com nada não diz nada a quem o inventou", async () => {
    linha = undefined;

    expect(await acessoPorToken(TOKEN)).toEqual({ estado: "desconhecido" });
  });

  it("um token curto demais nem chega à base de dados", async () => {
    linha = undefined;

    expect(await acessoPorToken("abc")).toEqual({ estado: "desconhecido" });
    expect(await acessoPorToken("")).toEqual({ estado: "desconhecido" });
    expect(condicoes).toHaveLength(0);
  });

  /**
   * O filtro do apagado saiu do `where` de propósito. Estando lá dentro, um
   * processo arquivado e um token inventado devolviam os dois zero linhas — e
   * nenhum ecrã, por mais que quisesse, conseguia distingui-los.
   */
  it("a consulta é só pelo hash; a classificação vem depois", async () => {
    await acessoPorToken(TOKEN);

    expect(condicoes).toHaveLength(1);
  });
});

describe("motivoDoAcesso — a mesma explicação em todos os sítios", () => {
  it.each(["expirado", "arquivado", "desconhecido"] as const)(
    "%s tem título, o que fazer a seguir, e nunca fica vazio",
    (estado) => {
      const m = motivoDoAcesso(
        estado === "desconhecido"
          ? { estado }
          : estado === "arquivado"
            ? { estado, referencia: "JM-2026-0007" }
            : { estado, referencia: "JM-2026-0007", expirouEm: AGORA },
      );

      expect(m.titulo.length).toBeGreaterThan(0);
      expect(m.descricao.length).toBeGreaterThan(0);
    },
  );

  it("um token desconhecido não leva referência nenhuma no ecrã", () => {
    // A referência é de quem já traz um token que bate certo. A quem inventou
    // o endereço não se confirma sequer que existe um processo.
    expect(motivoDoAcesso({ estado: "desconhecido" }).referencia).toBeUndefined();
  });
});
