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
