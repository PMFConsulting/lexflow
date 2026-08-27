import { describe, expect, it, vi } from "vitest";

let estadoAcesso: "ok" | "expirado" = "ok";
let estadoProcesso: string = "rascunho";
let documentos: Record<string, unknown>[] = [];

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "127.0.0.1", "user-agent": "vitest" }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c,
  eq: (...c: unknown[]) => c,
  isNull: (...c: unknown[]) => c,
}));

vi.mock("@/db/schema/processo", () => ({
  documento: "documento",
}));

vi.mock("@/features/auditoria/registar", () => ({
  registarEvento: async () => ({ ok: true }),
}));

vi.mock("./dados", () => ({
  acessoPorToken: async () => {
    if (estadoAcesso !== "ok") return { estado: "expirado" };
    return {
      estado: "ok",
      processo: {
        id: "proc-1",
        organizacaoId: "org-1",
        referencia: "JM-2026-0001",
        estado: estadoProcesso,
      },
      token: "tok-1",
    };
  },
  motivoDoAcesso: () => ({ titulo: "Link expirado.", descricao: "Peça um novo." }),
}));

vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => documentos,
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          then: (resolve: (v: unknown) => unknown) => Promise.resolve().then(resolve),
        }),
      }),
    }),
  }),
}));

import { removerDocumento } from "./documentos";

describe("removerDocumento — Guardas de Estado", () => {
  it("recusa remoção de documento quando o processo já está submetido", async () => {
    estadoProcesso = "submetido";
    documentos = [{ id: "doc-1", nomeOriginal: "cc.pdf", tipo: "identificacao" }];

    const r = await removerDocumento("tok-1", "doc-1");

    expect(r.ok).toBe(false);
    expect(r.erro).toBe("Este processo já foi submetido.");
  });

  it("recusa remoção de documento quando o processo está em revisão", async () => {
    estadoProcesso = "em_revisao";
    documentos = [{ id: "doc-1", nomeOriginal: "cc.pdf", tipo: "identificacao" }];

    const r = await removerDocumento("tok-1", "doc-1");

    expect(r.ok).toBe(false);
    expect(r.erro).toBe("Este processo já foi submetido.");
  });

  it("permite remoção de documento quando o processo está em rascunho", async () => {
    estadoProcesso = "rascunho";
    documentos = [{ id: "doc-1", nomeOriginal: "cc.pdf", tipo: "identificacao" }];

    const r = await removerDocumento("tok-1", "doc-1");

    expect(r.ok).toBe(true);
  });

  it("permite remoção de documento quando o processo está em pendente_cliente", async () => {
    estadoProcesso = "pendente_cliente";
    documentos = [{ id: "doc-1", nomeOriginal: "cc.pdf", tipo: "identificacao" }];

    const r = await removerDocumento("tok-1", "doc-1");

    expect(r.ok).toBe(true);
  });
});
