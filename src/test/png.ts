import { deflateSync } from "node:zlib";

/**
 * Gera um PNG RGB válido — cabeçalho, IHDR, IDAT comprimido e IEND — como
 * dataURL, para os testes de BUG-024 (pentest ronda 2) sobre a validação da
 * rubrica em `features/onboarding/assinatura.ts`. Sem bibliotecas novas.
 *
 * O ruído nos píxeis (em vez de uma cor sólida) é de propósito: um `deflate`
 * sobre uma cor lisa comprime para poucas dezenas de bytes, e um teste que
 * "prova" o tamanho mínimo com uma imagem assim provava pouco.
 */
export function gerarPngDataUrl(largura: number, altura: number): string {
  const assinaturaPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; // profundidade de bit
  ihdr[9] = 2; // tipo de cor: RGB

  const linhaBytes = 1 + largura * 3;
  const raw = Buffer.alloc(linhaBytes * altura);
  for (let y = 0; y < altura; y++) {
    raw[y * linhaBytes] = 0; // sem filtro
    for (let x = 0; x < largura; x++) {
      const p = y * linhaBytes + 1 + x * 3;
      raw[p] = (x * 37 + y * 91) % 256;
      raw[p + 1] = (x * 53 + y * 17) % 256;
      raw[p + 2] = (x * 71 + y * 29) % 256;
    }
  }

  const png = Buffer.concat([
    assinaturaPng,
    chunkPng("IHDR", ihdr),
    chunkPng("IDAT", deflateSync(raw)),
    chunkPng("IEND", Buffer.alloc(0)),
  ]);

  return `data:image/png;base64,${png.toString("base64")}`;
}

function chunkPng(tipo: string, dados: Buffer): Buffer {
  const tipoBuf = Buffer.from(tipo, "ascii");
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length, 0);
  const corpo = Buffer.concat([tipoBuf, dados]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32Png(corpo), 0);
  return Buffer.concat([tamanho, corpo, crcBuf]);
}

function crc32Png(bytes: Uint8Array): number {
  const tabela: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = tabela[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
