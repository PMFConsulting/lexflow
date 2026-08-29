import type { PDFFont } from "pdf-lib";
import { rgb } from "pdf-lib";
import { formatarData } from "@/lib/datas";

/**
 * What the two PDFs in the client's folder — `dados_cliente.pdf` and
 * `summary.pdf` — share: the palette, the sheet geometry and the text
 * conversions.
 *
 * It was all inside `resumo.ts`; it moved here when the cover became a second
 * document, so the two would not diverge in style.
 */

/* ----------------------------------------------------------------- palette */
/* The exact hex values from src/app/globals.css —
   --tinta/--tinta-suave/--latao/--linha. What was called "SELO" here always
   drew the label colour (the brand rule, the small-caps section headers), the
   same role --latao has in the design system; the carmine of --selo is for
   critical states, which neither of the two PDFs uses. */

export const TINTA = rgb(0x10 / 255, 0x1a / 255, 0x24 / 255);
export const SUAVE = rgb(0x5c / 255, 0x66 / 255, 0x72 / 255);
export const LATAO = rgb(0xa9 / 255, 0x88 / 255, 0x4f / 255);
export const LINHA = rgb(0xd6 / 255, 0xda / 255, 0xd2 / 255);
export const RODAPE = SUAVE;

/* --------------------------------------------------------------- geometry */

export const A4 = { largura: 595.28, altura: 841.89 };
export const MARGEM = { x: 56, topo: 62, fundo: 52 };
export const COLUNA_CHAVE = 150;

/**
 * The PDF standard fonts are WinAnsi: Portuguese accents pass, but a character
 * outside that table (a name in Cyrillic, an emoji pasted into a free-text
 * field) makes pdf-lib throw. Swapping it for "?" is better than ending up with
 * no summary at all.
 */
export function paraWinAnsi(texto: string): string {
  return texto
    .normalize("NFC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .split("")
    .map((c) => (c.charCodeAt(0) <= 0xff ? c : "?"))
    .join("");
}

export const dataPt = (d: Date | null) =>
  formatarData(d, { dateStyle: "short", timeZone: "Europe/Lisbon" });

export const dataHoraPt = (d: Date | null) =>
  formatarData(d, { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Lisbon" });

export const kb = (b: number) =>
  b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

/** Breaks the text into lines that fit in `largura`, measuring with the font itself. */
export function quebrar(
  texto: string,
  fonte: PDFFont,
  tamanho: number,
  largura: number,
): string[] {
  const palavras = texto.split(/\s+/).filter(Boolean);
  if (!palavras.length) return [""];

  const linhas: string[] = [];
  let atual = "";

  for (const palavra of palavras) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (fonte.widthOfTextAtSize(tentativa, tamanho) <= largura) {
      atual = tentativa;
      continue;
    }
    if (atual) linhas.push(atual);
    // A single word wider than the column (a URL, a pasted IBAN) gets broken.
    atual = palavra;
    while (fonte.widthOfTextAtSize(atual, tamanho) > largura && atual.length > 1) {
      let corte = atual.length;
      while (corte > 1 && fonte.widthOfTextAtSize(atual.slice(0, corte), tamanho) > largura) {
        corte -= 1;
      }
      linhas.push(atual.slice(0, corte));
      atual = atual.slice(corte);
    }
  }

  if (atual) linhas.push(atual);
  return linhas;
}
