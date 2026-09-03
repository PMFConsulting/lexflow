import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ErroDeFicheiro, lerCsv, lerFolhaDeCalculo, lerXlsx } from "./folha";

/**
 * O leitor de folhas.
 *
 * Vale a pena dizer porque é que estes testes existem em vez de uma
 * dependência: um `.xlsx` construído à mão, byte a byte, é a única forma de
 * fixar que o leitor lê o formato e não uma amostra que calhou funcionar. O
 * `montarXlsx` abaixo é um escritor de ZIP mínimo — se o leitor e o escritor
 * concordarem numa coisa errada, os testes de CSV e os de células omitidas
 * apanham-no na mesma, porque medem o resultado e não o percurso.
 */

/* ------------------------------------------- um .xlsx construído à mão ---- */

function entradaZip(nome: string, conteudo: string) {
  const nomeBytes = Buffer.from(nome, "utf8");
  const cru = Buffer.from(conteudo, "utf8");
  const comprimido = deflateRawSync(cru);

  // CRC-32, que o formato exige. O leitor não o verifica, mas escrever um ZIP
  // com o campo a zero era escrever um ficheiro que o Excel recusaria — e este
  // ficheiro serve para provar que lemos ZIPs a sério.
  let crc = ~0;
  for (const byte of cru) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  crc = ~crc >>> 0;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // versão necessária
  local.writeUInt16LE(8, 8); // método: deflate
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comprimido.length, 18);
  local.writeUInt32LE(cru.length, 22);
  local.writeUInt16LE(nomeBytes.length, 26);

  return {
    nome: nomeBytes,
    local: Buffer.concat([local, nomeBytes, comprimido]),
    crc,
    comprimido: comprimido.length,
    cru: cru.length,
  };
}

function montarXlsx(ficheiros: Record<string, string>) {
  const entradas = Object.entries(ficheiros).map(([n, c]) => entradaZip(n, c));

  const locais: Buffer[] = [];
  const central: Buffer[] = [];
  let deslocamento = 0;

  for (const e of entradas) {
    const cabecalho = Buffer.alloc(46);
    cabecalho.writeUInt32LE(0x02014b50, 0);
    cabecalho.writeUInt16LE(20, 4);
    cabecalho.writeUInt16LE(20, 6);
    cabecalho.writeUInt16LE(8, 10); // método: deflate
    cabecalho.writeUInt32LE(e.crc, 16);
    cabecalho.writeUInt32LE(e.comprimido, 20);
    cabecalho.writeUInt32LE(e.cru, 24);
    cabecalho.writeUInt16LE(e.nome.length, 28);
    cabecalho.writeUInt32LE(deslocamento, 42);

    locais.push(e.local);
    central.push(Buffer.concat([cabecalho, e.nome]));
    deslocamento += e.local.length;
  }

  const corpo = Buffer.concat(locais);
  const indice = Buffer.concat(central);

  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(indice.length, 12);
  fim.writeUInt32LE(corpo.length, 16);

  return Buffer.concat([corpo, indice, fim]);
}

const partilhadas = (...textos: string[]) =>
  `<?xml version="1.0"?><sst count="${textos.length}">` +
  textos.map((t) => `<si><t>${t}</t></si>`).join("") +
  `</sst>`;

/* ------------------------------------------------------------------ CSV -- */

describe("lerCsv", () => {
  it("lê um ficheiro simples separado por vírgulas", () => {
    expect(lerCsv("nome,email,papel\nMaria,maria@x.pt,utilizador")).toEqual([
      ["nome", "email", "papel"],
      ["Maria", "maria@x.pt", "utilizador"],
    ]);
  });

  it("adivinha o ponto e vírgula, que é o que o Excel português grava", () => {
    expect(lerCsv("nome;email;papel\nMaria;maria@x.pt;utilizador")).toEqual([
      ["nome", "email", "papel"],
      ["Maria", "maria@x.pt", "utilizador"],
    ]);
  });

  /**
   * O caso que um `split(",")` erra e um palpite ingénuo também: o nome tem
   * duas vírgulas e a linha só tem dois `;`. Contar fora das aspas é o que
   * separa as duas leituras.
   */
  it("não se deixa enganar por vírgulas dentro de aspas ao escolher o separador", () => {
    expect(lerCsv('nome;email\n"Silva, Maria, Dra.";maria@x.pt')).toEqual([
      ["nome", "email"],
      ["Silva, Maria, Dra.", "maria@x.pt"],
    ]);
  });

  it("entende aspas duplicadas e quebras de linha dentro do campo", () => {
    expect(lerCsv('a,b\n"diz ""olá""","duas\nlinhas"')).toEqual([
      ["a", "b"],
      ['diz "olá"', "duas\nlinhas"],
    ]);
  });

  it("come o BOM do Excel — senão a primeira coluna do cabeçalho não casa", () => {
    const [cabecalho] = lerCsv("nome,email\nMaria,maria@x.pt");
    expect(cabecalho[0]).toBe("nome");
  });

  it("ignora linhas em branco e aceita CRLF", () => {
    expect(lerCsv("a,b\r\n\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

/* ----------------------------------------------------------------- XLSX -- */

describe("lerXlsx", () => {
  it("lê células de texto pela tabela partilhada", () => {
    const ficheiro = montarXlsx({
      "xl/sharedStrings.xml": partilhadas("nome", "email", "Maria Silva", "maria@x.pt"),
      "xl/worksheets/sheet1.xml":
        `<worksheet><sheetData>` +
        `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>` +
        `<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>` +
        `</sheetData></worksheet>`,
    });

    expect(lerXlsx(ficheiro)).toEqual([
      ["nome", "email"],
      ["Maria Silva", "maria@x.pt"],
    ]);
  });

  /**
   * O defeito que a referência da célula existe para evitar. O Excel **não
   * escreve** as células vazias: sem olhar para o `r=`, o email desta linha
   * subia para a coluna do nome e a validação acusava o campo errado.
   */
  it("respeita as colunas omitidas, que o Excel não escreve", () => {
    const ficheiro = montarXlsx({
      "xl/sharedStrings.xml": partilhadas("maria@x.pt", "utilizador"),
      "xl/worksheets/sheet1.xml":
        `<worksheet><sheetData>` +
        `<row r="1"><c r="B1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>` +
        `</sheetData></worksheet>`,
    });

    expect(lerXlsx(ficheiro)).toEqual([["", "maria@x.pt", "utilizador"]]);
  });

  it("junta os pedaços de uma célula com formatação a meio", () => {
    const ficheiro = montarXlsx({
      "xl/sharedStrings.xml": `<sst><si><r><t>Maria </t></r><r><t>Silva</t></r></si></sst>`,
      "xl/worksheets/sheet1.xml": `<sheetData><row><c r="A1" t="s"><v>0</v></c></row></sheetData>`,
    });

    expect(lerXlsx(ficheiro)).toEqual([["Maria Silva"]]);
  });

  it("lê texto em linha e números, e desescapa as entidades XML", () => {
    const ficheiro = montarXlsx({
      "xl/worksheets/sheet1.xml":
        `<sheetData><row>` +
        `<c r="A1" t="inlineStr"><is><t>Silva &amp; Antunes</t></is></c>` +
        `<c r="B1"><v>42</v></c>` +
        `</row></sheetData>`,
    });

    expect(lerXlsx(ficheiro)).toEqual([["Silva & Antunes", "42"]]);
  });

  it("recusa, com uma frase legível, o que não é um ZIP", () => {
    expect(() => lerXlsx(Buffer.from("isto não é um xlsx"))).toThrow(ErroDeFicheiro);
  });

  it("recusa um ZIP sem folha nenhuma lá dentro", () => {
    const ficheiro = montarXlsx({ "docProps/app.xml": "<Properties/>" });
    expect(() => lerXlsx(ficheiro)).toThrow(/não tem nenhuma folha/);
  });
});

/* ------------------------------------------------------------- a entrada -- */

describe("lerFolhaDeCalculo", () => {
  it("decide pelo conteúdo e não pela extensão — um CSV renomeado lê-se na mesma", () => {
    expect(lerFolhaDeCalculo(Buffer.from("nome;email\nMaria;maria@x.pt"))).toEqual([
      ["nome", "email"],
      ["Maria", "maria@x.pt"],
    ]);
  });

  it("reconhece o ZIP pelos dois primeiros bytes", () => {
    const ficheiro = montarXlsx({
      "xl/sharedStrings.xml": partilhadas("nome"),
      "xl/worksheets/sheet1.xml": `<sheetData><row><c r="A1" t="s"><v>0</v></c></row></sheetData>`,
    });

    expect(ficheiro.subarray(0, 2).toString()).toBe("PK");
    expect(lerFolhaDeCalculo(ficheiro)).toEqual([["nome"]]);
  });

  it("recusa um ficheiro vazio", () => {
    expect(() => lerFolhaDeCalculo(Buffer.alloc(0))).toThrow(/vazio/);
  });
});
