/**
 * Que ficheiros se aceitam como anexo, e com que MIME ficam gravados.
 *
 * O `accept` do input anuncia extensões (`.pdf`, `.heic`), mas o servidor
 * recusava por MIME — e o MIME que o browser declara não é de confiança: o
 * Chrome não conhece HEIC e manda `""`, ferramentas de automação mandam
 * `application/octet-stream`, e um `.pdf` arrastado de um zip chega sem tipo
 * nenhum. O resultado era um upload recusado com "Aceitamos PDF, JPG…" sobre um
 * ficheiro que estava na lista dos aceites — e, como o campo se limpa a seguir,
 * ficava a parecer que carregar o ficheiro não fazia rigorosamente nada.
 *
 * A regra passa a ser: o MIME declarado manda quando é um dos conhecidos; só
 * quando o browser não se compromete (`""` ou `application/octet-stream`) é que
 * a extensão decide. Um ficheiro que se declara `text/html` e se chama `x.pdf`
 * continua a ser recusado — a extensão não serve para contornar o filtro, só
 * para o desempatar quando não há nada que o contrarie.
 */

export const FORMATOS_ACEITES = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
} as const;

export const MENSAGEM_FORMATO = "Aceitamos PDF, JPG, PNG, WEBP ou HEIC.";

/**
 * O `accept` do campo, tirado da mesma lista que o servidor usa para recusar.
 * Estavam escritos em dois sítios, e foi por terem divergido que o problema
 * apareceu: o campo anunciava `.heic` e o servidor não o deixava entrar.
 */
export const ACCEPT = Object.keys(FORMATOS_ACEITES)
  .map((e) => `.${e}`)
  .join(",");

/** MIMEs que valem por si, incluindo o `image/jpg` que alguns sistemas emitem. */
const CONHECIDOS: Record<string, string> = {
  "application/pdf": "application/pdf",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/heic": "image/heic",
  "image/heif": "image/heic",
};

/** Tipos que só dizem "são bytes": não contrariam a extensão, logo não decidem. */
const INDECISOS = new Set(["", "application/octet-stream", "binary/octet-stream"]);

/**
 * O MIME com que o documento deve ficar gravado, ou `null` se o ficheiro não
 * for de um formato aceite.
 */
export function mimeAceite(nome: string, tipoDeclarado: string | null | undefined): string | null {
  const declarado = (tipoDeclarado ?? "").trim().toLowerCase();

  const conhecido = CONHECIDOS[declarado];
  if (conhecido) return conhecido;

  if (!INDECISOS.has(declarado)) return null;

  const partes = nome.toLowerCase().split(".");
  // Sem ponto no nome não há extensão nenhuma — `split` devolveria o nome todo.
  if (partes.length < 2) return null;

  const extensao = partes[partes.length - 1];
  return FORMATOS_ACEITES[extensao as keyof typeof FORMATOS_ACEITES] ?? null;
}

/* ------------------------------------------------------------ magic bytes */

/**
 * O que o ficheiro **é**, e não o que ele diz ser.
 *
 * O nome e o MIME declarado vêm os dois do lado do cliente, e nenhum é prova de
 * nada: um ficheiro com HTML e `<script>` lá dentro, chamado `cc.pdf` e
 * declarado `application/pdf`, passava as duas verificações e ficava gravado
 * como PDF — e a rota de download servia-o com esse `Content-Type`. O `nosniff`
 * e o `Content-Disposition: attachment` do back-office já lhe tiravam os
 * dentes, mas a defesa certa é não o deixar entrar: um dossier de KYC não
 * guarda um ficheiro que não é o que diz ser.
 *
 * A assinatura são os primeiros bytes, e os cinco formatos aceites têm uma:
 *
 *   · PDF   `%PDF-`
 *   · JPEG  `FF D8 FF`
 *   · PNG   `89 50 4E 47 0D 0A 1A 0A`
 *   · WEBP  `RIFF` … `WEBP` (bytes 0-3 e 8-11)
 *   · HEIC  `ftyp` nos bytes 4-7 (a caixa ISO-BMFF que o HEIF também usa)
 *
 * O que **não** se faz aqui é analisar o conteúdo do documento. Um PDF com
 * JavaScript lá dentro tem `%PDF-` à cabeça como qualquer outro, e continua a
 * entrar — desarmá-lo é trabalho de um sanitizador, não de cinco bytes. O que
 * isto fecha é o degrau de baixo, que é o que estava aberto.
 */
const ASSINATURAS: Record<string, (b: Uint8Array) => boolean> = {
  "application/pdf": (b) => temPrefixo(b, [0x25, 0x50, 0x44, 0x46, 0x2d]), // %PDF-
  "image/jpeg": (b) => temPrefixo(b, [0xff, 0xd8, 0xff]),
  "image/png": (b) => temPrefixo(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/webp": (b) =>
    temPrefixo(b, [0x52, 0x49, 0x46, 0x46]) && temPrefixo(b, [0x57, 0x45, 0x42, 0x50], 8),
  // `ftyp` na segunda palavra: é a caixa `ftyp` do ISO-BMFF, e a marca que o
  // HEIC e o HEIF partilham. O subtipo que vem a seguir (`heic`, `heix`,
  // `mif1`…) varia com o telemóvel que tirou a fotografia, e exigi-lo seria
  // recusar câmaras por causa de uma tabela que envelhece.
  "image/heic": (b) => temPrefixo(b, [0x66, 0x74, 0x79, 0x70], 4),
};

function temPrefixo(bytes: Uint8Array, esperado: number[], desvio = 0): boolean {
  if (bytes.length < desvio + esperado.length) return false;
  return esperado.every((v, i) => bytes[desvio + i] === v);
}

/**
 * Os primeiros bytes batem com o formato anunciado?
 *
 * Um MIME sem assinatura conhecida passa — a tabela é a lista dos aceites e
 * nenhum outro chega aqui, mas acrescentar um formato à `FORMATOS_ACEITES` e
 * esquecer a assinatura não pode transformar-se em "nada entra".
 */
export function assinaturaConfere(mime: string, bytes: Uint8Array): boolean {
  const verificar = ASSINATURAS[mime];
  return verificar ? verificar(bytes) : true;
}

/** A mensagem de um ficheiro cujo conteúdo não bate com a extensão. */
export function mensagemConteudo(nome: string): string {
  return `O conteúdo de «${nome}» não corresponde ao formato do ficheiro. Confirme que não mudou a extensão a um documento de outro tipo e volte a exportá-lo.`;
}
