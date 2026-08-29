/**
 * Formatos aceites como anexo, e o MIME com que ficam gravados (D39).
 *
 * O MIME declarado manda quando é conhecido; só quando o browser não se
 * compromete (`""`, `application/octet-stream` — o caso do HEIC no Chrome) é
 * que a extensão decide. `x.pdf` declarado `text/html` continua recusado.
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

/** `accept` do campo, derivado da mesma lista que o servidor usa (D39) — evita a divergência que deixava o `.heic` passar no campo e ser recusado no servidor. */
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
 * O que o ficheiro **é**, e não o que ele diz ser (magic bytes).
 *
 * Nome e MIME declarado vêm do cliente e não provam nada — um HTML com
 * `<script>` chamado `cc.pdf` e declarado `application/pdf` passava as duas
 * verificações e era servido de volta com esse `Content-Type`. Assinatura por
 * formato:
 *
 *   · PDF   `%PDF-`
 *   · JPEG  `FF D8 FF`
 *   · PNG   `89 50 4E 47 0D 0A 1A 0A`
 *   · WEBP  `RIFF` … `WEBP` (bytes 0-3 e 8-11)
 *   · HEIC  `ftyp` nos bytes 4-7 (caixa ISO-BMFF, partilhada com HEIF)
 *
 * Não analisa o conteúdo do documento — um PDF com JavaScript lá dentro tem
 * `%PDF-` como qualquer outro e continua a entrar. Fecha o degrau de baixo, não
 * substitui um sanitizador.
 */
const ASSINATURAS: Record<string, (b: Uint8Array) => boolean> = {
  "application/pdf": (b) => temPrefixo(b, [0x25, 0x50, 0x44, 0x46, 0x2d]), // %PDF-
  "image/jpeg": (b) => temPrefixo(b, [0xff, 0xd8, 0xff]),
  "image/png": (b) => temPrefixo(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/webp": (b) =>
    temPrefixo(b, [0x52, 0x49, 0x46, 0x46]) && temPrefixo(b, [0x57, 0x45, 0x42, 0x50], 8),
  // Caixa `ftyp` do ISO-BMFF, partilhada com HEIF. Não exige o subtipo
  // (`heic`, `heix`, `mif1`…), que varia com o telemóvel de origem.
  "image/heic": (b) => temPrefixo(b, [0x66, 0x74, 0x79, 0x70], 4),
};

function temPrefixo(bytes: Uint8Array, esperado: number[], desvio = 0): boolean {
  if (bytes.length < desvio + esperado.length) return false;
  return esperado.every((v, i) => bytes[desvio + i] === v);
}

/**
 * Os primeiros bytes batem com o formato anunciado?
 *
 * Um MIME sem assinatura conhecida passa — evita que esquecer uma assinatura
 * ao acrescentar um formato feche a porta a tudo.
 */
export function assinaturaConfere(mime: string, bytes: Uint8Array): boolean {
  const verificar = ASSINATURAS[mime];
  return verificar ? verificar(bytes) : true;
}

/** A mensagem de um ficheiro cujo conteúdo não bate com a extensão. */
export function mensagemConteudo(nome: string): string {
  return `O conteúdo de «${nome}» não corresponde ao formato do ficheiro. Confirme que não mudou a extensão a um documento de outro tipo e volte a exportá-lo.`;
}
