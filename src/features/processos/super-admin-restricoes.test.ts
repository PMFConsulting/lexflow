import { describe, expect, it, vi } from "vitest";
import { podeAprovarProcesso, podeVerPpe, exigirEquipaDaSociedade } from "@/lib/sessao";
import { listarProcessosPlataforma } from "./consultas";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT;${url}`);
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

let sessaoUsuario: Record<string, unknown> | null = null;

vi.mock("@/lib/auth", () => ({
  auth: () => ({
    api: {
      getSession: async () => (sessaoUsuario ? { user: { id: "auth-1" } } : null),
    },
  }),
}));

vi.mock("@/db", () => {
  return {
    db: () => ({
      select: () => {
        const query: Record<string, unknown> = {};
        query.from = () => query;
        query.leftJoin = () => query;
        query.where = (cond: unknown) => {
          const linhaSessao = sessaoUsuario ? [sessaoUsuario] : [];
          return {
            limit: async () => linhaSessao,
            orderBy: () => ({
              // `sessaoAtual()` faz `await` diretamente sobre o resultado de
              // `.orderBy(...)`, sem `.limit()` — é o `thenable` que o serve.
              then: (resolve: (v: unknown) => unknown) => Promise.resolve(linhaSessao).then(resolve),
              limit: () => ({
                offset: async () => [
                  {
                    id: "proc-1",
                    organizacaoId: "org-1",
                    referencia: "PMF-2026-0001",
                    tipoCliente: "particular",
                    estado: "submetido",
                    passoAtual: 7,
                    submetidoEm: new Date(),
                    atualizadoEm: new Date(),
                    sociedade: "Sociedade Teste",
                    prefixo: "PMF",
                    responsavel: "Dr. Advogado",
                  },
                ],
              }),
            }),
            then: (cb: (v: unknown) => unknown) => Promise.resolve([{ n: 1 }]).then(cb),
          };
        };
        return query;
      },
    }),
  };
});

describe("restrições de super_admin em processos (Frente E)", () => {
  it("super_admin em detalhe de processo (exigirEquipaDaSociedade) = negado e redirecionado para /admin", async () => {
    sessaoUsuario = {
      id: "user-super-1",
      nome: "Super Administrador",
      email: "super@lexflow.pt",
      papel: "super_admin",
      organizacaoId: null,
      aprovadoEm: new Date(),
      ativo: true,
      apagadoEm: null,
    };

    await expect(exigirEquipaDaSociedade()).rejects.toThrow("NEXT_REDIRECT;/admin");
  });

  it("super_admin tem podeVerPpe=false e podeAprovarProcesso=false", () => {
    expect(podeVerPpe("super_admin")).toBe(false);
    expect(podeAprovarProcesso("super_admin")).toBe(false);
  });

  it("listarProcessosPlataforma retorna apenas metadados sem nomeCliente ou nifCliente", async () => {
    const { linhas } = await listarProcessosPlataforma({});
    expect(linhas).toHaveLength(1);
    const item = linhas[0] as Record<string, unknown>;

    expect(item.referencia).toBe("PMF-2026-0001");
    expect(item.sociedade).toBe("Sociedade Teste");
    expect(item.responsavel).toBe("Dr. Advogado");
    expect(item.estado).toBe("submetido");
    expect(item).not.toHaveProperty("nome");
    expect(item).not.toHaveProperty("nif");
  });
});
