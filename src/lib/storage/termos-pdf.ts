import { PDFDocument, StandardFonts, type PDFPage } from "pdf-lib";
import { TERMOS_CONDICOES, VERSAO_TERMOS } from "@/lib/termos";
import {
  A4,
  LINHA,
  MARGEM,
  RODAPE,
  SELO,
  SUAVE,
  TINTA,
  dataPt,
  paraWinAnsi,
  quebrar,
} from "./pdf";

/**
 * Os Termos e Condições em PDF, para anexar ao email de boas-vindas.
 *
 * O texto vem de `src/lib/termos.ts`, o mesmo que o cliente leu no passo 7 e o
 * mesmo que está em `/termos-condicoes`. Se um dia divergirem, o cliente terá
 * aceitado uma coisa e recebido outra — e o anexo é a cópia que lhe fica.
 *
 * A versão vai impressa em todas as páginas: um PDF guardado numa pasta durante
 * sete anos tem de dizer, sem ajuda de mais nada, a que versão do articulado
 * corresponde.
 */
export async function gerarTermosPdf(geradoEm: Date): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Termos e Condicoes ${VERSAO_TERMOS}`);
  pdf.setProducer("POC Processos");
  pdf.setCreationDate(geradoEm);
  pdf.setModificationDate(geradoEm);

  const corpo = await pdf.embedFont(StandardFonts.Helvetica);
  const forte = await pdf.embedFont(StandardFonts.HelveticaBold);

  const largura = A4.largura - MARGEM.x * 2;
  let pagina: PDFPage = pdf.addPage([A4.largura, A4.altura]);
  let y = A4.altura - MARGEM.topo;

  const escrever = (
    texto: string,
    yy: number,
    fonte: typeof corpo,
    tamanho: number,
    cor = TINTA,
  ) => pagina.drawText(paraWinAnsi(texto), { x: MARGEM.x, y: yy, font: fonte, size: tamanho, color: cor });

  const rodape = () => {
    pagina.drawText(
      paraWinAnsi(
        `JMASSANO - Escritorio de Advogado · Termos e Condicoes · Versao ${VERSAO_TERMOS}`,
      ),
      { x: MARGEM.x, y: MARGEM.fundo - 18, font: corpo, size: 8, color: RODAPE },
    );
  };

  const novaPagina = () => {
    rodape();
    pagina = pdf.addPage([A4.largura, A4.altura]);
    y = A4.altura - MARGEM.topo;
  };

  const espaco = (preciso: number) => {
    if (y - preciso < MARGEM.fundo) novaPagina();
  };

  /* --------------------------------------------------------------- cabeça */

  escrever("Termos e Condições", y, forte, 20);
  y -= 18;
  escrever(
    `Condições de prestação de serviços jurídicos · Versão ${VERSAO_TERMOS}`,
    y,
    corpo,
    9,
    SELO,
  );
  y -= 12;
  pagina.drawLine({
    start: { x: MARGEM.x, y },
    end: { x: A4.largura - MARGEM.x, y },
    thickness: 1.2,
    color: TINTA,
  });
  y -= 24;

  /* -------------------------------------------------------------- corpo */

  for (const seccao of TERMOS_CONDICOES) {
    // Um título não fica sozinho no fundo da página com o parágrafo na
    // seguinte: se não couber com pelo menos duas linhas atrás, salta já.
    espaco(52);
    escrever(seccao.titulo, y, forte, 11);
    y -= 16;

    for (const paragrafo of seccao.paragrafos) {
      for (const linha of quebrar(paraWinAnsi(paragrafo), corpo, 10, largura)) {
        espaco(16);
        escrever(linha, y, corpo, 10, SUAVE);
        y -= 14;
      }
      y -= 5;
    }

    espaco(20);
    pagina.drawLine({
      start: { x: MARGEM.x, y: y + 6 },
      end: { x: A4.largura - MARGEM.x, y: y + 6 },
      thickness: 0.6,
      color: LINHA,
    });
    y -= 14;
  }

  espaco(24);
  escrever(`Documento gerado em ${dataPt(geradoEm)}.`, y, corpo, 8, RODAPE);
  rodape();

  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
