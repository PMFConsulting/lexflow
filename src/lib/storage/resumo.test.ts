import { describe, expect, it } from "vitest";
import { gerarResumoPdf, type DadosResumo } from "./resumo";

const BASE: DadosResumo = {
  referencia: "PMF-2026-0042",
  nome: "António Sá Nogueira",
  tipoCliente: "particular",
  nif: "244506597",
  email: "antonio@exemplo.pt",
  telefone: "+351 912 345 678",
  nacionalidades: ["Portugal", "Brasil"],
  servicos: "Assessoria jurídica global e acompanhamento societário",
  faturacaoNome: "Nogueira & Filhos, Lda.",
  faturacaoNif: "501234567",
  faturacaoEmail: "faturacao@exemplo.pt",
  origemContacto: "recomendacao",
  areasInteresse: ["Societário", "Laboral"],
  newsletter: true,
  submetidoEm: new Date("2026-08-06T10:30:00Z"),
  documentos: [
    { nome: "cartao_cidadao.pdf", tipo: "identificacao", bytes: 240_000 },
    { nome: "comprovativo.jpg", tipo: "comprovativo_nif", bytes: 1_800_000 },
  ],
  geradoEm: new Date("2026-08-06T11:00:00Z"),
};

/** A PDF's text sits in compressed streams; the titles do not. */
const comoTexto = (pdf: Buffer) => pdf.toString("latin1");

describe("summary.pdf", () => {
  it("gera um PDF válido", async () => {
    const pdf = await gerarResumoPdf(BASE);

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(comoTexto(pdf)).toContain("%%EOF");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it("identifica o dossier no título", async () => {
    const pdf = await gerarResumoPdf(BASE);
    expect(comoTexto(pdf)).toContain("PMF-2026-0042");
  });

  it("é reproduzível: as mesmas entradas dão os mesmos bytes", async () => {
    const a = await gerarResumoPdf(BASE);
    const b = await gerarResumoPdf(BASE);
    expect(a.equals(b)).toBe(true);
  });

  it("aguenta um processo quase vazio", async () => {
    const pdf = await gerarResumoPdf({
      ...BASE,
      nif: null,
      email: null,
      telefone: null,
      nacionalidades: [],
      servicos: null,
      faturacaoNome: null,
      faturacaoNif: null,
      faturacaoEmail: null,
      origemContacto: null,
      areasInteresse: [],
      submetidoEm: null,
      documentos: [],
    });

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("não rebenta com caracteres fora da tabela WinAnsi", async () => {
    // The PDF standard fonts are Latin-1: a name in Cyrillic or an emoji pasted
    // into a free-text field made pdf-lib throw.
    const pdf = await gerarResumoPdf({
      ...BASE,
      nome: "Ярослав Ткаченко 🙂",
      servicos: "Contrato — “cláusula” … 中文",
    });

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("aguenta um nome e serviços muito longos sem perder o PDF", async () => {
    const pdf = await gerarResumoPdf({
      ...BASE,
      servicos: "Acompanhamento jurídico continuado ".repeat(40),
      documentos: Array.from({ length: 40 }, (_, i) => ({
        nome: `anexo_${i}.pdf`,
        tipo: "outro",
        bytes: 10_000,
      })),
    });

    // It went past one page, and it is still a valid PDF.
    expect(comoTexto(pdf).match(/\/Type \/Page[^s]/g)?.length ?? 0).toBeGreaterThan(1);
    expect(comoTexto(pdf)).toContain("%%EOF");
  });
});
