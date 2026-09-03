import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Direitos do titular sobre os dados da sociedade (RGPD artigos 15.º, 17.º e
 * 20.º), do lado da camada de serviço.
 *
 * Os dois comportamentos que importam fixar:
 *  1. A exportação devolve a estrutura completa dos dados pessoais da
 *     organização e **não toca em nada** (é só leitura);
 *  2. A eliminação é **simulação por omissão** — sem `confirmar: true` não
 *     escreve uma linha; com confirmação, apaga por soft delete (nunca por
 *     remoção física) e deixa o rasto na auditoria primeiro.
 */

type Linha = Record<string, unknown>;
const linhas: Record<string, Linha[]> = {};
const atualizacoes: { tabela: string; set: Linha }[] = [];
const eventos: { acao: string; valorNovo?: unknown }[] = [];
let auditoriaAceita = true;

/* Tabelas como strings — o Drizzle não tem nada a dizer sobre elas aqui. */
vi.mock("@/db/schema/organizacao", () => ({
  organizacao: "t_organizacao",
  utilizador: "t_utilizador",
}));
vi.mock("@/db/schema/email", () => ({
  emailLog: "t_email_log",
}));
vi.mock("@/db/schema/auditoria", () => ({
  eventoAuditoria: "t_evento_auditoria",
}));
vi.mock("@/db/schema/sociedade", () => ({
  aceitacaoTermos: "t_aceitacao_termos",
  conviteUtilizador: "t_convite_utilizador",
  documentoOrganizacao: "t_documento_organizacao",
  onboardingSociedade: "t_onboarding_sociedade",
  perfilUtilizador: "t_perfil_utilizador",
}));

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c,
  eq: (coluna: unknown, valor: unknown) => ({ coluna, valor }),
  isNull: (c: unknown) => c,
  desc: (c: unknown) => c,
}));

vi.mock("@/features/auditoria/registar", () => ({
  registarEvento: async (entrada: { acao: string; valorNovo?: unknown }) => {
    if (!auditoriaAceita) throw new Error("auditoria recusou o evento");
    eventos.push({ acao: entrada.acao, valorNovo: entrada.valorNovo });
  },
}));

vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({
      from: (tabela: unknown) => ({
        where: () => {
          const filas = () => linhas[String(tabela)] ?? [];
          // O Drizzle devolve um thenable a partir do `.where()` (aguardado
          // diretamente no `Promise.all` da exportação) que também encadeia
          // `.orderBy()` e `.limit()`.
          return Object.assign(Promise.resolve(filas()), {
            limit: async (n?: number) => filas().slice(0, n),
            orderBy: () => ({
              limit: async (n?: number) => filas().slice(0, n),
            }),
          });
        },
      }),
    }),
    update: (tabela: unknown) => ({
      set: (v: Linha) => ({
        where: async () => {
          atualizacoes.push({ tabela: String(tabela), set: v });
        },
      }),
    }),
  }),
}));

const { exportarDadosDaSociedade, eliminarDadosDaSociedade } = await import("./direitos");

const ORG = {
  id: "018f1e2a-0000-7000-8000-000000000001",
  nome: "Sociedade de Advogados Exemplo",
  nif: "509442013",
  prefixoReferencia: "SE",
};

beforeEach(() => {
  Object.keys(linhas).forEach((k) => delete linhas[k]);
  atualizacoes.length = 0;
  eventos.length = 0;
  auditoriaAceita = true;
  linhas["t_organizacao"] = [ORG];
  linhas["t_onboarding_sociedade"] = [
    {
      id: "onb-1",
      organizacaoId: ORG.id,
      adminNome: "Ana",
      adminEmail: "ana@sociedade.pt",
      declaracaoVinculo: true,
      consentimentoPrivacidadeEm: new Date("2026-09-03T10:00:00.000Z"),
    },
  ];
  linhas["t_utilizador"] = [
    {
      id: "u-1",
      organizacaoId: ORG.id,
      nome: "Ana Silva",
      email: "ana@sociedade.pt",
      papel: "society_admin",
      ativo: true,
    },
  ];
  linhas["t_convite_utilizador"] = [{ id: "c-1", organizacaoId: ORG.id, email: "ana@sociedade.pt" }];
  linhas["t_perfil_utilizador"] = [
    { id: "p-1", organizacaoId: ORG.id, conviteId: "c-1", nomeCompleto: "Ana Silva" },
  ];
  linhas["t_aceitacao_termos"] = [
    { id: "at-1", organizacaoId: ORG.id, versao: "v1", aceiteEm: new Date() },
  ];
  linhas["t_documento_organizacao"] = [
    {
      id: "d-1",
      organizacaoId: ORG.id,
      nomeOriginal: "certidao.pdf",
      tipo: "certidao_sociedade",
      mime: "application/pdf",
      tamanhoBytes: 1000,
      conviteId: null,
      criadoEm: new Date(),
      dados: null,
    },
  ];
  linhas["t_email_log"] = [
    { id: "e-1", organizacaoId: ORG.id, para: "ana@sociedade.pt", template: "convite_sociedade" },
  ];
  linhas["t_evento_auditoria"] = [
    { id: "ev-1", organizacaoId: ORG.id, acao: "sociedade.submetida", criadoEm: new Date() },
  ];
});

describe("exportarDadosDaSociedade (artigos 15.º e 20.º)", () => {
  it("devolve os dados pessoais da organização sem escrever nada", async () => {
    const dados = await exportarDadosDaSociedade(ORG.id);

    expect(dados.sociedade?.nome).toBe(ORG.nome);
    expect(dados.onboarding?.adminEmail).toBe("ana@sociedade.pt");
    expect(dados.utilizadores.map((u) => u.email)).toContain("ana@sociedade.pt");
    expect(dados.convites).toHaveLength(1);
    expect(dados.perfis).toHaveLength(1);
    expect(dados.aceitacoesTermos).toHaveLength(1);
    expect(dados.documentos[0].nome).toBe("certidao.pdf");
    expect(dados.registosEmail[0].para).toBe("ana@sociedade.pt");
    expect(dados.auditoria[0].acao).toBe("sociedade.submetida");
    expect(dados.plataforma).toBe("LexFlow");

    // Ler dados nunca escreve — nem na base nem na auditoria.
    expect(atualizacoes).toHaveLength(0);
    expect(eventos).toHaveLength(0);
  });

  it("recusa uma sociedade que não existe", async () => {
    linhas["t_organizacao"] = [];
    await expect(exportarDadosDaSociedade(ORG.id)).rejects.toThrow("Sociedade não encontrada");
  });

  it("marca os documentos em S3 como tal, sem conteúdo", async () => {
    linhas["t_documento_organizacao"] = [
      {
        id: "d-2",
        organizacaoId: ORG.id,
        nomeOriginal: "cc.pdf",
        tipo: "identificacao",
        mime: "application/pdf",
        tamanhoBytes: 500,
        conviteId: "c-1",
        criadoEm: new Date(),
        dados: null,
      },
    ];

    const dados = await exportarDadosDaSociedade(ORG.id);

    expect(dados.documentos[0].localizacao).toBe("s3");
    expect(dados.documentos[0].conteudoBase64).toBeNull();
  });
});

describe("eliminarDadosDaSociedade (artigo 17.º)", () => {
  it("por omissão é uma simulação: mede e não escreve nada", async () => {
    const r = await eliminarDadosDaSociedade(ORG.id);

    expect(r.modo).toBe("simulacao");
    if (r.modo !== "simulacao") return;

    const organizacao = r.apagaria.find((l) => l.tabela === "organizacao");
    expect(organizacao?.registos).toBe(1);
    const utilizadores = r.apagaria.find((l) => l.tabela === "utilizador");
    expect(utilizadores?.registos).toBe(1);
    // A auditoria fica sempre — imutável por construção.
    expect(r.mantem.some((l) => l.tabela === "evento_auditoria")).toBe(true);

    expect(atualizacoes).toHaveLength(0);
    expect(eventos).toHaveLength(0);
  });

  it("recusa executar sem motivo", async () => {
    await expect(eliminarDadosDaSociedade(ORG.id, { confirmar: true })).rejects.toThrow(
      /motivo/,
    );
    expect(atualizacoes).toHaveLength(0);
  });

  it("com confirmação e motivo, apaga por soft delete e audita primeiro", async () => {
    const r = await eliminarDadosDaSociedade(ORG.id, {
      confirmar: true,
      motivo: "Pedido da sociedade (art. 17.º RGPD).",
    });

    expect(r.modo).toBe("executado");

    // O rasto na auditoria vem antes de qualquer escrita.
    expect(eventos[0].acao).toBe("sociedade.dados.eliminados");
    expect(eventos[0].valorNovo).toEqual({ motivo: "Pedido da sociedade (art. 17.º RGPD)." });

    // Todas as escritas são soft delete (`apagado_em`) ou bloqueio de conta —
    // nenhuma é `DELETE`.
    const tabelas = atualizacoes.map((a) => a.tabela);
    expect(tabelas).toContain("t_organizacao");
    expect(tabelas).toContain("t_onboarding_sociedade");
    expect(tabelas).toContain("t_utilizador");
    expect(tabelas).toContain("t_convite_utilizador");
    expect(tabelas).toContain("t_perfil_utilizador");
    expect(tabelas).toContain("t_documento_organizacao");
    expect(tabelas).not.toContain("t_evento_auditoria");
    expect(tabelas).not.toContain("t_aceitacao_termos");

    const utilizadores = atualizacoes.find((a) => a.tabela === "t_utilizador");
    expect(utilizadores?.set).toEqual(
      expect.objectContaining({ apagadoEm: expect.any(Date), ativo: false }),
    );
  });

  it("se a auditoria recusar o evento, nada é apagado", async () => {
    auditoriaAceita = false;

    await expect(
      eliminarDadosDaSociedade(ORG.id, { confirmar: true, motivo: "Teste de falha." }),
    ).rejects.toThrow();

    expect(atualizacoes).toHaveLength(0);
  });
});
