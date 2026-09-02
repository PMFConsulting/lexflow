import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { organizacao } from "@/db/schema/organizacao";
import { armazenamentoSociedade } from "@/db/schema/armazenamento";

/**
 * A criação automática do bucket S3 ao nascer uma sociedade (regra do dono:
 * "that process cannot be a manual process ... make it be automatic"). O
 * driver S3 em si já tem os seus testes, mocked a `fetch`
 * (`criar-bucket.test.ts`); o que interessa aqui é só o que `criarSociedade`
 * faz com o resultado — nunca deixar a falha do bucket derrubar a sociedade.
 */

type Linha = Record<string, unknown>;

const inseridos: { tabela: unknown; valores: Linha }[] = [];
const eventosAuditoria: { acao: string; entidade: string; valorNovo?: unknown }[] = [];
const criarBucketSociedadeMock = vi.fn();

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "127.0.0.1", "user-agent": "teste" }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/sessao", () => ({
  exigirSuperAdmin: async () => ({
    eu: { id: "u-dono", papel: "super_admin", organizacaoId: null },
  }),
  exigirGestorDeUtilizadores: async () => ({
    eu: { id: "u-dono", papel: "super_admin", organizacaoId: null },
  }),
}));

vi.mock("@/lib/emails/notificacoes-dono", () => ({
  notificarDonoSociedadeCriada: vi.fn(async () => {}),
  notificarDonoNovoUtilizador: vi.fn(async () => {}),
}));

vi.mock("@/features/auditoria/registar", () => ({
  registarEvento: async (entrada: { acao: string; entidade: string; valorNovo?: unknown }) => {
    eventosAuditoria.push(entrada);
    return { id: "audit-1" };
  },
}));

vi.mock("@/lib/storage/criar-bucket", () => ({
  criarBucketSociedade: (...args: unknown[]) => criarBucketSociedadeMock(...args),
}));

vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        // Sem colisões: nenhuma sociedade existente partilha NIF ou prefixo.
        where: async () => [],
      }),
    }),
    insert: (tabela: unknown) => ({
      values: async (v: Linha) => {
        inseridos.push({ tabela, valores: v });
        return [v];
      },
    }),
  }),
}));

const { criarSociedade } = await import("./acoes");

const DADOS_SOCIEDADE = {
  nome: "JMASSANO Escritório de Advogado",
  nif: "509876129",
  prefixoReferencia: "JM",
};

const CHAVE_VALIDA = "a".repeat(64);

beforeEach(() => {
  inseridos.length = 0;
  eventosAuditoria.length = 0;
  criarBucketSociedadeMock.mockReset();
  process.env.AWS_REGION = "eu-central-1";
  process.env.LEXFLOW_S3_ACCESS_KEY_ID = "AKIAEXEMPLO";
  process.env.LEXFLOW_S3_SECRET_ACCESS_KEY = "segredo-de-teste";
  process.env.ARMAZENAMENTO_CHAVE = CHAVE_VALIDA;
});

afterEach(() => {
  delete process.env.AWS_REGION;
  delete process.env.LEXFLOW_S3_ACCESS_KEY_ID;
  delete process.env.LEXFLOW_S3_SECRET_ACCESS_KEY;
  delete process.env.ARMAZENAMENTO_CHAVE;
});

describe("criarSociedade — bucket S3 automático", () => {
  it("cria o bucket e grava a linha em armazenamento_sociedade, sem aviso", async () => {
    criarBucketSociedadeMock.mockResolvedValue("lexflow-jmassano");

    const r = await criarSociedade(DADOS_SOCIEDADE);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.avisoBucket).toBeNull();

    expect(criarBucketSociedadeMock).toHaveBeenCalledWith(
      DADOS_SOCIEDADE.nome,
      r.id,
      expect.objectContaining({
        regiao: "eu-central-1",
        accessKeyId: "AKIAEXEMPLO",
        secretAccessKey: "segredo-de-teste",
      }),
    );

    const linhaArmazenamento = inseridos.find((i) => i.tabela === armazenamentoSociedade);
    expect(linhaArmazenamento).toBeDefined();
    expect(linhaArmazenamento?.valores.bucketS3).toBe("lexflow-jmassano");
    // Nasce ativo (regra do dono): um bucket criado e desativo obrigava a um
    // comando manual antes do primeiro upload — e, com a D66, o upload do
    // cliente é recusado enquanto não houver S3 ativo.
    expect(linhaArmazenamento?.valores.ativo).toBe(true);
    expect(linhaArmazenamento?.valores.organizacaoId).toBe(r.id);
    // A cifra é real (D34/D65): o que fica gravado nunca é a credencial em claro.
    expect(JSON.stringify(linhaArmazenamento?.valores.parametros)).not.toContain("segredo-de-teste");

    expect(eventosAuditoria.some((e) => e.acao === "armazenamento.bucket_criado")).toBe(true);
  });

  it("a sociedade nasce na mesma quando a criação do bucket falha, com aviso e sem linha gravada", async () => {
    criarBucketSociedadeMock.mockRejectedValue(new Error("S3 respondeu 403"));
    const espiaConsole = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await criarSociedade(DADOS_SOCIEDADE);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.avisoBucket).toBe("S3 respondeu 403");

    // A sociedade está lá.
    expect(inseridos.some((i) => i.tabela === organizacao)).toBe(true);
    // O bucket não.
    expect(inseridos.some((i) => i.tabela === armazenamentoSociedade)).toBe(false);

    expect(eventosAuditoria.some((e) => e.acao === "armazenamento.bucket_falhou")).toBe(true);
    expect(espiaConsole).toHaveBeenCalled();

    espiaConsole.mockRestore();
  });

  it("nunca chama a AWS sem as credenciais no ambiente — falha rápido, com aviso", async () => {
    delete process.env.LEXFLOW_S3_SECRET_ACCESS_KEY;
    const espiaConsole = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await criarSociedade(DADOS_SOCIEDADE);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.avisoBucket).toContain("LEXFLOW_S3_SECRET_ACCESS_KEY");
    expect(criarBucketSociedadeMock).not.toHaveBeenCalled();
    expect(inseridos.some((i) => i.tabela === armazenamentoSociedade)).toBe(false);

    espiaConsole.mockRestore();
  });

  it("sem ARMAZENAMENTO_CHAVE, não cifra nem grava — mas a sociedade fica criada", async () => {
    delete process.env.ARMAZENAMENTO_CHAVE;
    const espiaConsole = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await criarSociedade(DADOS_SOCIEDADE);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.avisoBucket).toContain("ARMAZENAMENTO_CHAVE");
    expect(criarBucketSociedadeMock).not.toHaveBeenCalled();
    expect(inseridos.some((i) => i.tabela === armazenamentoSociedade)).toBe(false);

    espiaConsole.mockRestore();
  });
});
