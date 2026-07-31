import { describe, expect, it } from "vitest";
import {
  formatarCodigoPostal,
  formatarIban,
  validarCodigoPostal,
  validarIban,
  validarNif,
  validarTelefone,
} from "./validacao-pt";

describe("validarNif", () => {
  it("aceita NIF de pessoa singular com checksum correto", () => {
    expect(validarNif("123456789").valido).toBe(true);
    expect(validarNif("229273394").valido).toBe(true);
  });

  it("aceita NIPC de pessoa coletiva", () => {
    expect(validarNif("500000000").valido).toBe(true);
  });

  it("aceita prefixo de dois dígitos de não residente", () => {
    expect(validarNif("450000001").valido).toBe(true);
  });

  it("ignora espaços", () => {
    expect(validarNif("123 456 789").valido).toBe(true);
  });

  it("rejeita checksum errado e diz porquê", () => {
    const r = validarNif("213456789");
    expect(r.valido).toBe(false);
    if (!r.valido) expect(r.mensagem).toContain("não é válido");
  });

  it("rejeita primeiro dígito impossível", () => {
    const r = validarNif("400000000");
    expect(r.valido).toBe(false);
    if (!r.valido) expect(r.mensagem).toContain("1, 2, 3, 5, 6, 8 ou 9");
  });

  it("rejeita comprimento errado dizendo quantos dígitos foram indicados", () => {
    const r = validarNif("12345678");
    expect(r.valido).toBe(false);
    if (!r.valido) expect(r.mensagem).toContain("indicou 8");
  });

  it("rejeita letras", () => {
    expect(validarNif("12345678A").valido).toBe(false);
  });
});

describe("validarCodigoPostal", () => {
  it("aceita o formato 0000-000", () => {
    expect(validarCodigoPostal("1250-096").valido).toBe(true);
    expect(validarCodigoPostal(" 4000-123 ").valido).toBe(true);
  });

  it("rejeita sem hífen e explica o formato", () => {
    const r = validarCodigoPostal("1250096");
    expect(r.valido).toBe(false);
    if (!r.valido) expect(r.mensagem).toContain("0000-000");
  });

  it("rejeita dígitos a mais", () => {
    expect(validarCodigoPostal("1250-0967").valido).toBe(false);
  });
});

describe("formatarCodigoPostal", () => {
  it("insere o hífen à medida que se escreve", () => {
    expect(formatarCodigoPostal("1250")).toBe("1250");
    expect(formatarCodigoPostal("1250096")).toBe("1250-096");
    expect(formatarCodigoPostal("1250-096")).toBe("1250-096");
    expect(formatarCodigoPostal("12500961234")).toBe("1250-096");
  });
});

describe("validarIban", () => {
  it("aceita um IBAN português válido", () => {
    expect(validarIban("PT50000201231234567890154").valido).toBe(true);
  });

  it("aceita com espaços de leitura", () => {
    expect(validarIban("PT50 0002 0123 1234 5678 9015 4").valido).toBe(true);
  });

  it("aceita IBAN estrangeiro válido", () => {
    expect(validarIban("DE89370400440532013000").valido).toBe(true);
    expect(validarIban("GB82WEST12345698765432").valido).toBe(true);
  });

  it("rejeita comprimento errado dizendo o esperado", () => {
    const r = validarIban("PT5000020123123456789015");
    expect(r.valido).toBe(false);
    if (!r.valido) expect(r.mensagem).toContain("25 caracteres");
  });

  it("rejeita país desconhecido", () => {
    const r = validarIban("ZZ50000201231234567890154");
    expect(r.valido).toBe(false);
    if (!r.valido) expect(r.mensagem).toContain("ZZ");
  });

  it("rejeita checksum errado", () => {
    expect(validarIban("PT50000201231234567890155").valido).toBe(false);
  });
});

describe("formatarIban", () => {
  it("agrupa em blocos de 4", () => {
    expect(formatarIban("PT50000201231234567890154")).toBe(
      "PT50 0002 0123 1234 5678 9015 4",
    );
  });
});

describe("validarTelefone", () => {
  it("aceita com e sem indicativo", () => {
    expect(validarTelefone("+351 912 345 678").valido).toBe(true);
    expect(validarTelefone("912345678").valido).toBe(true);
  });

  it("rejeita letras e explica o formato", () => {
    const r = validarTelefone("91234567A");
    expect(r.valido).toBe(false);
    if (!r.valido) expect(r.mensagem).toContain("+351");
  });
});
