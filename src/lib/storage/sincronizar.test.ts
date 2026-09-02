import { beforeEach, describe, expect, it, vi } from "vitest";
import { sincronizarCliente } from "./sincronizar";

/**
 * `sincronizarCliente` monta a pasta legível do cliente a partir de duas
 * fontes de anexo: `documento.dados` (o documento antigo, ou de uma
 * sociedade ainda em SFTP) e, quando isso está a NULL, o bucket S3 da própria
 * sociedade (D66) — lido através de `chaveStorage`. É essa bifurcação que
 * este ficheiro testa; o resto (o desenho dos PDFs) já está coberto por
 * `capa.test.ts` e `resumo.test.ts`.
 */

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c,
  eq: (coluna: unknown, valor: unknown) => [coluna, valor, "eq"],
  isNull: (c: unknown) => [c, null, "isNull"],
}));

vi.mock("@/db/schema/armazenamento", () => ({
  armazenamentoSociedade: { id: "col_arm_id" },
}));

vi.mock("@/db/schema/documentos", () => ({
  documento: {
    processoId: "col_proc_id",
    apagadoEm: "col_apagado",
    nomeOriginal: "col_nome",
    mime: "col_mime",
    dados: "col_dados",
    chaveStorage: "col_chave",
  },
}));

vi.mock("@/features/auditoria/registar", () => ({
  registarEvento: vi.fn(async () => ({})),
}));

vi.mock("@/features/onboarding/dados", () => ({
  seccoesDoProcesso: async () => ({
    identificacao: { nome: "Maria Silva", email: null, telefone: null },
    fiscais: { nif: "249886344" },
    nacionalidades: [],
    negocio: { servicos: null },
    faturacao: null,
    preferencias: null,
    areasInteresse: [],
    documentos: [],
  }),
}));

vi.mock("./capa", () => ({
  gerarCapaPdf: async () => Buffer.from("capa"),
}));

vi.mock("./resumo", () => ({
  gerarResumoPdf: async () => Buffer.from("resumo"),
}));

let anexosMock: Record<string, unknown>[] = [];
let atualizacoesArmazenamento: Record<string, unknown>[] = [];

vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: async () => anexosMock,
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        atualizacoesArmazenamento.push(v);
        return { where: async () => {} };
      },
    }),
  }),
}));

const garantirPastaMock = vi.fn(async (_segmentos: string[]) => {});
const enviarMock = vi.fn(
  async (_segmentos: string[], _ficheiro: { nome: string; mime: string; conteudo: Buffer }) => {},
);
const lerMock = vi.fn(async (_chave: string) => Buffer.from("bytes-do-s3"));

let ligacaoMock: {
  destino: { garantirPasta: typeof garantirPastaMock; enviar: typeof enviarMock; ler?: typeof lerMock };
  config: Record<string, unknown>;
} | null = {
  destino: { garantirPasta: garantirPastaMock, enviar: enviarMock, ler: lerMock },
  config: { id: "arm-1", pastaRaiz: "/Clientes", bucketS3: "lexflow-jmassano" },
};

vi.mock("./index", () => ({
  destinoDaOrganizacao: async () => ligacaoMock,
}));

const PROCESSO = {
  id: "proc-1",
  organizacaoId: "org-1",
  referencia: "JM-2026-0001",
  tipoCliente: "particular",
  submetidoEm: new Date("2026-09-01T10:00:00Z"),
} as unknown as Parameters<typeof sincronizarCliente>[0];

beforeEach(() => {
  anexosMock = [];
  atualizacoesArmazenamento = [];
  garantirPastaMock.mockClear();
  enviarMock.mockClear();
  lerMock.mockClear();
  ligacaoMock = {
    destino: { garantirPasta: garantirPastaMock, enviar: enviarMock, ler: lerMock },
    config: { id: "arm-1", pastaRaiz: "/Clientes", bucketS3: "lexflow-jmassano" },
  };
});

describe("sincronizarCliente — sem armazenamento configurado", () => {
  it("não faz nada e não é um erro", async () => {
    ligacaoMock = null;
    const r = await sincronizarCliente(PROCESSO);
    expect(r).toEqual({ ok: true, ignorado: true, motivo: "Armazenamento por configurar." });
    expect(enviarMock).not.toHaveBeenCalled();
  });
});

describe("sincronizarCliente — anexo com dados (documento antigo, ou SFTP)", () => {
  it("lê o conteúdo de `dados`, sem tocar no leitor do S3", async () => {
    anexosMock = [
      {
        nome: "cartao_cidadao.pdf",
        mime: "application/pdf",
        dados: Buffer.from("conteudo-antigo").toString("base64"),
        chaveStorage: "processos/proc-1/hash-antigo",
      },
    ];

    const r = await sincronizarCliente(PROCESSO);

    expect(r.ok).toBe(true);
    expect(lerMock).not.toHaveBeenCalled();
    expect(enviarMock).toHaveBeenCalled();
    // capa + resumo + o anexo = 3 ficheiros enviados
    const nomes = enviarMock.mock.calls.map((c) => (c[1] as { nome: string }).nome);
    expect(nomes).toContain("cartao_cidadao.pdf");
  });
});

describe("sincronizarCliente — anexo sem dados (D66: só existe no S3)", () => {
  it("lê o conteúdo pela chave, através do destino.ler", async () => {
    anexosMock = [
      {
        nome: "identificacao.pdf",
        mime: "application/pdf",
        dados: null,
        chaveStorage: "Sistema/processos/proc-1/hash-identificacao.pdf",
      },
    ];

    const r = await sincronizarCliente(PROCESSO);

    expect(r.ok).toBe(true);
    expect(lerMock).toHaveBeenCalledWith("Sistema/processos/proc-1/hash-identificacao.pdf");
    const nomes = enviarMock.mock.calls.map((c) => (c[1] as { nome: string }).nome);
    expect(nomes).toContain("identificacao.pdf");
  });

  it("salta o anexo (sem abortar a sincronização) quando a leitura do S3 falha", async () => {
    lerMock.mockRejectedValueOnce(new Error("S3 respondeu 404"));
    anexosMock = [
      {
        nome: "falhado.pdf",
        mime: "application/pdf",
        dados: null,
        chaveStorage: "Sistema/processos/proc-1/hash-falhado.pdf",
      },
    ];

    const r = await sincronizarCliente(PROCESSO);

    expect(r.ok).toBe(true);
    const nomes = enviarMock.mock.calls.map((c) => (c[1] as { nome: string }).nome);
    expect(nomes).not.toContain("falhado.pdf");
    // capa + resumo continuam a ser enviados
    expect(nomes.length).toBeGreaterThanOrEqual(2);
  });

  it("salta o anexo quando não há dados e o destino não sabe ler (SFTP)", async () => {
    ligacaoMock = {
      destino: { garantirPasta: garantirPastaMock, enviar: enviarMock },
      config: { id: "arm-1", pastaRaiz: "/Clientes", bucketS3: null },
    };
    anexosMock = [
      {
        nome: "sem-leitor.pdf",
        mime: "application/pdf",
        dados: null,
        chaveStorage: "processos/proc-1/hash-sem-leitor",
      },
    ];

    const r = await sincronizarCliente(PROCESSO);

    expect(r.ok).toBe(true);
    const nomes = enviarMock.mock.calls.map((c) => (c[1] as { nome: string }).nome);
    expect(nomes).not.toContain("sem-leitor.pdf");
  });
});
