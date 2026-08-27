import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  escaparCsv,
  formatarDataIso,
  gerarCsvClientes,
} from "./csv";
import { exportarClientesCsv } from "./acoes";

type Linha = Record<string, unknown>;

const auditados: { acao: string; valorNovo?: Linha; organizacaoId: string; atorId: string }[] = [];
let papelAtual = "society_admin";
let clientesRetornados: Array<{
  nif: string;
  nome: string | null;
  tipoCliente: "particular" | "empresa";
  email: string | null;
  telefone: string | null;
  nacionalidades: string | null;
  totalProcessos: number;
  ultimoProcessoId: string;
  ultimaReferencia: string;
  ultimoEstado: "rascunho" | "pendente_cliente" | "submetido" | "em_revisao" | "aguardar_aprovacao" | "aprovado" | "rejeitado";
  ultimoCriadoEm: Date | string | null;
}> = [];

vi.mock("@/features/auditoria/registar", () => ({
  registarEvento: async (e: {
    acao: string;
    valorNovo?: Linha;
    organizacaoId: string;
    atorId: string;
  }) => {
    auditados.push(e);
  },
}));

vi.mock("@/lib/sessao", () => ({
  exigirSocietyAdmin: async () => {
    if (papelAtual !== "society_admin") {
      throw new Error("Acesso não autorizado");
    }
    return {
      eu: {
        id: "user-admin-1",
        papel: papelAtual,
        organizacaoId: "org-1",
        nome: "Admin Sociedade",
        email: "admin@sociedade.pt",
      },
    };
  },
}));

vi.mock("./consultas", () => ({
  listarClientes: async (_orgId: string, _q?: string) => clientesRetornados,
}));

beforeEach(() => {
  auditados.length = 0;
  papelAtual = "society_admin";
  clientesRetornados = [
    {
      nif: "123456789",
      nome: "António Manuel",
      tipoCliente: "particular",
      email: "antonio@exemplo.pt",
      telefone: "912345678",
      nacionalidades: "Portugal",
      totalProcessos: 1,
      ultimoProcessoId: "proc-1",
      ultimaReferencia: "PMF-2026-0001",
      ultimoEstado: "aprovado",
      ultimoCriadoEm: new Date("2026-05-10T14:30:00.000Z"),
    },
    {
      nif: "501234567",
      nome: "Empresa XPTO, Lda.",
      tipoCliente: "empresa",
      email: "contato@xpto.pt",
      telefone: "213456789",
      nacionalidades: "Portugal",
      totalProcessos: 2,
      ultimoProcessoId: "proc-2",
      ultimaReferencia: "PMF-2026-0002",
      ultimoEstado: "aguardar_aprovacao",
      ultimoCriadoEm: "2026-06-15T09:00:00.000Z",
    },
  ];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("exportação de clientes em CSV", () => {
  describe("escaparCsv", () => {
    it("mantém texto simples inalterado", () => {
      expect(escaparCsv("Texto normal")).toBe("Texto normal");
      expect(escaparCsv(12345)).toBe("12345");
    });

    it("trata valores nulos ou indefinidos", () => {
      expect(escaparCsv(null)).toBe("");
      expect(escaparCsv(undefined)).toBe("");
    });

    it("envolve em aspas se contiver ponto e vírgula", () => {
      expect(escaparCsv("Silva; Santos")).toBe('"Silva; Santos"');
    });

    it("duplica aspas duplas internas se contiver aspas", () => {
      expect(escaparCsv('Empresa "Boa"')).toBe('"Empresa ""Boa"""');
    });

    it("envolve em aspas se contiver quebras de linha", () => {
      expect(escaparCsv("Linha 1\nLinha 2")).toBe('"Linha 1\nLinha 2"');
    });
  });

  describe("formatarDataIso", () => {
    it("formata objetos Date corretamente", () => {
      expect(formatarDataIso(new Date("2026-08-27T10:00:00Z"))).toBe("2026-08-27");
    });

    it("formata strings de data válidas", () => {
      expect(formatarDataIso("2026-01-15T12:00:00Z")).toBe("2026-01-15");
    });

    it("retorna string vazia para valores inválidos ou nulos", () => {
      expect(formatarDataIso(null)).toBe("");
      expect(formatarDataIso("invalido")).toBe("");
    });
  });

  describe("gerarCsvClientes", () => {
    it("inclui BOM UTF-8 no início do ficheiro", () => {
      const csv = gerarCsvClientes([]);
      expect(csv.startsWith("\uFEFF")).toBe(true);
    });

    it("gera cabeçalho correto separado por ponto e vírgula", () => {
      const csv = gerarCsvClientes([]);
      const linhas = csv.replace("\uFEFF", "").split("\r\n");
      expect(linhas[0]).toBe("Referência;Nome;Tipo;NIF;Email;Estado;Data");
    });

    it("formata linhas de clientes com os campos requeridos", () => {
      const csv = gerarCsvClientes(clientesRetornados);
      const linhas = csv.replace("\uFEFF", "").split("\r\n");

      expect(linhas.length).toBe(3); // cabeçalho + 2 clientes
      expect(linhas[1]).toBe("PMF-2026-0001;António Manuel;Particular;123456789;antonio@exemplo.pt;aprovado;2026-05-10");
      expect(linhas[2]).toBe("PMF-2026-0002;Empresa XPTO, Lda.;Empresa;501234567;contato@xpto.pt;aguardar_aprovacao;2026-06-15");
    });
  });

  describe("exportarClientesCsv (Server Action)", () => {
    it("permite exportação pelo society_admin e audita o evento", async () => {
      const res = await exportarClientesCsv("XPTO");

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.total).toBe(2);
        expect(res.csv.startsWith("\uFEFF")).toBe(true);
        expect(res.nomeFicheiro).toMatch(/^clientes-\d{4}-\d{2}-\d{2}\.csv$/);
      }

      expect(auditados).toContainEqual(
        expect.objectContaining({
          acao: "clientes.exportados",
          organizacaoId: "org-1",
          atorId: "user-admin-1",
          valorNovo: {
            total: 2,
            filtro: "XPTO",
          },
        }),
      );
    });

    it("recusa utilizadores sem papel de society_admin", async () => {
      papelAtual = "utilizador";
      await expect(exportarClientesCsv()).rejects.toThrow("Acesso não autorizado");
    });
  });
});
