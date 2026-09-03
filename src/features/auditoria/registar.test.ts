import { beforeEach, describe, expect, it, vi } from "vitest";
import { calcularHash, type EntradaAuditoria } from "./hash";

/**
 * A minimização acontece **dentro** de `registarEvento`, e é aí que tem de ser
 * provada: a garantia não é «quem chama lembra-se de redigir», é «não há
 * caminho de escrita que possa esquecer-se». Um teste sobre `minimizarPii`
 * sozinho não distingue as duas coisas.
 *
 * A base de dados é substituída por um duplo que guarda o que lhe mandam
 * inserir — o que interessa medir é a linha que ia para a tabela.
 */

type Linha = Record<string, unknown>;
const inseridas: Linha[] = [];

vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            // Sem linha anterior: primeira entrada da cadeia desta organização.
            limit: async () => [],
          }),
        }),
      }),
    }),
    insert: () => ({
      values: async (v: Linha) => {
        inseridas.push(v);
      },
    }),
  }),
}));

vi.mock("@/db/schema/auditoria", () => ({ eventoAuditoria: {} }));

const { registarEvento } = await import("./registar");

const ORG = "0197a1c0-0000-7000-8000-0000000000aa";

beforeEach(() => {
  inseridas.length = 0;
});

describe("registarEvento — minimização antes do hash", () => {
  it("não grava o NIF, a morada nem a data de nascimento que lhe passaram", async () => {
    await registarEvento({
      organizacaoId: ORG,
      acao: "passo.2.gravado",
      entidade: "dados_fiscais",
      valorNovo: {
        nif: "249886344",
        morada: "Rua das Flores 12",
        dataNascimento: "1980-04-12",
        passo: 2,
      },
    });

    const valorNovo = inseridas[0].valorNovo as Linha;
    expect(valorNovo).not.toHaveProperty("nif");
    expect(valorNovo).not.toHaveProperty("morada");
    expect(valorNovo).not.toHaveProperty("dataNascimento");
    expect(valorNovo.passo).toBe(2);
    expect(valorNovo._redigidos).toEqual(["dataNascimento", "morada", "nif"]);
  });

  it("redige também o `valorAnterior` — uma correção grava os dois lados", async () => {
    await registarEvento({
      organizacaoId: ORG,
      acao: "processo.seccao_atualizada",
      entidade: "dados_identificacao",
      valorAnterior: { telefone: "912345678" },
      valorNovo: { telefone: "913333333" },
    });

    expect(inseridas[0].valorAnterior).toEqual({ _redigidos: ["telefone"] });
    expect(inseridas[0].valorNovo).toEqual({ _redigidos: ["telefone"] });
  });

  it("o email fica mascarado na linha gravada", async () => {
    await registarEvento({
      organizacaoId: ORG,
      acao: "link.enviado",
      entidade: "processo_onboarding",
      valorNovo: { para: "maria@exemplo.pt" },
    });

    expect(inseridas[0].valorNovo).toEqual({
      para: "m***@exemplo.pt",
      _redigidos: ["para"],
    });
  });

  it("o hash gravado fecha sobre o valor JÁ redigido — senão a cadeia não valida contra a tabela", async () => {
    await registarEvento({
      organizacaoId: ORG,
      acao: "passo.1.gravado",
      entidade: "dados_identificacao",
      valorNovo: { nif: "249886344", passo: 1 },
    });

    const linha = inseridas[0];
    const recalculado = calcularHash(
      {
        id: linha.id,
        organizacaoId: linha.organizacaoId,
        processoId: linha.processoId,
        atorId: linha.atorId,
        acao: linha.acao,
        entidade: linha.entidade,
        entidadeId: linha.entidadeId,
        valorAnterior: linha.valorAnterior,
        valorNovo: linha.valorNovo,
        ip: linha.ip,
        userAgent: linha.userAgent,
        criadoEm: linha.criadoEm,
      } as EntradaAuditoria,
      linha.hashAnterior as string | null,
    );

    expect(linha.hash).toBe(recalculado);
  });

  it("um evento sem dados pessoais entra tal e qual — nada de `_redigidos` a mais", async () => {
    await registarEvento({
      organizacaoId: ORG,
      acao: "processo.aprovado",
      entidade: "processo_onboarding",
      valorNovo: { estado: "aprovado" },
    });

    expect(inseridas[0].valorNovo).toEqual({ estado: "aprovado" });
  });

  it("sem valores, as duas colunas ficam a null e não a `{}`", async () => {
    await registarEvento({
      organizacaoId: ORG,
      acao: "processo.consultado",
      entidade: "processo_onboarding",
    });

    expect(inseridas[0].valorAnterior).toBeNull();
    expect(inseridas[0].valorNovo).toBeNull();
  });
});
