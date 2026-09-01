import { beforeEach, describe, expect, it, vi } from "vitest";

let estadoAcesso: "ok" | "expirado" = "ok";
let estadoProcesso: string = "rascunho";
let documentos: Record<string, unknown>[] = [];
let condicoesSelect: unknown[] = [];

/**
 * O destino de armazenamento da organização, tal como `destinoDaOrganizacao`
 * o devolveria: `null` quando não há S3 ativo (recusa o upload — D66), ou um
 * destino com `enviar` espiado para confirmar que o ficheiro é mesmo enviado
 * antes de o `documento` ser gravado.
 */
let semDestinoS3 = false;
const enviarMock = vi.fn(
  async (_segmentos: string[], _ficheiro: { nome: string; mime: string; conteudo: Buffer }) => {},
);

vi.mock("@/lib/storage", () => ({
  destinoDaOrganizacao: async () => {
    if (semDestinoS3) return null;
    return {
      destino: { enviar: enviarMock },
      config: { bucketS3: "lexflow-jmassano" },
    };
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "127.0.0.1", "user-agent": "vitest" }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c,
  eq: (coluna: unknown, valor: unknown) => [coluna, valor, "eq"],
  isNull: (c: unknown) => [c, null, "isNull"],
}));

vi.mock("@/db/schema/documentos", () => ({
  documento: {
    id: "col_id",
    processoId: "col_proc_id",
    hashSha256: "col_hash",
    tipo: "col_tipo",
    apagadoEm: "col_apagado",
  },
}));

vi.mock("@/features/auditoria/registar", () => ({
  registarEvento: async () => ({ ok: true }),
}));

vi.mock("./dados", () => ({
  acessoPorToken: async () => {
    if (estadoAcesso !== "ok") return { estado: "expirado" };
    return {
      estado: "ok",
      processo: {
        id: "proc-1",
        organizacaoId: "org-1",
        referencia: "JM-2026-0001",
        estado: estadoProcesso,
      },
      token: "tok-1",
    };
  },
  motivoDoAcesso: () => ({ titulo: "Link expirado.", descricao: "Peça um novo." }),
}));

let ultimoInsert: Record<string, unknown> | null = null;

vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: (cond: unknown) => {
          condicoesSelect.push(cond);
          return {
            limit: async () => documentos,
          };
        },
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        ultimoInsert = v;
        return { returning: async () => [{ id: "doc-novo", nome: v.nomeOriginal }] };
      },
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          then: (resolve: (v: unknown) => unknown) => Promise.resolve().then(resolve),
        }),
      }),
    }),
  }),
}));

import { carregarDocumento, removerDocumento } from "./documentos";

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7

function criarFormData(nome: string, tipo: string) {
  const fd = new FormData();
  fd.set("ficheiro", new File([PDF_BYTES], nome, { type: "application/pdf" }));
  fd.set("tipo", tipo);
  return fd;
}

beforeEach(() => {
  estadoAcesso = "ok";
  estadoProcesso = "rascunho";
  documentos = [];
  condicoesSelect = [];
  semDestinoS3 = false;
  ultimoInsert = null;
  enviarMock.mockClear();
});

describe("removerDocumento — Guardas de Estado (BUG-004)", () => {
  it("recusa remoção de documento quando o processo está aprovado (imutabilidade definitiva)", async () => {
    estadoProcesso = "aprovado";
    documentos = [{ id: "doc-1", nomeOriginal: "cc.pdf", tipo: "identificacao" }];

    const r = await removerDocumento("tok-1", "doc-1");

    expect(r.ok).toBe(false);
    expect(r.erro).toBe("Este processo já foi submetido.");
  });

  it("recusa remoção de documento quando o processo já está submetido", async () => {
    estadoProcesso = "submetido";
    documentos = [{ id: "doc-1", nomeOriginal: "cc.pdf", tipo: "identificacao" }];

    const r = await removerDocumento("tok-1", "doc-1");

    expect(r.ok).toBe(false);
    expect(r.erro).toBe("Este processo já foi submetido.");
  });

  it("permite remoção de documento quando o processo está em revisão (BUG-004)", async () => {
    estadoProcesso = "em_revisao";
    documentos = [{ id: "doc-1", nomeOriginal: "cc.pdf", tipo: "identificacao" }];

    const r = await removerDocumento("tok-1", "doc-1");

    expect(r.ok).toBe(true);
  });

  it("permite remoção de documento quando o processo está em rascunho", async () => {
    estadoProcesso = "rascunho";
    documentos = [{ id: "doc-1", nomeOriginal: "cc.pdf", tipo: "identificacao" }];

    const r = await removerDocumento("tok-1", "doc-1");

    expect(r.ok).toBe(true);
  });

  it("permite remoção de documento quando o processo está em pendente_cliente", async () => {
    estadoProcesso = "pendente_cliente";
    documentos = [{ id: "doc-1", nomeOriginal: "cc.pdf", tipo: "identificacao" }];

    const r = await removerDocumento("tok-1", "doc-1");

    expect(r.ok).toBe(true);
  });
});

describe("removerDocumento — Permissões de Tipo (BUG-007)", () => {
  it("recusa a remoção de documentos da sociedade como proposta_comercial", async () => {
    estadoProcesso = "rascunho";
    documentos = [{ id: "prop-1", nomeOriginal: "proposta.pdf", tipo: "proposta_comercial" }];

    const r = await removerDocumento("tok-1", "prop-1");

    expect(r.ok).toBe(false);
    expect(r.erro).toBe("Não tem permissão para remover este tipo de documento.");
  });

  it("permite a remoção de documentos do cliente como identificacao ou comprovativo_nif", async () => {
    estadoProcesso = "rascunho";
    documentos = [{ id: "doc-1", nomeOriginal: "nif.pdf", tipo: "comprovativo_nif" }];

    const r = await removerDocumento("tok-1", "doc-1");

    expect(r.ok).toBe(true);
  });
});

describe("carregarDocumento — Deduplicação por Tipo (BUG-005)", () => {
  it("permite carregar o mesmo ficheiro para tipos diferentes e inclui o tipo na verificação", async () => {
    estadoProcesso = "rascunho";
    documentos = []; // não existe com o mesmo tipo

    const fd = criarFormData("identificacao.pdf", "identificacao");
    const r = await carregarDocumento("tok-1", fd);

    expect(r.ok).toBe(true);

    // Verifica que a query de duplicados inclui eq(documento.tipo, tipo)
    const ultimaCond = condicoesSelect[condicoesSelect.length - 1];
    expect(JSON.stringify(ultimaCond)).toContain("col_tipo");
  });

  it("recusa quando o mesmo ficheiro já existe para o mesmo tipo", async () => {
    estadoProcesso = "rascunho";
    documentos = [{ id: "doc-existente", tipo: "identificacao" }];

    const fd = criarFormData("identificacao.pdf", "identificacao");
    const r = await carregarDocumento("tok-1", fd);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erro).toBe("Este ficheiro já foi carregado.");
    }
  });

  it("permite upload quando o processo está em em_revisao (BUG-004)", async () => {
    estadoProcesso = "em_revisao";
    documentos = [];

    const fd = criarFormData("nif.pdf", "comprovativo_nif");
    const r = await carregarDocumento("tok-1", fd);

    expect(r.ok).toBe(true);
  });
});

describe("carregarDocumento — nenhum documento na base de dados (D66)", () => {
  it("envia o ficheiro para o S3 da sociedade e grava dados=null", async () => {
    documentos = [];

    const fd = criarFormData("identificacao.pdf", "identificacao");
    const r = await carregarDocumento("tok-1", fd);

    expect(r.ok).toBe(true);
    expect(enviarMock).toHaveBeenCalledTimes(1);

    const [segmentos, ficheiro] = enviarMock.mock.calls[0] as [string[], { nome: string }];
    expect(segmentos).toEqual(["Sistema", "processos", "proc-1"]);
    expect(ficheiro.nome).toContain("identificacao.pdf");

    expect(ultimoInsert).not.toBeNull();
    expect(ultimoInsert?.dados).toBeNull();
    expect(String(ultimoInsert?.chaveStorage)).toBe(
      `Sistema/processos/proc-1/${ficheiro.nome}`,
    );
  });

  it("recusa o upload quando a sociedade não tem S3 ativo, sem tocar na base de dados", async () => {
    documentos = [];
    semDestinoS3 = true;

    const fd = criarFormData("identificacao.pdf", "identificacao");
    const r = await carregarDocumento("tok-1", fd);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erro).toContain("armazenamento");
    }
    expect(enviarMock).not.toHaveBeenCalled();
    expect(ultimoInsert).toBeNull();
  });

  it("recusa o upload quando o envio ao S3 falha, sem gravar o documento", async () => {
    documentos = [];
    enviarMock.mockRejectedValueOnce(new Error("S3 respondeu 403"));

    const fd = criarFormData("identificacao.pdf", "identificacao");
    const r = await carregarDocumento("tok-1", fd);

    expect(r.ok).toBe(false);
    expect(ultimoInsert).toBeNull();
  });
});

