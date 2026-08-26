import { PDFDict, PDFDocument, PDFName, PDFString, StandardFonts, type PDFPage } from "pdf-lib";
import {
  A4,
  COLUNA_CHAVE,
  LATAO,
  LINHA,
  MARGEM,
  RODAPE,
  SUAVE,
  TINTA,
  dataHoraPt,
  dataPt,
  kb,
  paraWinAnsi,
} from "./pdf";

/**
 * The `dados_cliente.pdf` — the cover page of the client's folder.
 *
 * It is the file the Python helper already left in each client folder, and it
 * is the first one opened on entering a case file: whoever reaches the folder
 * wants to know which matter it is, whose, from when, and what is inside.
 * `summary.pdf` stays alongside with all the detail.
 *
 * One sheet, four lines and the index of the files. No sensitive data, for the
 * same reason as the summary: a shared folder does not have the per-role access
 * control the platform has.
 */

export type DadosCapa = {
  referencia: string;
  nome: string;
  nif: string | null;
  submetidoEm: Date | null;
  /** Generation date. Passed as a parameter so the PDF is reproducible in the tests. */
  geradoEm: Date;
  /** The files accompanying the cover, in the order they go to the folder. */
  ficheiros: { nome: string; bytes: number }[];
};

export async function gerarCapaPdf(d: DadosCapa): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Dados do cliente · ${d.referencia}`);
  pdf.setProducer("LexFlow");
  pdf.setCreationDate(d.geradoEm);
  pdf.setModificationDate(d.geradoEm);

  // For the same reason as `summary.pdf` (D24): the reference in plain text in
  // the Info dictionary, so a `grep` over the folder finds it without opening
  // the PDF.
  const info = pdf.context.lookup(pdf.context.trailerInfo.Info, PDFDict);
  info.set(PDFName.of("Referencia"), PDFString.of(d.referencia.replace(/[^A-Za-z0-9._-]/g, "")));

  const corpo = await pdf.embedFont(StandardFonts.Helvetica);
  const forte = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serifa = await pdf.embedFont(StandardFonts.TimesRoman);

  let pagina: PDFPage = pdf.addPage([A4.largura, A4.altura]);
  let y = A4.altura - MARGEM.topo;

  const escrever = (
    texto: string,
    x: number,
    yy: number,
    fonte: typeof corpo,
    tamanho: number,
    cor = TINTA,
    espacamento = 0,
  ) => {
    const limpo = paraWinAnsi(texto);

    // pdf-lib's `drawText` has no tracking; the small caps are drawn character
    // by character.
    if (espacamento > 0) {
      let cursor = x;
      for (const c of limpo) {
        pagina.drawText(c, { x: cursor, y: yy, font: fonte, size: tamanho, color: cor });
        cursor += fonte.widthOfTextAtSize(c, tamanho) + espacamento;
      }
      return;
    }

    pagina.drawText(limpo, { x, y: yy, font: fonte, size: tamanho, color: cor });
  };

  const espaco = (preciso: number) => {
    if (y - preciso >= MARGEM.fundo) return;
    pagina = pdf.addPage([A4.largura, A4.altura]);
    y = A4.altura - MARGEM.topo;
  };

  const regua = (espessura: number, cor = LINHA) =>
    pagina.drawLine({
      start: { x: MARGEM.x, y },
      end: { x: A4.largura - MARGEM.x, y },
      thickness: espessura,
      color: cor,
    });

  const seccao = (titulo: string) => {
    espaco(52);
    y -= 6;
    escrever(titulo.toUpperCase(), MARGEM.x, y, forte, 8, LATAO, 1.6);
    y -= 8;
    regua(1.2, TINTA);
    y -= 16;
  };

  const linha = (chave: string, valor: string) => {
    espaco(26);
    escrever(chave, MARGEM.x, y, corpo, 10, SUAVE);
    escrever(valor, MARGEM.x + COLUNA_CHAVE, y, corpo, 10);
    y -= 9;
    regua(0.6);
    y -= 13;
  };

  /** One entry of the file list: the name on the left, the size on the right. */
  const item = (nome: string, tamanho: string) => {
    espaco(26);
    const largura = A4.largura - MARGEM.x * 2;
    const direita = paraWinAnsi(tamanho);
    const larguraNome = largura - corpo.widthOfTextAtSize(direita, 10) - 12;

    // An attachment name can be longer than the line; it is truncated with an
    // ellipsis instead of overwriting the size.
    let texto = paraWinAnsi(nome);
    if (corpo.widthOfTextAtSize(texto, 10) > larguraNome) {
      while (texto.length > 1 && corpo.widthOfTextAtSize(`${texto}...`, 10) > larguraNome) {
        texto = texto.slice(0, -1);
      }
      texto = `${texto}...`;
    }

    escrever(texto, MARGEM.x, y, corpo, 10);
    escrever(
      direita,
      A4.largura - MARGEM.x - corpo.widthOfTextAtSize(direita, 10),
      y,
      corpo,
      10,
      SUAVE,
    );
    y -= 9;
    regua(0.6);
    y -= 13;
  };

  /* ---------------------------------------------------------------- header */

  escrever("JMASSANO · DADOS DO CLIENTE", MARGEM.x, y, corpo, 8, LATAO, 2.2);
  y -= 26;

  escrever(d.nome, MARGEM.x, y, serifa, 22);
  y -= 30;

  /* ---------------------------------------------------------------- blocks */

  seccao("Processo");
  linha("Referência", d.referencia);
  linha("Nome", d.nome);
  linha("NIF / NIPC", d.nif ?? "—");
  linha("Submetido em", dataHoraPt(d.submetidoEm));
  linha("Pasta criada em", dataPt(d.geradoEm));

  seccao("Ficheiros nesta pasta");
  if (d.ficheiros.length === 0) {
    linha("Ficheiros", "Nenhum, além desta capa.");
  } else {
    for (const f of d.ficheiros) item(f.nome, kb(f.bytes));
  }

  /* ---------------------------------------------------------------- footer */

  espaco(34);
  y -= 12;
  regua(0.6);
  y -= 14;
  escrever(
    `Capa gerada em ${dataPt(d.geradoEm)} · Informação confidencial · ${d.referencia}`,
    MARGEM.x,
    y,
    corpo,
    8,
    RODAPE,
  );
  y -= 11;
  escrever(
    "O detalhe do processo está no summary.pdf, nesta mesma pasta.",
    MARGEM.x,
    y,
    corpo,
    8,
    RODAPE,
  );

  // No object streams, as in the summary (D24): the cover has to be
  // inspectable without a PDF library at hand.
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
