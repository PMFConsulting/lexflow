import { inflateRawSync } from "node:zlib";

/**
 * Leitor de folhas de cálculo — CSV e XLSX — sem dependências novas.
 *
 * Sem SheetJS: as versões no npm ficaram com vulnerabilidades por corrigir, e
 * o que há para ler é simples — três colunas de texto. Lê só a primeira
 * folha, valores em cache (não fórmulas), sem datas nem ficheiros protegidos
 * por palavra-passe; o que não sabe ler vira erro de linha na pré-visualização,
 * não um valor errado.
 *
 * Um .xlsx é um ZIP com XML: `sheet1.xml` tem as células (texto vem como
 * índice `t="s"`) e `sharedStrings.xml` é a tabela desse índice. Descompressão
 * via `inflateRawSync` do `node:zlib` (deflate cru).
 */

/** Uma linha de folha, já como texto. */
export type LinhaDaFolha = string[];

export class ErroDeFicheiro extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "ErroDeFicheiro";
  }
}

/* ------------------------------------------------------------------- CSV -- */

/**
 * O separador, adivinhado a partir da primeira linha.
 *
 * PT grava CSV com `;` (a vírgula já é separador decimal); EN grava com `,`.
 * Conta-se fora das aspas — `"Silva, Maria"` tem mais vírgulas que pontos e
 * vírgulas, e um palpite ingénuo escolhia a vírgula errada.
 */
function adivinharSeparador(texto: string) {
  const primeira = texto.split(/\r?\n/)[0] ?? "";
  let aspas = false;
  const contagem = { ";": 0, ",": 0, "\t": 0 };

  for (const c of primeira) {
    if (c === '"') aspas = !aspas;
    else if (!aspas && (c === ";" || c === "," || c === "\t")) contagem[c]++;
  }

  const [melhor] = Object.entries(contagem).sort((a, b) => b[1] - a[1]);
  return melhor && melhor[1] > 0 ? melhor[0] : ",";
}

/**
 * CSV com aspas, à regra do RFC 4180.
 *
 * Escrito à mão: `split(",")` não lida com separador dentro de um campo,
 * aspas duplicadas (`""`) nem quebras de linha dentro de um campo entre aspas.
 */
export function lerCsv(texto: string): LinhaDaFolha[] {
  // BOM: o Excel grava-o em UTF-8; sem isto o cabeçalho fica "nome" e não
  // casa com "nome".
  const limpo = texto.replace(/^/, "");
  const separador = adivinharSeparador(limpo);

  const linhas: LinhaDaFolha[] = [];
  let campo = "";
  let linha: string[] = [];
  let aspas = false;

  for (let i = 0; i < limpo.length; i++) {
    const c = limpo[i];

    if (aspas) {
      if (c === '"') {
        if (limpo[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          aspas = false;
        }
      } else {
        campo += c;
      }
      continue;
    }

    if (c === '"') {
      aspas = true;
    } else if (c === separador) {
      linha.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      // `\r\n` conta como uma quebra só.
      if (c === "\r" && limpo[i + 1] === "\n") i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else {
      campo += c;
    }
  }

  if (campo !== "" || linha.length > 0) {
    linha.push(campo);
    linhas.push(linha);
  }

  return linhas.filter((l) => l.some((c) => c.trim() !== ""));
}

/* ------------------------------------------------------------------ ZIP -- */

/**
 * Os ficheiros de um ZIP, pelo nome.
 *
 * Lê-se o directório central (fim do ficheiro), não os cabeçalhos locais:
 * estes podem ter tamanho zero e remeter para um descritor depois dos dados,
 * e nesse caso não há como saber onde o conteúdo acaba sem descomprimir às
 * cegas.
 */
function abrirZip(bytes: Buffer): Map<string, Buffer> {
  const FIM = 0x06054b50; // assinatura do "end of central directory"
  const ENTRADA = 0x02014b50; // assinatura de cada entrada do directório

  // O fim tem um comentário de tamanho variável no rabo, por isso procura-se de
  // trás para a frente. 22 é o tamanho do registo sem comentário.
  let fim = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 0xffff; i--) {
    if (bytes.readUInt32LE(i) === FIM) {
      fim = i;
      break;
    }
  }
  if (fim < 0) throw new ErroDeFicheiro("O ficheiro não é um .xlsx válido (não é sequer um ZIP).");

  const total = bytes.readUInt16LE(fim + 10);
  let posicao = bytes.readUInt32LE(fim + 16);

  const ficheiros = new Map<string, Buffer>();

  for (let n = 0; n < total; n++) {
    if (bytes.readUInt32LE(posicao) !== ENTRADA) {
      throw new ErroDeFicheiro("O .xlsx está corrompido (índice interno ilegível).");
    }

    const metodo = bytes.readUInt16LE(posicao + 10);
    const comprimido = bytes.readUInt32LE(posicao + 20);
    const tamanhoNome = bytes.readUInt16LE(posicao + 28);
    const tamanhoExtra = bytes.readUInt16LE(posicao + 30);
    const tamanhoComentario = bytes.readUInt16LE(posicao + 32);
    const inicioLocal = bytes.readUInt32LE(posicao + 42);
    const nome = bytes.toString("utf8", posicao + 46, posicao + 46 + tamanhoNome);

    // O cabeçalho local tem os seus próprios campos de nome/extra, e o
    // conteúdo começa a seguir a eles. Os tamanhos deles não têm de ser iguais
    // aos do directório — o campo "extra" costuma diferir.
    const nomeLocal = bytes.readUInt16LE(inicioLocal + 26);
    const extraLocal = bytes.readUInt16LE(inicioLocal + 28);
    const inicioDados = inicioLocal + 30 + nomeLocal + extraLocal;
    const dados = bytes.subarray(inicioDados, inicioDados + comprimido);

    if (metodo === 0) {
      ficheiros.set(nome, dados);
    } else if (metodo === 8) {
      try {
        ficheiros.set(nome, inflateRawSync(dados));
      } catch {
        throw new ErroDeFicheiro(`O .xlsx está corrompido (falhou a descomprimir "${nome}").`);
      }
    }
    // Outros métodos (bzip2, lzma) não aparecem em ficheiros do Excel; o que
    // não se souber ler fica simplesmente de fora, e a falta dá-se pela
    // ausência da folha logo a seguir.

    posicao += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario;
  }

  return ficheiros;
}

/* ----------------------------------------------------------------- XLSX -- */

const ENTIDADES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function desescaparXml(texto: string) {
  return texto
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTIDADES[m] ?? m);
}

/**
 * A tabela de strings partilhadas.
 *
 * Cada `<si>` é uma entrada, com texto direto (`<t>`) ou partido em vários
 * `<r>` quando há formatação a meio da célula. Juntam-se todos os `<t>`.
 */
function lerStringsPartilhadas(xml: string): string[] {
  const entradas: string[] = [];

  for (const si of xml.match(/<si\b[\s\S]*?<\/si>|<si\s*\/>/g) ?? []) {
    const pedacos = si.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? [];
    entradas.push(
      pedacos
        .map((p) => desescaparXml(p.replace(/^<t\b[^>]*>/, "").replace(/<\/t>$/, "")))
        .join(""),
    );
  }

  return entradas;
}

/** "BC" → 54. A coluna vem na referência da célula e é o que dá a ordem. */
function indiceDaColuna(letras: string) {
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function lerFolha(xml: string, partilhadas: string[]): LinhaDaFolha[] {
  const linhas: LinhaDaFolha[] = [];

  for (const linhaXml of xml.match(/<row\b[\s\S]*?<\/row>|<row\b[^>]*\/>/g) ?? []) {
    const celulas: string[] = [];

    for (const celula of linhaXml.match(/<c\b[\s\S]*?<\/c>|<c\b[^>]*\/>/g) ?? []) {
      const ref = /\br="([A-Z]+)\d+"/.exec(celula)?.[1];
      const tipo = /\bt="([^"]+)"/.exec(celula)?.[1];

      let valor = "";
      if (tipo === "inlineStr") {
        // Texto guardado na própria célula, sem passar pela tabela partilhada.
        valor = (celula.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? [])
          .map((p) => desescaparXml(p.replace(/^<t\b[^>]*>/, "").replace(/<\/t>$/, "")))
          .join("");
      } else {
        const bruto = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(celula)?.[1];
        if (bruto !== undefined) {
          valor =
            tipo === "s"
              ? // `t="s"` é um índice na tabela partilhada, não o texto.
                (partilhadas[Number(desescaparXml(bruto))] ?? "")
              : desescaparXml(bruto);
        }
      }

      // Pela referência, não pela ordem de aparecimento: o Excel omite células
      // vazias, e sem isto uma linha sem nome empurrava o email para a coluna
      // do nome.
      const indice = ref ? indiceDaColuna(ref) : celulas.length;
      while (celulas.length < indice) celulas.push("");
      celulas[indice] = valor;
    }

    linhas.push(celulas);
  }

  return linhas.filter((l) => l.some((c) => c.trim() !== ""));
}

export function lerXlsx(bytes: Buffer): LinhaDaFolha[] {
  const ficheiros = abrirZip(bytes);

  const partilhadas = ficheiros.has("xl/sharedStrings.xml")
    ? lerStringsPartilhadas(ficheiros.get("xl/sharedStrings.xml")!.toString("utf8"))
    : [];

  // A primeira folha, por ordem — não pelo nome exato "sheet1.xml": um
  // ficheiro que passou por outras ferramentas pode numerá-las de outra forma.
  const nome =
    [...ficheiros.keys()]
      .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort()[0] ?? null;

  if (!nome) throw new ErroDeFicheiro("O .xlsx não tem nenhuma folha lá dentro.");

  return lerFolha(ficheiros.get(nome)!.toString("utf8"), partilhadas);
}

/* ------------------------------------------------------------- a entrada -- */

/**
 * Lê o que vier, decidindo pelo conteúdo e não pela extensão.
 *
 * `PK` são os dois primeiros bytes de qualquer ZIP. Um CSV renomeado para
 * `.xlsx` (para o sistema aceitar) lê-se na mesma pelo que é.
 */
export function lerFolhaDeCalculo(bytes: Buffer): LinhaDaFolha[] {
  if (bytes.length === 0) throw new ErroDeFicheiro("O ficheiro está vazio.");

  const zip = bytes.length > 1 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  return zip ? lerXlsx(bytes) : lerCsv(bytes.toString("utf8"));
}
