import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A resolução dos T&C em vigor — o ponto 2 da revisão do cliente.
 *
 * O que interessa fixar aqui não é o caminho feliz: é o **recuo**. A regra
 * «serve o articulado da sociedade quando ele existe» tem três formas de o
 * documento não existir, e uma verificação só a `termos_documento_ref != null`
 * deixava passar duas delas — dando um passo 7 a apontar para um ficheiro que
 * não abre, com a caixa de aceitação trancada para sempre.
 */

type Linha = Record<string, unknown>;

let organizacoes: Linha[] = [];
let documentos: Linha[] = [];

vi.mock("server-only", () => ({}));

/**
 * O duplo da base de dados distingue as duas consultas pela **identidade** do
 * objeto da tabela, e não pelo nome.
 *
 * Pelo nome parecia mais legível e não funciona: o que o Drizzle guarda em `_`
 * é interno e muda de forma entre versões. Comparar com o `documentoOrganizacao`
 * importado é uma comparação de referências que não pode mentir — e, se a
 * função passar a ler uma terceira tabela, o `else` devolve a organização e o
 * teste falha em vez de passar por acidente.
 */
vi.mock("@/db", async () => {
  const { documentoOrganizacao } = await import("@/db/schema/sociedade");
  return {
    db: () => ({
      select: () => ({
        from: (tabela: unknown) => {
          const linhas = tabela === documentoOrganizacao ? () => documentos : () => organizacoes;
          return { where: () => ({ limit: linhas }) };
        },
      }),
    }),
  };
});

const { termosEmVigor, versaoTermosEmVigor } = await import("./termos-sociedade");
const { VERSAO_TERMOS } = await import("./termos");

const ORG = "org-1";

beforeEach(() => {
  organizacoes = [];
  documentos = [];
});

describe("termosEmVigor", () => {
  it("sem articulado da sociedade, serve o texto da plataforma", async () => {
    organizacoes = [{ ref: null, versao: null, atualizadoEm: null }];

    const r = await termosEmVigor(ORG);
    expect(r.forma).toBe("plataforma");
    expect(r.versao).toBe(VERSAO_TERMOS);
  });

  it("com articulado e versão, serve o documento da sociedade", async () => {
    organizacoes = [{ ref: "doc-1", versao: "2026.08.1", atualizadoEm: new Date() }];
    documentos = [{ id: "doc-1", nome: "termos.pdf" }];

    const r = await termosEmVigor(ORG);
    expect(r.forma).toBe("documento");
    expect(r.versao).toBe("2026.08.1");
    if (r.forma !== "documento") return;
    expect(r.documentoId).toBe("doc-1");
    expect(r.nome).toBe("termos.pdf");
  });

  it("com referência e sem versão, recua para a plataforma", async () => {
    // Sem versão não há o que gravar junto do consentimento (D3), e servir o
    // documento assim seria aceitar um articulado sem saber qual.
    organizacoes = [{ ref: "doc-1", versao: null, atualizadoEm: null }];
    documentos = [{ id: "doc-1", nome: "termos.pdf" }];

    expect((await termosEmVigor(ORG)).forma).toBe("plataforma");
  });

  it("com referência a um documento apagado, recua para a plataforma", async () => {
    // É o caso que uma verificação só a `ref != null` deixava passar: a coluna
    // não é nula, o ficheiro já não existe, e o passo 7 apontava para um
    // documento que não abre.
    organizacoes = [{ ref: "doc-1", versao: "2026.08.1", atualizadoEm: new Date() }];
    documentos = [];

    expect((await termosEmVigor(ORG)).forma).toBe("plataforma");
  });

  it("sem organização nenhuma, recua para a plataforma", async () => {
    organizacoes = [];
    expect((await termosEmVigor(ORG)).forma).toBe("plataforma");
  });
});

describe("versaoTermosEmVigor", () => {
  it("devolve a versão da sociedade quando existe", async () => {
    organizacoes = [{ versao: "2026.08.1" }];
    expect(await versaoTermosEmVigor(ORG)).toBe("2026.08.1");
  });

  it("recua para a versão da plataforma", async () => {
    organizacoes = [{ versao: null }];
    expect(await versaoTermosEmVigor(ORG)).toBe(VERSAO_TERMOS);
  });
});
