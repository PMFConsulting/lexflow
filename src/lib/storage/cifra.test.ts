import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cifrar, decifrar, ErroCifra, iguais, lerChave } from "./cifra";
import type { EnvelopeCifrado } from "./tipos";

const CHAVE = randomBytes(32);

const CREDENCIAIS = {
  tenantId: "0f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8",
  clientId: "aplicacao-da-sociedade",
  tokenRefresh: "1.AbCdEf-refresh-token-muito-comprido-0123456789",
};

describe("cifra dos parâmetros de armazenamento", () => {
  it("dá a volta completa", () => {
    const envelope = cifrar(CREDENCIAIS, CHAVE);
    expect(decifrar(envelope, CHAVE)).toEqual(CREDENCIAIS);
  });

  it("não deixa o segredo legível no envelope", () => {
    const envelope = cifrar(CREDENCIAIS, CHAVE);
    const serializado = JSON.stringify(envelope);

    expect(serializado).not.toContain(CREDENCIAIS.tokenRefresh);
    expect(serializado).not.toContain("refresh-token");
    // Nem em base64, que seria codificar e não cifrar.
    expect(serializado).not.toContain(
      Buffer.from(CREDENCIAIS.tokenRefresh, "utf8").toString("base64"),
    );
  });

  it("usa um nonce diferente a cada cifra", () => {
    const a = cifrar(CREDENCIAIS, CHAVE);
    const b = cifrar(CREDENCIAIS, CHAVE);

    expect(a.iv).not.toBe(b.iv);
    expect(a.dados).not.toBe(b.dados);
  });

  it("recusa a chave errada", () => {
    const envelope = cifrar(CREDENCIAIS, CHAVE);
    expect(() => decifrar(envelope, randomBytes(32))).toThrow(ErroCifra);
  });

  it("deteta adulteração do criptograma", () => {
    const envelope = cifrar(CREDENCIAIS, CHAVE);
    const bytes = Buffer.from(envelope.dados, "base64");
    bytes[0] ^= 0xff;

    const adulterado: EnvelopeCifrado = { ...envelope, dados: bytes.toString("base64") };
    expect(() => decifrar(adulterado, CHAVE)).toThrow(ErroCifra);
  });

  it("deteta adulteração da etiqueta", () => {
    const envelope = cifrar(CREDENCIAIS, CHAVE);
    const adulterado: EnvelopeCifrado = {
      ...envelope,
      tag: randomBytes(16).toString("base64"),
    };
    expect(() => decifrar(adulterado, CHAVE)).toThrow(ErroCifra);
  });

  it("recusa um envelope de versão desconhecida", () => {
    const envelope = cifrar(CREDENCIAIS, CHAVE);
    expect(() =>
      decifrar({ ...envelope, v: 2 as unknown as 1 }, CHAVE),
    ).toThrow(ErroCifra);
  });

  it("não deixa a mensagem de erro dizer qual foi o problema", () => {
    const envelope = cifrar(CREDENCIAIS, CHAVE);
    try {
      decifrar(envelope, randomBytes(32));
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain(CREDENCIAIS.tokenRefresh);
    }
  });
});

describe("lerChave", () => {
  it("aceita 64 hexadecimais", () => {
    expect(lerChave(CHAVE.toString("hex"))).toHaveLength(32);
  });

  it("recusa uma chave curta, vazia ou não hexadecimal", () => {
    expect(() => lerChave("")).toThrow(ErroCifra);
    expect(() => lerChave("abc")).toThrow(ErroCifra);
    expect(() => lerChave("z".repeat(64))).toThrow(ErroCifra);
    expect(() => lerChave(CHAVE.toString("hex").slice(0, 62))).toThrow(ErroCifra);
  });
});

describe("iguais", () => {
  it("compara sem revelar o tamanho do prefixo comum", () => {
    expect(iguais("segredo", "segredo")).toBe(true);
    expect(iguais("segredo", "segred0")).toBe(false);
    expect(iguais("segredo", "segredo-mais-longo")).toBe(false);
  });
});
