import { describe, expect, it, vi } from "vitest";

/**
 * BUG3-011: "Configuração" fundiu-se em "A minha conta" (`/advogado`) e
 * "Administração" (`/gestao`) — não sobrou nada de próprio nesta página.
 * O que fica é o redirecionamento: um marcador ou link antigo continua a
 * abrir nalgum lado, nunca 404.
 */
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`NEXT_REDIRECT;${destino}`);
  },
}));

describe("/configuracao", () => {
  it("redireciona para /gestao em vez de dar 404", async () => {
    const { default: Configuracao } = await import("./page");
    expect(() => Configuracao()).toThrow("NEXT_REDIRECT;/gestao");
  });
});
