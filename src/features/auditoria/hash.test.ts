import { describe, expect, it } from "vitest";
import { calcularHash, canonico, type EntradaAuditoria } from "./hash";

const base: EntradaAuditoria = {
  id: "0197a1c0-0000-7000-8000-000000000001",
  organizacaoId: "0197a1c0-0000-7000-8000-0000000000aa",
  processoId: null,
  atorId: null,
  acao: "processo.criado",
  entidade: "processo_onboarding",
  entidadeId: null,
  valorAnterior: null,
  valorNovo: { estado: "rascunho" },
  ip: "127.0.0.1",
  userAgent: "vitest",
  criadoEm: new Date("2026-07-31T10:00:00.000Z"),
};

describe("canonico", () => {
  it("ordena as chaves para o mesmo objeto dar sempre a mesma string", () => {
    expect(canonico({ b: 1, a: 2 })).toBe(canonico({ a: 2, b: 1 }));
  });

  it("ordena em profundidade", () => {
    expect(canonico({ x: { z: 1, y: 2 } })).toBe(canonico({ x: { y: 2, z: 1 } }));
  });

  it("distingue null de ausente sem partir", () => {
    expect(canonico({ a: null })).toBe('{"a":null}');
    expect(canonico({ a: undefined })).toBe("{}");
  });

  it("serializa datas em ISO", () => {
    expect(canonico(new Date("2026-07-31T10:00:00.000Z"))).toBe(
      '"2026-07-31T10:00:00.000Z"',
    );
  });
});

describe("calcularHash", () => {
  it("é determinístico", () => {
    expect(calcularHash(base, null)).toBe(calcularHash(base, null));
  });

  it("muda quando o hash anterior muda — é isso que faz a cadeia", () => {
    expect(calcularHash(base, null)).not.toBe(calcularHash(base, "a".repeat(64)));
  });

  it("muda quando qualquer campo da entrada muda", () => {
    const adulterada = { ...base, acao: "processo.aprovado" };
    expect(calcularHash(adulterada, null)).not.toBe(calcularHash(base, null));
  });

  it("devolve um SHA-256 em hexadecimal", () => {
    expect(calcularHash(base, null)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("calcula hash para eventos de auditoria de plataforma (organizacaoId nil)", () => {
    const plataforma: EntradaAuditoria = {
      ...base,
      organizacaoId: "00000000-0000-0000-0000-000000000000",
      acao: "utilizador.criado",
    };
    expect(calcularHash(plataforma, null)).toMatch(/^[0-9a-f]{64}$/);
  });
});
