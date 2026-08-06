import { describe, expect, it } from "vitest";
import { gerarCapaPdf, type DadosCapa } from "./capa";

const BASE: DadosCapa = {
  referencia: "PMF-2026-0042",
  nome: "António Sá Nogueira",
  nif: "244506597",
  submetidoEm: new Date("2026-08-06T10:30:00Z"),
  geradoEm: new Date("2026-08-06T11:00:00Z"),
  ficheiros: [
    { nome: "summary.pdf", bytes: 12_400 },
    { nome: "cartao_cidadao.pdf", bytes: 240_000 },
  ],
};

const comoTexto = (pdf: Buffer) => pdf.toString("latin1");

describe("dados_cliente.pdf", () => {
  it("gera um PDF válido", async () => {
    const pdf = await gerarCapaPdf(BASE);

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(comoTexto(pdf)).toContain("%%EOF");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it("leva a referência em texto simples, para um grep sobre a pasta", async () => {
    expect(comoTexto(await gerarCapaPdf(BASE))).toContain("PMF-2026-0042");
  });

  it("é reproduzível: as mesmas entradas dão os mesmos bytes", async () => {
    const a = await gerarCapaPdf(BASE);
    const b = await gerarCapaPdf(BASE);
    expect(a.equals(b)).toBe(true);
  });

  it("aguenta uma pasta sem anexos e um processo por submeter", async () => {
    const pdf = await gerarCapaPdf({ ...BASE, nif: null, submetidoEm: null, ficheiros: [] });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("passa de uma página com muitos anexos, sem perder o PDF", async () => {
    const pdf = await gerarCapaPdf({
      ...BASE,
      ficheiros: Array.from({ length: 60 }, (_, i) => ({
        nome: `anexo_${i}_${"nome comprido ".repeat(6)}.pdf`,
        bytes: 10_000,
      })),
    });

    expect(comoTexto(pdf).match(/\/Type \/Page[^s]/g)?.length ?? 0).toBeGreaterThan(1);
    expect(comoTexto(pdf)).toContain("%%EOF");
  });

  it("não rebenta com caracteres fora da tabela WinAnsi", async () => {
    const pdf = await gerarCapaPdf({ ...BASE, nome: "Ярослав Ткаченко 🙂" });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
