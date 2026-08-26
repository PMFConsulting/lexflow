import { z } from "zod";

/**
 * Validação do logótipo da sociedade.
 *
 * Vive fora de `logotipo.ts` de propósito: aquele ficheiro é `"use server"` e,
 * pela regra do Next, só pode exportar funções `async`. Um schema de Zod, uma
 * constante e duas funções puras de validação não são `async`, e colocá-las
 * ali fazia o bundler rebentar com «Only async functions are allowed to be
 * exported in a "use server" file». Este módulo não tem efeitos, não toca na
 * base de dados e pode ser importado por quem quiser (testes incluídos).
 */

export const MAX_TAMANHO_LOGOTIPO = 2 * 1024 * 1024; // 2 MB

export const FORMATOS_MIME_LOGOTIPO = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
] as const;

export type MimeLogotipo = (typeof FORMATOS_MIME_LOGOTIPO)[number];

const CONHECIDOS_LOGOTIPO: Record<string, MimeLogotipo> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/webp": "image/webp",
  "image/svg+xml": "image/svg+xml",
};

const EXTENSOES_LOGOTIPO: Record<string, MimeLogotipo> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/** Validação com Zod dos metadados do ficheiro de logótipo. */
export const esquemaLogotipo = z.object({
  nome: z
    .string()
    .trim()
    .min(1, "O nome do ficheiro é obrigatório.")
    .max(200, "O nome do ficheiro é demasiado longo."),
  mime: z.enum(FORMATOS_MIME_LOGOTIPO, {
    error: "Formato inválido. Aceitamos PNG, JPEG, WEBP ou SVG.",
  }),
  tamanhoBytes: z
    .number()
    .int()
    .positive("O ficheiro está vazio.")
    .max(MAX_TAMANHO_LOGOTIPO, "O ficheiro é demasiado grande (máximo 2 MB)."),
});

export function normalizarMimeLogotipo(
  nome: string,
  tipoDeclarado: string | null | undefined,
): MimeLogotipo | null {
  const declarado = (tipoDeclarado ?? "").trim().toLowerCase();
  const conhecido = CONHECIDOS_LOGOTIPO[declarado];
  if (conhecido) return conhecido;

  const partes = nome.toLowerCase().split(".");
  if (partes.length < 2) return null;
  const ext = partes[partes.length - 1];
  return EXTENSOES_LOGOTIPO[ext] ?? null;
}

function temPrefixo(bytes: Uint8Array, esperado: number[], desvio = 0): boolean {
  if (bytes.length < desvio + esperado.length) return false;
  return esperado.every((v, i) => bytes[desvio + i] === v);
}

/**
 * Valida a assinatura de bytes para evitar ficheiros mascarados.
 */
export function assinaturaLogotipoConfere(mime: MimeLogotipo, bytes: Uint8Array): boolean {
  switch (mime) {
    case "image/png":
      return temPrefixo(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return temPrefixo(bytes, [0xff, 0xd8, 0xff]);
    case "image/webp":
      return temPrefixo(bytes, [0x52, 0x49, 0x46, 0x46]) && temPrefixo(bytes, [0x57, 0x45, 0x42, 0x50], 8);
    case "image/svg+xml": {
      // Para SVG, verifica se contém a tag <svg ou cabeçalho <?xml num prefixo de texto
      const inicio = new TextDecoder().decode(bytes.slice(0, 1000)).toLowerCase();
      return inicio.includes("<svg") || (inicio.includes("<?xml") && inicio.includes("<svg"));
    }
    default:
      return false;
  }
}
