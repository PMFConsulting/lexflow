import { describe, expect, it } from "vitest";
import { mensagemSegura, nomeDaPasta } from "./sanitizacao";

/**
 * What is written to `evento_auditoria` and to `ultimo_erro` is read in the
 * back-office and stays seven years in the database. A token that slips in here
 * stays there, and the audit trail allows no UPDATE to take it out.
 */
describe("mensagemSegura", () => {
  it("remove um Bearer token", () => {
    const limpa = mensagemSegura(
      new Error("pedido recusado com authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGc.abc-123"),
    );
    expect(limpa).not.toContain("eyJ0eXAiOiJKV1Qi");
    expect(limpa).toContain("[removido]");
  });

  it("remove credenciais Basic", () => {
    const limpa = mensagemSegura(new Error("Basic cG1mOnNlZ3JlZG8="));
    expect(limpa).not.toContain("cG1mOnNlZ3JlZG8=");
  });

  it("remove segredos passados em query string", () => {
    const limpa = mensagemSegura(
      new Error("POST /token?refresh_token=1.AbCdEf-muito-secreto&client_id=x falhou"),
    );
    expect(limpa).not.toContain("1.AbCdEf-muito-secreto");
    expect(limpa).toContain("client_id=x");
  });

  it("remove credenciais embebidas no URL", () => {
    const limpa = mensagemSegura(
      new Error("fetch failed: https://pmf:palavra-passe@arquivo.exemplo.pt/Clientes"),
    );
    expect(limpa).not.toContain("palavra-passe");
    expect(limpa).toContain("arquivo.exemplo.pt");
  });

  it("trunca e normaliza", () => {
    const limpa = mensagemSegura(new Error("erro\n  com   quebras\n\n".repeat(60)));
    expect(limpa.length).toBeLessThanOrEqual(300);
    expect(limpa).not.toContain("\n");
  });

  it("aguenta o que não é um Error", () => {
    expect(mensagemSegura("falhou")).toBe("falhou");
    expect(mensagemSegura(null)).toBe("null");
    expect(mensagemSegura(undefined)).toBe("undefined");
  });
});

describe("nomeDaPasta", () => {
  it("junta o NIF para desempatar homónimos", () => {
    expect(nomeDaPasta("Ana Silva", "244506597")).toBe("Ana Silva (244506597)");
  });

  it("fica só com o nome quando ainda não há NIF", () => {
    expect(nomeDaPasta("Ana Silva", null)).toBe("Ana Silva");
  });

  it("desarma um nome hostil", () => {
    const pasta = nomeDaPasta("../../etc", null);
    expect(pasta).not.toContain("/");
    expect(pasta).not.toContain("..");
  });

  it("não fica sem nome nenhum", () => {
    expect(nomeDaPasta(null, null)).toBe("Sem Nome");
    expect(nomeDaPasta("", "123456789")).toBe("Sem Nome (123456789)");
  });
});
