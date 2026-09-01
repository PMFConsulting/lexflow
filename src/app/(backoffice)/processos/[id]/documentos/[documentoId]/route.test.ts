import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A rota de download tem de continuar a servir um documento antigo (`dados`
 * preenchido) sem tocar em rede nenhuma, e passar a servir um documento novo
 * (`dados` a NULL, D66) lendo-o do bucket S3 da sociedade através de
 * `chaveStorage`. É essa bifurcação, e as suas falhas, que este ficheiro
 * testa — o resto da rota (UUID, autorização, auditoria) já existia.
 */

const ID_PROCESSO = "018f1e2a-0000-7000-8000-000000000001";
const ID_DOCUMENTO = "018f1e2a-0000-7000-8000-000000000002";

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c,
  eq: (coluna: unknown, valor: unknown) => [coluna, valor, "eq"],
  isNull: (c: unknown) => [c, null, "isNull"],
}));

vi.mock("@/db/schema/documentos", () => ({
  documento: {
    id: "col_doc_id",
    processoId: "col_proc_id",
    apagadoEm: "col_apagado",
    nomeOriginal: "col_nome",
    mime: "col_mime",
    tipo: "col_tipo",
    dados: "col_dados",
    chaveStorage: "col_chave",
  },
}));

vi.mock("@/db/schema/processo", () => ({
  processoOnboarding: {
    id: "col_processo_id",
    organizacaoId: "col_org_id",
    apagadoEm: "col_apagado_processo",
  },
}));

const registarEventoMock = vi.fn(async (..._args: unknown[]) => ({}));
vi.mock("@/features/auditoria/registar", () => ({
  registarEvento: (...args: unknown[]) => registarEventoMock(...args),
}));

let papelAtual = "society_admin";
let organizacaoDoUtilizador = "org-1";

vi.mock("@/lib/sessao", () => ({
  exigirEquipaOuSuperAdmin: async () => ({
    eu: { id: "user-1", papel: papelAtual, organizacaoId: organizacaoDoUtilizador },
  }),
  podeAcederSociedade: (
    eu: { papel: string; organizacaoId: string | null },
    organizacaoIdAlvo: string,
  ) => eu.papel === "super_admin" || eu.organizacaoId === organizacaoIdAlvo,
}));

let ligacaoMock: { destino: { ler?: (chave: string) => Promise<Buffer> } } | null = null;

vi.mock("@/lib/storage", () => ({
  destinoDaOrganizacao: async () => ligacaoMock,
}));

let processoRows: Record<string, unknown>[] = [];
let docRows: Record<string, unknown>[] = [];
let numeroDeSelects = 0;

vi.mock("@/db", () => ({
  db: () => ({
    select: () => {
      numeroDeSelects += 1;
      const linhas = numeroDeSelects === 1 ? processoRows : docRows;
      return {
        from: () => ({
          where: () => ({
            limit: async () => linhas,
          }),
        }),
      };
    },
  }),
}));

import { GET } from "./route";

function pedir() {
  return new Request("https://poc.terlicalabs.com/processos/x/documentos/y", {
    headers: { "user-agent": "vitest" },
  });
}

function params() {
  return Promise.resolve({ id: ID_PROCESSO, documentoId: ID_DOCUMENTO });
}

beforeEach(() => {
  papelAtual = "society_admin";
  organizacaoDoUtilizador = "org-1";
  processoRows = [{ organizacaoId: "org-1" }];
  docRows = [];
  numeroDeSelects = 0;
  ligacaoMock = null;
  registarEventoMock.mockClear();
});

describe("GET /documentos/[documentoId] — documento antigo (dados preenchido)", () => {
  it("serve o ficheiro de `dados`, sem chamar o armazenamento", async () => {
    docRows = [
      {
        nome: "cartao_cidadao.pdf",
        mime: "application/pdf",
        tipo: "identificacao",
        dados: Buffer.from("conteudo-antigo").toString("base64"),
        chaveStorage: "processos/proc-1/hash-antigo",
      },
    ];

    const r = await GET(pedir(), { params: params() });

    expect(r.status).toBe(200);
    expect(await r.text()).toBe("conteudo-antigo");
    expect(registarEventoMock).toHaveBeenCalledTimes(1);
  });
});

describe("GET /documentos/[documentoId] — documento novo (dados a NULL, D66)", () => {
  it("lê do S3 através de destino.ler(chaveStorage) e serve os bytes", async () => {
    docRows = [
      {
        nome: "identificacao.pdf",
        mime: "application/pdf",
        tipo: "identificacao",
        dados: null,
        chaveStorage: "Sistema/processos/proc-1/hash-identificacao.pdf",
      },
    ];
    const lerMock = vi.fn(async (chave: string) => Buffer.from(`bytes-de-${chave}`));
    ligacaoMock = { destino: { ler: lerMock } };

    const r = await GET(pedir(), { params: params() });

    expect(lerMock).toHaveBeenCalledWith("Sistema/processos/proc-1/hash-identificacao.pdf");
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("bytes-de-Sistema/processos/proc-1/hash-identificacao.pdf");
  });

  it("devolve 404 quando não há destino nenhum acessível", async () => {
    docRows = [
      {
        nome: "identificacao.pdf",
        mime: "application/pdf",
        tipo: "identificacao",
        dados: null,
        chaveStorage: "Sistema/processos/proc-1/hash-identificacao.pdf",
      },
    ];
    ligacaoMock = null;

    const r = await GET(pedir(), { params: params() });

    expect(r.status).toBe(404);
    expect(registarEventoMock).not.toHaveBeenCalled();
  });

  it("devolve 502 quando a leitura do S3 falha", async () => {
    docRows = [
      {
        nome: "identificacao.pdf",
        mime: "application/pdf",
        tipo: "identificacao",
        dados: null,
        chaveStorage: "Sistema/processos/proc-1/hash-identificacao.pdf",
      },
    ];
    ligacaoMock = {
      destino: {
        ler: vi.fn(async () => {
          throw new Error("S3 respondeu 403");
        }),
      },
    };

    const r = await GET(pedir(), { params: params() });

    expect(r.status).toBe(502);
    expect(registarEventoMock).not.toHaveBeenCalled();
  });
});

describe("GET /documentos/[documentoId] — guardas já existentes", () => {
  it("404 num id que não é UUID, antes de qualquer consulta", async () => {
    const r = await GET(pedir(), { params: Promise.resolve({ id: "abc", documentoId: "def" }) });
    expect(r.status).toBe(404);
    expect(numeroDeSelects).toBe(0);
  });

  it("404 quando o processo é de outra sociedade", async () => {
    organizacaoDoUtilizador = "org-2";
    processoRows = [{ organizacaoId: "org-1" }];

    const r = await GET(pedir(), { params: params() });
    expect(r.status).toBe(404);
  });
});
