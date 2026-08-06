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
  quebrar,
} from "./pdf";

/**
 * O `summary.pdf` que acompanha cada pasta de cliente.
 *
 * Desenhado com o pdf-lib e não convertido de HTML: o repo não tem — nem quer —
 * um Chrome headless no contentor só para isto. O que se mantém é o estilo de
 * `public/custos.html`: a marca em versaletes, o título em serifa, a tabela de
 * linhas finas e o rodapé.
 *
 * Regra do conteúdo, e é a parte importante: só entra aqui o que serve para
 * identificar o dossier na pasta. Fica de fora, deliberadamente, tudo o que a
 * pasta não precisa de ter em claro — a declaração de PPE, a origem de fundos,
 * o número e a validade do documento de identificação, a morada completa e a
 * rubrica. Esses vivem na aplicação, com o controlo de acesso por papel que a
 * pasta de um OneDrive não tem.
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
  /** Data de geração. Entra por parâmetro para o PDF ser reproduzível nos testes. */
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

  // O `setTitle` do pdf-lib grava o texto em UTF-16BE hexadecimal, que é
  // ilegível para quem abrir o ficheiro num editor ou correr um `grep` sobre a
  // pasta do cliente. A referência entra também como entrada própria do
  // dicionário Info, em texto simples: é o que identifica o dossier sem abrir
  // o PDF. Filtrada para ASCII de referência — um parêntese solto partia a
  // sintaxe da string literal.
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

    // O `drawText` do pdf-lib não tem tracking. As linhas em versaletes de
    // `custos.html` vivem dele, por isso desenha-se carácter a carácter — só
    // aí, que é onde o custo se justifica.
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

  /* --------------------------------------------------------------- cabeça */

  escrever("PMF CONSULTING · DOSSIER DO CLIENTE", MARGEM.x, y, corpo, 8, SELO, 2.2);
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

  /* --------------------------------------------------------------- blocos */

  const seccao = (titulo: string) => {
    espaco(52);
    y -= 6;
    escrever(titulo.toUpperCase(), MARGEM.x, y, forte, 8, SELO, 1.6);
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

  /* --------------------------------------------------------------- rodapé */

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

  // Sem fluxos de objetos: com eles, o dicionário de cada página e o Info ficam
  // dentro de um bloco comprimido, e um resumo de arquivo deixa de ser
  // inspecionável sem uma biblioteca de PDF à mão. Custa uns kilobytes por
  // dossier — que é o que um documento destes tem de sobra.
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
