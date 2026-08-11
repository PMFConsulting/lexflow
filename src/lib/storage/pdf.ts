import type { PDFFont } from "pdf-lib";
import { rgb } from "pdf-lib";

/**
 * O que os dois PDFs da pasta do cliente — `dados_cliente.pdf` e `summary.pdf` —
 * partilham: a paleta, a geometria da folha e as conversões de texto.
 *
 * Estava tudo dentro do `resumo.ts`; saiu para aqui quando a capa passou a ser
 * um segundo documento, para os dois não divergirem no estilo.
 */

/* ------------------------------------------------------------------ paleta */
/* Os hex exatos de src/app/globals.css — --tinta/--tinta-suave/--latao/--linha.
   O que aqui se chamava "SELO" desenhava sempre a cor de rótulo (a linha de
   marca, os cabeçalhos de secção em versaletes), o mesmo papel que --latao tem
   no design system; o carmim de --selo é para estados críticos, que nenhum
   dos dois PDFs usa. */

export const TINTA = rgb(0x10 / 255, 0x1a / 255, 0x24 / 255);
export const SUAVE = rgb(0x5c / 255, 0x66 / 255, 0x72 / 255);
export const LATAO = rgb(0xa9 / 255, 0x88 / 255, 0x4f / 255);
export const LINHA = rgb(0xd6 / 255, 0xda / 255, 0xd2 / 255);
export const RODAPE = SUAVE;

/* -------------------------------------------------------------- geometria */

export const A4 = { largura: 595.28, altura: 841.89 };
export const MARGEM = { x: 56, topo: 62, fundo: 52 };
export const COLUNA_CHAVE = 150;

/**
 * As fontes padrão do PDF são WinAnsi: os acentos do português passam, mas um
 * carácter fora dessa tabela (um nome em cirílico, um emoji colado num campo
 * de texto livre) faz o pdf-lib lançar. Trocar por "?" é melhor do que ficar
 * sem resumo nenhum.
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
  d ? new Intl.DateTimeFormat("pt-PT", { dateStyle: "short", timeZone: "Europe/Lisbon" }).format(d) : "—";

export const dataHoraPt = (d: Date | null) =>
  d
    ? new Intl.DateTimeFormat("pt-PT", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Europe/Lisbon",
      }).format(d)
    : "—";

export const kb = (b: number) =>
  b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

/** Parte o texto em linhas que cabem em `largura`, medindo com a própria fonte. */
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
    // Uma palavra sozinha maior do que a coluna (um URL, um IBAN colado) parte-se.
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
