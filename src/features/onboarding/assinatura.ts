/**
 * Valida que a rubrica (canvas → PNG base64) é um traço real, e não uma
 * imagem forjada colada no campo escondido (BUG-024, pentest ronda 2): um
 * PNG 1x1 passava no `.startsWith(...)` e no `.length < 1_400_000` tão bem
 * quanto uma rubrica real. O quadro em `componentes/Assinatura.tsx` nunca
 * produz menos que algumas centenas de píxeis de lado, por isso um PNG abaixo
 * do mínimo aqui é outra coisa, não uma rubrica pequena.
 *
 * Lê os bytes do cabeçalho PNG diretamente (assinatura de 8 bytes + chunk
 * IHDR) — sem bibliotecas novas, sem descodificar a imagem inteira.
 */

const ASSINATURA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PREFIXO_DATA_URL = "data:image/png;base64,";

export const TAMANHO_MINIMO_ASSINATURA_BYTES = 2_000;
export const LARGURA_MINIMA_ASSINATURA_PX = 200;
export const ALTURA_MINIMA_ASSINATURA_PX = 60;

function bytesDoDataUrl(dataUrl: string): Uint8Array | null {
  if (!dataUrl.startsWith(PREFIXO_DATA_URL)) return null;

  try {
    const binario = atob(dataUrl.slice(PREFIXO_DATA_URL.length));
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Largura e altura declaradas no chunk IHDR, ou `null` se os bytes não
 * começarem por uma assinatura PNG válida.
 */
function dimensoesPng(bytes: Uint8Array): { largura: number; altura: number } | null {
  if (bytes.length < 24) return null;
  if (!ASSINATURA_PNG.every((v, i) => bytes[i] === v)) return null;

  const tipoChunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (tipoChunk !== "IHDR") return null;

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    largura: dv.getUint32(16, false),
    altura: dv.getUint32(20, false),
  };
}

/**
 * `true` só quando o dataURL é um PNG genuíno, com peso e dimensões
 * compatíveis com um traço desenhado no quadro. Recusa o 1x1 forjado do
 * pentest e qualquer imagem menor do que o quadro consegue produzir.
 */
export function assinaturaTemTracoReal(dataUrl: string): boolean {
  const bytes = bytesDoDataUrl(dataUrl);
  if (!bytes || bytes.length < TAMANHO_MINIMO_ASSINATURA_BYTES) return false;

  const dimensoes = dimensoesPng(bytes);
  if (!dimensoes) return false;

  return (
    dimensoes.largura >= LARGURA_MINIMA_ASSINATURA_PX &&
    dimensoes.altura >= ALTURA_MINIMA_ASSINATURA_PX
  );
}
