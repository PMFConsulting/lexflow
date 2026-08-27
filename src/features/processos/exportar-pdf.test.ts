import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gerarDossierPdf } from "./pdf-dossier";
import { exportarProcessoPdf } from "./exportar-pdf";

type Linha = Record<string, unknown>;

const auditados: { acao: string; valorNovo?: Linha; organizacaoId: string; processoId?: string | null }[] = [];
let papelAtual = "society_admin";
let processoExiste = true;
let processoOrgId = "org-1";

vi.mock("@/features/auditoria/registar", () => ({
  registarEvento: async (e: {
    acao: string;
    valorNovo?: Linha;
    organizacaoId: string;
    processoId?: string | null;
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
      },
    };
  },
}));

vi.mock("./consultas", () => ({
  processoPorId: async (id: string) => {
    if (!processoExiste) return null;
    return {
      id,
      organizacaoId: processoOrgId,
      referencia: "PMF-2026-0042",
      tipoCliente: "particular",
      nomeCliente: "Maria Silva",
      nifCliente: "123456789",
      emailCliente: "maria@exemplo.pt",
      estado: "aguardar_aprovacao",
      responsavel: "Dr. Advogado",
      submetidoEm: new Date("2026-08-20T10:00:00Z"),
      atualizadoEm: new Date("2026-08-25T15:00:00Z"),
      criadoEm: new Date("2026-08-18T09:00:00Z"),
    };
  },
  documentosDoProcesso: async () => [
    { id: "doc-1", nome: "cartao_cidadao.pdf", tipo: "identificacao", bytes: 102400, hash: "sha1", criadoEm: new Date() },
    { id: "doc-2", nome: "comprovativo_morada.pdf", tipo: "outro", bytes: 204800, hash: "sha2", criadoEm: new Date() },
  ],
  propostaDoProcesso: async () => ({
    id: "prop-1",
    nome: "proposta_honorarios.pdf",
    bytes: 512000,
  }),
}));

vi.mock("@/features/onboarding/dados", () => ({
  seccoesDoProcesso: async () => ({
    identificacao: {
      nome: "Maria Silva",
      profissao: "Engenheira",
      entidadePatronal: "Tech Lda",
      dataNascimento: "1985-04-12",
      telefone: "912345678",
      email: "maria@exemplo.pt",
      morada: "Rua das Flores 123",
      codigoPostal: "1000-100",
      localidade: "Lisboa",
      freguesia: "Avenidas Novas",
      concelho: "Lisboa",
      distrito: "Lisboa",
      pais: "Portugal",
      naturezaJuridica: null,
      dataConstituicao: null,
    },
    nacionalidades: ["Portugal"],
    fiscais: {
      nif: "123456789",
      nifPortugues: true,
      resideEmPortugal: true,
      docTipo: "cartao_cidadao",
      docNumero: "123456789ZZ0",
      docValidade: "2030-01-01",
      cae: null,
      codigoCertidaoPermanente: null,
    },
    representante: null,
    nacionalidadesRepresentante: [],
    ppe: {
      ePpe: false,
      ppeCargo: null,
      ppePais: null,
      ppeEntidade: null,
      ppeInicio: null,
      ppeFim: null,
      eRelacionadoPpe: false,
      relacaoPpe: null,
      ppeRelacionadaNome: null,
      ppeRelacionadaCargo: null,
      ppeRelacionadaPais: null,
    },
    negocio: {
      servicos: "Assessoria Jurídica Imobiliária",
      origemFundos: "Rendimentos do Trabalho",
    },
    faturacao: {
      igualAoCliente: true,
      nome: "Maria Silva",
      nif: "123456789",
      email: "maria@exemplo.pt",
      acIgualAoCliente: true,
      acNome: null,
      acEmail: null,
      acTelefone: null,
      morada: "Rua das Flores 123",
      codigoPostal: "1000-100",
      localidade: "Lisboa",
      freguesia: "Avenidas Novas",
      concelho: "Lisboa",
      distrito: "Lisboa",
      pais: "Portugal",
    },
    preferencias: {
      origemContacto: "recomendacao",
      origemDetalhe: "Amigo",
      newsletter: true,
      convitesIniciativas: true,
      convitesNome: null,
      convitesEmail: null,
    },
    emailsNewsletter: ["maria@exemplo.pt"],
    areasInteresse: ["Direito Imobiliário"],
    fecho: {
      declaracaoVeracidade: true,
      tcAceitacao: true,
      propostaAceitacao: true,
      tcVersao: "v1.0",
    },
  }),
  assinaturaDoProcesso: async () => ({
    assinadoEm: new Date("2026-08-20T10:05:00Z"),
    imagemDados: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  }),
}));

beforeEach(() => {
  auditados.length = 0;
  papelAtual = "society_admin";
  processoExiste = true;
  processoOrgId = "org-1";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("geração de Dossier do Processo em PDF", () => {
  it("gera PDF válido começando por %PDF-", async () => {
    const pdfBuffer = await gerarDossierPdf({
      processo: {
        id: "proc-1",
        referencia: "PMF-2026-0042",
        tipoCliente: "particular",
        nomeCliente: "Maria Silva",
        nifCliente: "123456789",
        emailCliente: "maria@exemplo.pt",
        estado: "aguardar_aprovacao",
        responsavel: "Dr. Advogado",
        submetidoEm: new Date("2026-08-20T10:00:00Z"),
        atualizadoEm: new Date("2026-08-25T15:00:00Z"),
      },
      seccoes: {
        identificacao: null,
        nacionalidades: [],
        fiscais: null,
        representante: null,
        nacionalidadesRepresentante: [],
        ppe: null,
        negocio: null,
        faturacao: null,
        preferencias: null,
        emailsNewsletter: [],
        areasInteresse: [],
        fecho: null,
        documentos: [],
      },
      documentos: [
        { nome: "doc1.pdf", tipo: "identificacao", bytes: 1024 },
      ],
      assinatura: null,
      proposta: null,
    });

    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(500);
    expect(pdfBuffer.subarray(0, 5).toString("utf-8")).toBe("%PDF-");
  });

  it("exporta processo com todas as secções preenchidas", async () => {
    const res = await exportarProcessoPdf("proc-1");

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.nomeFicheiro).toBe("dossier-PMF-2026-0042.pdf");
      expect(res.pdfBase64).toBeTruthy();

      const decoded = Buffer.from(res.pdfBase64, "base64");
      expect(decoded.subarray(0, 5).toString("utf-8")).toBe("%PDF-");
    }

    expect(auditados).toContainEqual(
      expect.objectContaining({
        acao: "processo.exportado_pdf",
        organizacaoId: "org-1",
        processoId: "proc-1",
        valorNovo: { referencia: "PMF-2026-0042" },
      }),
    );
  });

  it("recusa utilizadores que não são society_admin", async () => {
    papelAtual = "utilizador";
    await expect(exportarProcessoPdf("proc-1")).rejects.toThrow("Acesso não autorizado");
  });

  it("recusa processos de outra organização", async () => {
    processoOrgId = "outra-org";
    const res = await exportarProcessoPdf("proc-1");
    expect(res.ok).toBe(false);
  });
});
