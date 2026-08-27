import { beforeEach, describe, expect, it, vi } from "vitest";

type Linha = Record<string, unknown>;

const linhasConsentimento: Linha[] = [];
const linhasVersao: Linha[] = [
  {
    id: "texto-1",
    chave: "rgpd.newsletter",
    versao: "2026-08-08.1",
    conteudo: "Texto newsletter",
  },
];

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c,
  eq: (col: unknown, val: unknown) => ({ col, val }),
  desc: (col: unknown) => ({ col, desc: true }),
  isNull: (col: unknown) => ({ col, isNull: true }),
}));

vi.mock("@/db/schema/legal", () => ({
  consentimento: {
    id: "col_id",
    processoId: "col_processoId",
    finalidade: "col_finalidade",
    textoLegalId: "col_textoLegalId",
    revogadoEm: "col_revogadoEm",
    aceiteEm: "col_aceiteEm",
  },
  versaoTextoLegal: {
    id: "col_v_id",
    chave: "col_v_chave",
    versao: "col_v_versao",
    vigenteDesde: "col_v_vigenteDesde",
  },
}));

vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({
      from: (t: unknown) => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => {
              if (t && typeof t === "object" && "chave" in t) return [linhasVersao[0]];
              // Procura consentimento ativo (revogadoEm === null)
              return linhasConsentimento.filter((l) => l.revogadoEm === null);
            },
          }),
          limit: async () => {
            if (t && typeof t === "object" && "chave" in t) return [linhasVersao[0]];
            return linhasConsentimento.filter((l) => l.revogadoEm === null);
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: Linha) => {
        linhasConsentimento.push({ id: `c-${linhasConsentimento.length + 1}`, ...v });
        return {
          returning: async () => [v],
          onConflictDoNothing: () => ({ returning: async () => [v] }),
        };
      },
    }),
    update: () => ({
      set: (valores: Linha) => ({
        where: (cond: { col: unknown; val: unknown }) => {
          const alvo = linhasConsentimento.find((l) => l.id === cond.val);
          if (alvo) {
            Object.assign(alvo, valores);
          }
          return Promise.resolve();
        },
      }),
    }),
  }),
}));

import { registarConsentimento } from "./consentimentos";

describe("Consentimentos — Prova e Imutabilidade de Revogação", () => {
  beforeEach(() => {
    linhasConsentimento.length = 0;
  });

  it("concessão -> revogação -> reconcessão preserva a linha revogada e cria nova linha ativa", async () => {
    // 1. Conceder consentimento inicial
    await registarConsentimento({
      processoId: "proc-1",
      finalidade: "newsletter",
      aceite: true,
      ip: "1.1.1.1",
      userAgent: "browser-1",
    });

    expect(linhasConsentimento).toHaveLength(1);
    expect(linhasConsentimento[0]?.aceite).toBe(true);
    expect(linhasConsentimento[0]?.revogadoEm).toBeNull();
    const idOriginal = linhasConsentimento[0]?.id;

    // 2. Revogar consentimento
    await registarConsentimento({
      processoId: "proc-1",
      finalidade: "newsletter",
      aceite: false,
      ip: "1.1.1.2",
      userAgent: "browser-2",
    });

    expect(linhasConsentimento).toHaveLength(1);
    expect(linhasConsentimento[0]?.id).toBe(idOriginal);
    expect(linhasConsentimento[0]?.revogadoEm).toBeInstanceOf(Date);

    // 3. Reconceder consentimento após ter sido revogado
    await registarConsentimento({
      processoId: "proc-1",
      finalidade: "newsletter",
      aceite: true,
      ip: "1.1.1.3",
      userAgent: "browser-3",
    });

    // Ambas as linhas devem existir: a original com revogadoEm intacto (prova legal) e a nova ativa
    expect(linhasConsentimento).toHaveLength(2);

    const linhaRevogada = linhasConsentimento.find((l) => l.id === idOriginal);
    expect(linhaRevogada?.revogadoEm).toBeInstanceOf(Date);

    const linhaNova = linhasConsentimento.find((l) => l.id !== idOriginal);
    expect(linhaNova?.aceite).toBe(true);
    expect(linhaNova?.revogadoEm).toBeNull();
    expect(linhaNova?.ip).toBe("1.1.1.3");
  });
});
