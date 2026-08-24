import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
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
  quebrar,
} from "./pdf";

/**
 * The `summary.pdf` that accompanies each client folder.
 *
 * Drawn with pdf-lib and not converted from HTML: the repo does not have — nor
 * want — a headless Chrome in the container just for this. What is kept is the
 * style of `public/custos.html`: the brand in small caps, the title in serif,
 * the thin-ruled table and the footer.
 *
 * The content rule, and this is the important part: only what serves to
 * identify the case file in the folder goes in here. Deliberately left out is
 * everything the folder does not need to hold in the clear — the PEP
 * declaration, the source of funds, the identification document's number and
 * validity, the full address and the signature. Those live in the application,
 * with the per-role access control a folder on the archive server does not
 * have.
 */

export type DadosResumo = {
  referencia: string;
  nome: string;
  tipoCliente: "particular" | "empresa";
  nif: string | null;
  email: string | null;
  telefone: string | null;
  nacionalidades: string[];
  servicos: string | null;
  faturacaoNome: string | null;
  faturacaoNif: string | null;
  faturacaoEmail: string | null;
  origemContacto: string | null;
  areasInteresse: string[];
  newsletter: boolean;
  submetidoEm: Date | null;
  documentos: { nome: string; tipo: string; bytes: number }[];
  /** Generation date. Passed as a parameter so the PDF is reproducible in the tests. */
  geradoEm: Date;
};

const ORIGEM_TEXTO: Record<string, string> = {
  recomendacao: "Recomendação de cliente anterior",
  pesquisa_online: "Pesquisa online",
  evento_conferencia: "Evento / Conferência",
  outro: "Outro",
};

const TIPO_DOCUMENTO_TEXTO: Record<string, string> = {
  identificacao: "Identificação",
  comprovativo_nif: "Comprovativo de NIF",
  certidao_permanente: "Certidão permanente",
  procuracao: "Procuração",
  ata_designacao: "Ata de designação",
  comprovativo_rcbe: "Comprovativo de RCBE",
  dossier_assinado: "Dossier assinado",
  outro: "Outro",
};

export async function gerarResumoPdf(d: DadosResumo): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Dossier do cliente · ${d.referencia}`);
  pdf.setProducer("POC Processos");
  pdf.setCreationDate(d.geradoEm);
  pdf.setModificationDate(d.geradoEm);

  // pdf-lib's `setTitle` writes the text in hexadecimal UTF-16BE, which is
  // unreadable for anyone opening the file in an editor or running a `grep`
  // over the client's folder. The reference also goes in as its own entry in
  // the Info dictionary, in plain text: it is what identifies the case file
  // without opening the PDF. Filtered down to reference ASCII — a stray
  // parenthesis broke the literal string's syntax.
  const info = pdf.context.lookup(pdf.context.trailerInfo.Info, PDFDict);
  info.set(
    PDFName.of("Referencia"),
    PDFString.of(d.referencia.replace(/[^A-Za-z0-9._-]/g, "")),
  );

  const corpo = await pdf.embedFont(StandardFonts.Helvetica);
  const forte = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serifa = await pdf.embedFont(StandardFonts.TimesRoman);

  let pagina: PDFPage = pdf.addPage([A4.largura, A4.altura]);
  let y = A4.altura - MARGEM.topo;

  const escrever = (
    texto: string,
    x: number,
    yy: number,
    fonte: PDFFont,
    tamanho: number,
    cor = TINTA,
    espacamento = 0,
  ) => {
    const limpo = paraWinAnsi(texto);

    // pdf-lib's `drawText` has no tracking. The small-caps lines of
    // `custos.html` depend on it, so it is drawn character by character — only
    // there, which is where the cost is justified.
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

  /* ---------------------------------------------------------------- header */

  escrever("JMASSANO · DOSSIER DO CLIENTE", MARGEM.x, y, corpo, 8, LATAO, 2.2);
  y -= 26;

  escrever(d.nome, MARGEM.x, y, serifa, 22);
  y -= 16;

  escrever(
    d.tipoCliente === "empresa" ? "Pessoa coletiva" : "Pessoa singular",
    MARGEM.x,
    y,
    corpo,
    10,
    SUAVE,
  );
  y -= 30;

  /* ---------------------------------------------------------------- blocks */

  const seccao = (titulo: string) => {
    espaco(52);
    y -= 6;
    escrever(titulo.toUpperCase(), MARGEM.x, y, forte, 8, LATAO, 1.6);
    y -= 8;
    pagina.drawLine({
      start: { x: MARGEM.x, y },
      end: { x: A4.largura - MARGEM.x, y },
      thickness: 1.2,
      color: TINTA,
    });
    y -= 16;
  };

  const linha = (chave: string, valor: string | null | undefined) => {
    if (valor === null || valor === undefined || valor === "") return;

    const larguraValor = A4.largura - MARGEM.x * 2 - COLUNA_CHAVE;
    const linhas = quebrar(paraWinAnsi(valor), corpo, 10, larguraValor);

    espaco(linhas.length * 14 + 8);
    escrever(chave, MARGEM.x, y, corpo, 10, SUAVE);

    for (const [i, texto] of linhas.entries()) {
      escrever(texto, MARGEM.x + COLUNA_CHAVE, y - i * 13, corpo, 10);
    }

    y -= (linhas.length - 1) * 13 + 9;
    pagina.drawLine({
      start: { x: MARGEM.x, y },
      end: { x: A4.largura - MARGEM.x, y },
      thickness: 0.6,
      color: LINHA,
    });
    y -= 13;
  };

  seccao("Processo");
  linha("Referência", d.referencia);
  linha("Submetido em", dataHoraPt(d.submetidoEm));

  seccao("Identificação");
  linha("Nome", d.nome);
  linha("NIF / NIPC", d.nif ?? "—");
  linha("Email", d.email ?? "—");
  linha("Telefone", d.telefone ?? "—");
  linha("Nacionalidade", d.nacionalidades.join(", ") || null);

  seccao("Relação de negócio");
  linha("Serviços", d.servicos ?? "—");

  if (d.faturacaoNome || d.faturacaoNif || d.faturacaoEmail) {
    seccao("Faturação");
    linha("Nome", d.faturacaoNome);
    linha("NIF / NIPC", d.faturacaoNif);
    linha("Email", d.faturacaoEmail);
  }

  if (d.origemContacto || d.areasInteresse.length) {
    seccao("Preferências");
    linha("Origem do contacto", d.origemContacto ? (ORIGEM_TEXTO[d.origemContacto] ?? d.origemContacto) : null);
    linha("Áreas de interesse", d.areasInteresse.join(", ") || null);
    linha("Newsletter", d.newsletter ? "Autorizada" : "Não autorizada");
  }

  seccao("Documentos na pasta");
  if (d.documentos.length === 0) {
    linha("Anexos", "Nenhum documento anexado pelo cliente.");
  } else {
    for (const doc of d.documentos) {
      linha(TIPO_DOCUMENTO_TEXTO[doc.tipo] ?? "Documento", `${doc.nome} · ${kb(doc.bytes)}`);
    }
  }

  /* ---------------------------------------------------------------- footer */

  espaco(46);
  y -= 12;
  pagina.drawLine({
    start: { x: MARGEM.x, y },
    end: { x: A4.largura - MARGEM.x, y },
    thickness: 0.6,
    color: LINHA,
  });
  y -= 14;
  escrever(
    `Documento gerado em ${dataPt(d.geradoEm)} · Informação confidencial · ${d.referencia}`,
    MARGEM.x,
    y,
    corpo,
    8,
    RODAPE,
  );
  y -= 11;
  escrever(
    "Resumo para arquivo. Os dados sensíveis do processo (PPE, origem de fundos, documento de " +
      "identificação) ficam na plataforma.",
    MARGEM.x,
    y,
    corpo,
    8,
    RODAPE,
  );

  // No object streams: with them, each page's dictionary and the Info end up
  // inside a compressed block, and an archive summary stops being inspectable
  // without a PDF library at hand. It costs a few kilobytes per case file —
  // which is what a document like this has to spare.
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
