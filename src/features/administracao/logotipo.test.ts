import { describe, expect, it } from "vitest";
import {
  MAX_TAMANHO_LOGOTIPO,
  assinaturaLogotipoConfere,
  esquemaLogotipo,
  normalizarMimeLogotipo,
} from "./logotipo-validador";

describe("esquemaLogotipo", () => {
  it("aceita metadados válidos de imagem nos 4 formatos suportados", () => {
    for (const mime of ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const) {
      const r = esquemaLogotipo.safeParse({
        nome: `logo.${mime.split("/")[1]?.replace("+xml", "")}`,
        mime,
        tamanhoBytes: 1024 * 100,
      });
      expect(r.success).toBe(true);
    }
  });

  it("recusa tamanhos superiores a 2 MB", () => {
    const r = esquemaLogotipo.safeParse({
      nome: "logo_pesado.png",
      mime: "image/png",
      tamanhoBytes: MAX_TAMANHO_LOGOTIPO + 1,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/demasiado grande/i);
    }
  });

  it("recusa tamanho zero ou negativo", () => {
    const r = esquemaLogotipo.safeParse({
      nome: "vazio.png",
      mime: "image/png",
      tamanhoBytes: 0,
    });
    expect(r.success).toBe(false);
  });

  it("recusa formatos não suportados", () => {
    const r = esquemaLogotipo.safeParse({
      nome: "doc.pdf",
      mime: "application/pdf",
      tamanhoBytes: 1024,
    });
    expect(r.success).toBe(false);
  });
});

describe("normalizarMimeLogotipo", () => {
  it("normaliza MIMEs conhecidos", () => {
    expect(normalizarMimeLogotipo("logo.png", "image/png")).toBe("image/png");
    expect(normalizarMimeLogotipo("foto.jpg", "image/jpeg")).toBe("image/jpeg");
    expect(normalizarMimeLogotipo("foto.jpg", "image/jpg")).toBe("image/jpeg");
    expect(normalizarMimeLogotipo("grafico.webp", "image/webp")).toBe("image/webp");
    expect(normalizarMimeLogotipo("vector.svg", "image/svg+xml")).toBe("image/svg+xml");
  });

  it("deduz o MIME pela extensão quando o tipo declarado é ausente ou indeciso", () => {
    expect(normalizarMimeLogotipo("empresa.png", "")).toBe("image/png");
    expect(normalizarMimeLogotipo("empresa.jpeg", "application/octet-stream")).toBe("image/jpeg");
    expect(normalizarMimeLogotipo("empresa.jpg", null)).toBe("image/jpeg");
    expect(normalizarMimeLogotipo("empresa.webp", undefined)).toBe("image/webp");
    expect(normalizarMimeLogotipo("empresa.svg", "")).toBe("image/svg+xml");
  });

  it("rejeita ficheiros com extensão ou MIME inválidos", () => {
    expect(normalizarMimeLogotipo("contrato.pdf", "application/pdf")).toBeNull();
    expect(normalizarMimeLogotipo("animacao.gif", "image/gif")).toBeNull();
    expect(normalizarMimeLogotipo("script.js", "application/javascript")).toBeNull();
    expect(normalizarMimeLogotipo("ficheiro_sem_extensao", "")).toBeNull();
  });
});

describe("assinaturaLogotipoConfere", () => {
  it("valida bytes de PNG", () => {
    const bytesValidos = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(assinaturaLogotipoConfere("image/png", bytesValidos)).toBe(true);

    const bytesInvalidos = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
    expect(assinaturaLogotipoConfere("image/png", bytesInvalidos)).toBe(false);
  });

  it("valida bytes de JPEG", () => {
    const bytesValidos = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    expect(assinaturaLogotipoConfere("image/jpeg", bytesValidos)).toBe(true);

    const bytesInvalidos = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(assinaturaLogotipoConfere("image/jpeg", bytesInvalidos)).toBe(false);
  });

  it("valida bytes de WEBP", () => {
    // RIFF .... WEBP
    const bytesValidos = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x20, 0x00, 0x00, 0x00, // tamanho
      0x57, 0x45, 0x42, 0x50, // WEBP
    ]);
    expect(assinaturaLogotipoConfere("image/webp", bytesValidos)).toBe(true);

    const bytesInvalidos = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00]);
    expect(assinaturaLogotipoConfere("image/webp", bytesInvalidos)).toBe(false);
  });

  it("valida conteúdo de SVG", () => {
    const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>');
    expect(assinaturaLogotipoConfere("image/svg+xml", svgBytes)).toBe(true);

    const xmlSvgBytes = new TextEncoder().encode('<?xml version="1.0"?><svg viewBox="0 0 100 100"></svg>');
    expect(assinaturaLogotipoConfere("image/svg+xml", xmlSvgBytes)).toBe(true);

    const textoNaoSvg = new TextEncoder().encode("<html><body>Não é svg</body></html>");
    expect(assinaturaLogotipoConfere("image/svg+xml", textoNaoSvg)).toBe(false);
  });
});
