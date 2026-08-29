import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `atualizarSeccaoProcesso` — a edição de dados pelo back-office (BUG3-004).
 *
 * Dois comportamentos fixados aqui:
 *
 *   · `docValidade` em falta no pedido nunca vira "hoje" — fica o que já
 *     estava gravado, ou recusa se não houver nada para cair de volta (a
 *     coluna é `NOT NULL`);
 *   · o evento `processo.dados_atualizados` passa a levar `valorAnterior`
 *     com os campos que mudaram — não só `passo`/`papel`.
 */

type Linha = Record<string, unknown>;

const auditados: { acao: string; valorAnterior?: Linha; valorNovo?: Linha }[] = [];
let linhas: Record<string, Linha[]> = {};
let upserts: { tabela: string; valores: Linha }[] = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "127.0.0.1", "user-agent": "vitest" }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c,
  eq: (...c: unknown[]) => c,
  isNull: (...c: unknown[]) => c,
}));

vi.mock("@/db/schema/organizacao", () => ({
  organizacao: "organizacao",
  contadorReferencia: { organizacaoId: "org_id", ano: "ano", ultimo: "ultimo" },
}));

vi.mock("@/db/schema/processo", () => ({
  processoOnboarding: "processo_onboarding",
  documento: "documento",
}));

vi.mock("@/db/schema/seccoes", () => ({
  dadosIdentificacao: "dados_identificacao",
  dadosFiscais: { processoId: "dados_fiscais" },
  dadosFaturacao: "dados_faturacao",
  fechoProposta: "fecho_proposta",
  representanteLegal: "representante_legal",
  declaracaoPpe: "declaracao_ppe",
  relacaoNegocio: "relacao_negocio",
  preferenciasContacto: "preferencias_contacto",
  nacionalidade: "nacionalidade",
  emailNewsletter: "email_newsletter",
  areaInteresse: "area_interesse",
}));

vi.mock("@/features/auditoria/registar", () => ({
  registarEvento: async (e: { acao: string; valorAnterior?: Linha; valorNovo?: Linha }) => {
    auditados.push(e);
    return { ok: true };
  },
}));

vi.mock("@/lib/sessao", () => ({
  exigirEquipaOuSuperAdmin: async () => ({
    eu: { id: "user-1", papel: "society_admin", organizacaoId: "org-1" },
  }),
  podeAcederSociedade: () => true,
}));

vi.mock("@/features/onboarding/dados", () => ({
  acessoPorToken: async () => ({ estado: "desconhecido" }),
}));

/**
 * A única tabela que estes testes escrevem de facto é `dados_fiscais` — a
 * chave de despacho é o `String(t)`, que para essa tabela é `"[object
 * Object]"` (o mock de `dadosFiscais` é um objeto, para `dadosFiscais.processoId`
 * funcionar em `onConflictDoUpdate`); por isso o registo de linhas por tabela
 * usa uma chave fixa em vez do nome.
 */
vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({
      from: (t: unknown) => ({
        where: () => ({
          limit: async () => linhas[String(t)] ?? [],
        }),
      }),
    }),
    insert: (t: unknown) => ({
      values: (v: Linha) => ({
        onConflictDoUpdate: async ({ set }: { set: Linha }) => {
          upserts.push({ tabela: String(t), valores: set });
          return undefined;
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
  }),
}));

import { atualizarSeccaoProcesso } from "./acoes";

const PROCESSO = (extra: Linha = {}): Linha => ({
  id: "proc-1",
  organizacaoId: "org-1",
  referencia: "JM-2026-0007",
  tipoCliente: "particular",
  estado: "em_revisao",
  nivelRisco: "baixo",
  fatoresRisco: [],
  ...extra,
});

describe("atualizarSeccaoProcesso — passo 2 (dados fiscais)", () => {
  beforeEach(() => {
    auditados.length = 0;
    upserts.length = 0;
    linhas = { processo_onboarding: [PROCESSO()] };
  });

  it("recusa um NIF sem checksum válido (BUG3-004)", async () => {
    linhas["[object Object]"] = [
      { nif: "123456789", docTipo: "cartao_cidadao", docValidade: "2030-01-01" },
    ];

    const r = await atualizarSeccaoProcesso("proc-1", 2, {
      nif: "111111111",
      docTipo: "cartao_cidadao",
      docNumero: "12345678",
      docValidade: "2030-01-01",
    });

    expect(r.ok).toBe(false);
    expect(upserts).toHaveLength(0);
  });

  it("docValidade vazio mantém o valor já gravado, nunca a data de hoje", async () => {
    linhas["[object Object]"] = [
      { nif: "123456789", docTipo: "cartao_cidadao", docValidade: "2030-01-01" },
    ];

    const r = await atualizarSeccaoProcesso("proc-1", 2, {
      nif: "123456789",
      docTipo: "cartao_cidadao",
      docNumero: "12345678",
      docValidade: "",
    });

    expect(r.ok).toBe(true);
    expect(upserts[0]?.valores.docValidade).toBe("2030-01-01");
  });

  it("docValidade vazio sem valor anterior recusa em vez de gravar a data de hoje", async () => {
    linhas["[object Object]"] = [];

    const r = await atualizarSeccaoProcesso("proc-1", 2, {
      nif: "123456789",
      docTipo: "cartao_cidadao",
      docNumero: "12345678",
      docValidade: "",
    });

    expect(r).toEqual({ ok: false, erro: "A validade do documento é obrigatória." });
    expect(upserts).toHaveLength(0);
  });

  it("regista em auditoria só os campos que mudaram, com o valor anterior e o novo", async () => {
    linhas["[object Object]"] = [
      { nif: "123456789", docTipo: "cartao_cidadao", docNumero: "00000000", docValidade: "2030-01-01" },
    ];

    await atualizarSeccaoProcesso("proc-1", 2, {
      nif: "123456789",
      docTipo: "cartao_cidadao",
      docNumero: "99999999",
      docValidade: "2030-01-01",
    });

    const evento = auditados.find((a) => a.acao === "processo.dados_atualizados");
    expect(evento).toBeDefined();
    expect(evento?.valorAnterior).toMatchObject({ docNumero: "00000000" });
    expect(evento?.valorNovo).toMatchObject({ docNumero: "99999999" });
    // Um campo que não mudou (docValidade, igual dos dois lados) não entra no diff.
    expect(evento?.valorAnterior).not.toHaveProperty("docValidade");
    expect(evento?.valorNovo).not.toHaveProperty("docValidade");
  });
});
