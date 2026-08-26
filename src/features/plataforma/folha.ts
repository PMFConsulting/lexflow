import { inflateRawSync } from "node:zlib";

/**
 * Leitor de folhas de cálculo — CSV e XLSX — sem dependências novas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Porque não uma biblioteca
 *
 * O candidato óbvio era o SheetJS (`xlsx`). Duas razões para não entrar: as
 * versões publicadas no registo do npm ficaram paradas com vulnerabilidades
 * conhecidas (o projeto passou a distribuir a partir do CDN próprio, que é uma
 * origem a mais para instalar num sistema que guarda documentos de
 * identificação), e o que aqui é preciso ler é a folha mais simples que existe
 * — três colunas de texto, uma linha por pessoa.
 *
 * O que se paga por isso está declarado: isto lê a **primeira folha**, células
 * de texto e de número, partilhadas ou em linha. Não lê fórmulas (lê o valor
 * em cache, que é o que o Excel guarda ao lado), não lê datas como datas e não
 * lê ficheiros protegidos por palavra-passe. Para nomes, emails e papéis, é o
 * suficiente — e o que não conseguir ler aparece como erro de linha na
 * pré-visualização, nunca como um valor errado que passa calado.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O que um .xlsx é
 *
 * Um ZIP com XML lá dentro. Interessam dois ficheiros:
 *
 *   xl/worksheets/sheet1.xml — as células, cada uma com a sua referência (A1,
 *     B7). As de texto não guardam o texto: guardam `t="s"` e um índice.
 *   xl/sharedStrings.xml — a tabela onde esse índice vai buscar o texto.
 *
 * A descompressão é `deflate` cru, que o `node:zlib` faz de origem
 * (`inflateRawSync`). Não há aqui nada de criptográfico nem de exótico — é
 * leitura de um formato documentado.
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
 * O Excel português grava CSV com `;`, porque a vírgula já está a servir de
 * separador decimal. O Excel inglês e toda a gente que exporta de um sistema
 * gravam com `,`. Um ficheiro de três colunas separado pelo caractere errado
 * lê-se como uma coluna só — e o erro que daí sai ("falta o email") manda quem
 * o lê corrigir a coluna errada.
 *
 * Conta-se **fora das aspas**: um nome como `"Silva, Maria"` numa folha
 * separada por `;` tem mais vírgulas do que pontos e vírgulas, e o palpite
 * ingénuo escolhia a vírgula.
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
 * Escrito à mão e não com um `split(",")` porque as três coisas que o `split`
 * não faz são exatamente as três que aparecem em ficheiros reais: campos com o
 * separador lá dentro, aspas duplicadas a representar uma aspa (`""`), e
 * quebras de linha dentro de um campo entre aspas.
 */
export function lerCsv(texto: string): LinhaDaFolha[] {
  // BOM: o Excel põe-no em UTF-8, e sem isto a primeira coluna do cabeçalho
  // chama-se "﻿nome" — que não é "nome", e o cabeçalho deixa de casar.
  const limpo = texto.replace(/^﻿/, "");
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
 * Percorre-se o **directório central** (no fim do ficheiro) e não os cabeçalhos
 * locais: o cabeçalho local pode ter os tamanhos a zero e remetê-los para um
 * descritor que vem depois dos dados, e nesse caso não há como saber onde o
 * conteúdo acaba sem descomprimir às cegas. O directório central tem sempre os
 * tamanhos certos.
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
 * Cada `<si>` é uma entrada, e pode ter o texto direto (`<t>`) ou partido em
 * vários `<r>` quando há formatação a meio da célula — uma palavra a negrito
 * chega para o Excel partir "Maria Silva" em dois pedaços. Juntam-se todos os
 * `<t>` de dentro do `<si>`, que é o que devolve a célula como ela se lê.
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

      // Pela referência e não pela ordem de aparecimento: o Excel **omite** as
      // células vazias, e sem isto uma linha sem o nome preenchido subia o email
      // para a coluna do nome e passava a validação a acusar o campo errado.
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

  // A primeira folha. O nome canónico é `sheet1.xml`, mas um ficheiro que já
  // passou por outras ferramentas pode ter as folhas noutra numeração — daí a
  // procura ordenada em vez de exigir o nome exato.
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
 * `PK` são os dois primeiros bytes de qualquer ZIP — e um `.xlsx` é um ZIP.
 * Um ficheiro renomeado (o CSV que alguém gravou como `.xlsx` para o sistema o
 * aceitar, que acontece sempre) lê-se na mesma pelo que é.
 */
export function lerFolhaDeCalculo(bytes: Buffer): LinhaDaFolha[] {
  if (bytes.length === 0) throw new ErroDeFicheiro("O ficheiro está vazio.");

  const zip = bytes.length > 1 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  return zip ? lerXlsx(bytes) : lerCsv(bytes.toString("utf8"));
}
