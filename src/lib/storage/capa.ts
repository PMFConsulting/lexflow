import { PDFDict, PDFDocument, PDFName, PDFString, StandardFonts, type PDFPage } from "pdf-lib";
import {
  A4,
  COLUNA_CHAVE,
  LINHA,
  MARGEM,
  RODAPE,
  SELO,
  SUAVE,
  TINTA,
  dataHoraPt,
  dataPt,
  kb,
  paraWinAnsi,
} from "./pdf";

/**
 * O `dados_cliente.pdf` — a capa da pasta do cliente.
 *
 * É o ficheiro que o auxiliar em Python (`scripts/gera_pasta_cliente.py`) já
 * deixava no OneDrive, e é o primeiro que se abre ao entrar num dossier: quem
 * chega à pasta quer saber de que processo é, de quem, de quando, e o que lá
 * está dentro. O `summary.pdf` continua ao lado com o detalhe todo.
 *
 * Uma folha, quatro linhas e o índice dos ficheiros. Nada de dados sensíveis,
 * pela mesma razão do resumo: uma pasta partilhada não tem o controlo de
 * acesso por papel que a plataforma tem.
 */

export type DadosCapa = {
  referencia: string;
  nome: string;
  nif: string | null;
  submetidoEm: Date | null;
  /** Data de geração. Entra por parâmetro para o PDF ser reproduzível nos testes. */
  geradoEm: Date;
  /** Os ficheiros que acompanham a capa, na ordem em que vão para a pasta. */
  ficheiros: { nome: string; bytes: number }[];
};

export async function gerarCapaPdf(d: DadosCapa): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Dados do cliente · ${d.referencia}`);
  pdf.setProducer("POC Processos");
  pdf.setCreationDate(d.geradoEm);
  pdf.setModificationDate(d.geradoEm);

  // Pela mesma razão do `summary.pdf` (D24): a referência em texto simples no
  // dicionário Info, para um `grep` sobre a pasta a encontrar sem abrir o PDF.
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

    // O `drawText` do pdf-lib não tem tracking; as versaletes desenham-se
    // carácter a carácter.
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
    escrever(titulo.toUpperCase(), MARGEM.x, y, forte, 8, SELO, 1.6);
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

  /** Uma entrada da lista de ficheiros: o nome à esquerda, o tamanho à direita. */
  const item = (nome: string, tamanho: string) => {
    espaco(26);
    const largura = A4.largura - MARGEM.x * 2;
    const direita = paraWinAnsi(tamanho);
    const larguraNome = largura - corpo.widthOfTextAtSize(direita, 10) - 12;

    // Um nome de anexo pode ser mais comprido do que a linha; corta-se com
    // reticências em vez de escrever por cima do tamanho.
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

  /* --------------------------------------------------------------- cabeça */

  escrever("PMF CONSULTING · DADOS DO CLIENTE", MARGEM.x, y, corpo, 8, SELO, 2.2);
  y -= 26;

  escrever(d.nome, MARGEM.x, y, serifa, 22);
  y -= 30;

  /* --------------------------------------------------------------- blocos */

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

  /* --------------------------------------------------------------- rodapé */

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

  // Sem fluxos de objetos, como no resumo (D24): a capa tem de ser
  // inspecionável sem uma biblioteca de PDF à mão.
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
