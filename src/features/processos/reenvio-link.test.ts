import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { podeReenviarLinkProcesso } from "@/lib/sessao";

/**
 * BUG3-005: a sociedade não conseguia reenviar o link de acesso quando o
 * cliente o perdia (expira ao fim de 30 dias, ou esgota a quota de OTP) — a
 * única saída era criar um processo novo, perdendo referência e histórico.
 *
 * `reenviarLinkProcesso` gera um token novo — não é possível reutilizar o
 * gravado, porque só o SHA-256 fica na base de dados (D4) — mas, ao
 * contrário de `reabrirProcesso`, **não muda o estado do processo**: reenviar
 * um link não é reabrir um dossier fechado.
 */

type Linha = Record<string, unknown>;

const auditados: { acao: string; valorAnterior?: Linha; valorNovo?: Linha }[] = [];
const enviados: { para: string; template: string; html: string; assunto: string }[] = [];
const atualizacoes: { tabela: string; valores: Linha }[] = [];

let linhas: Record<string, Linha[]> = {};
let papelAtual = "society_admin";
let emailReenvioRebenta = false;
/** TOCTOU: outro pedido já decidiu o processo entre o SELECT e o UPDATE. */
let updateNaoAfetaLinhas = false;

const PROCESSO = (extra: Linha = {}): Linha => ({
  id: "proc-1",
  organizacaoId: "org-1",
  referencia: "JM-2026-0009",
  tipoCliente: "particular",
  estado: "pendente_cliente",
  nomeCliente: null,
  emailCliente: null,
  ...extra,
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "1.2.3.4", "user-agent": "vitest" }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c,
  eq: (...c: unknown[]) => c,
  sql: (...c: unknown[]) => c,
  isNull: (...c: unknown[]) => c,
}));

vi.mock("@/db/schema/organizacao", () => ({
  organizacao: "organizacao",
  contadorReferencia: { organizacaoId: "org_id", ano: "ano", ultimo: "ultimo" },
}));

vi.mock("@/db/schema/processo", () => ({ processoOnboarding: "processo_onboarding" }));

vi.mock("@/db/schema/seccoes", () => ({
  dadosIdentificacao: "dados_identificacao",
  dadosFaturacao: "dados_faturacao",
}));

vi.mock("@/db", () => {
  const esperavel = <T extends object>(extra: T) => ({
    ...extra,
    then: (aceitar: (v: unknown) => unknown) => Promise.resolve(undefined).then(aceitar),
  });

  return {
    db: () => ({
      select: () => ({
        from: (t: unknown) => ({
          where: () => ({
            limit: async () => linhas[String(t)] ?? [],
          }),
        }),
      }),
      update: (t: unknown) => ({
        set: (v: Linha) => ({
          where: () => {
            if (updateNaoAfetaLinhas) {
              return esperavel({ returning: async () => [] });
            }
            atualizacoes.push({ tabela: String(t), valores: v });
            return esperavel({
              returning: async () => [{ ...(linhas[String(t)]?.[0] ?? {}), ...v }],
            });
          },
        }),
      }),
    }),
  };
});

vi.mock("@/features/onboarding/dados", () => ({
  acessoPorToken: async () => ({ estado: "desconhecido" }),
}));

vi.mock("@/features/auditoria/registar", () => ({
  registarEvento: async (e: { acao: string; valorAnterior?: Linha; valorNovo?: Linha }) => {
    auditados.push(e);
  },
}));

vi.mock("@/lib/email", () => ({
  enviarEmail: async (p: { para: string; template: string; html: string; assunto: string }) => {
    if (emailReenvioRebenta) throw new Error("o canal de email rebentou");
    enviados.push(p);
    return { ok: true, canal: "resend", mensagemId: null };
  },
}));

vi.mock("@/lib/emails/jmassano", () => ({
  ASSUNTO_REGISTO: "LexFlow | Registro",
  emailRegisto: ({ link }: { link: string }) => `<a href="${link}">link</a>`,
  ASSUNTO_REJEICAO: "LexFlow | Feedback Registro",
  emailRejeicao: () => "<p>rejeição</p>",
}));

vi.mock("@/lib/origem", () => ({ origemPublica: async () => "https://poc.terlicalabs.com" }));

vi.mock("@/lib/token", () => ({
  novoTokenAcesso: () => ({ token: "token-reenviado-123", hash: "sha256-do-token-reenviado" }),
  expiraDaquiA: () => new Date("2027-01-01T00:00:00.000Z"),
}));

vi.mock("@/lib/sessao", () => ({
  exigirEquipaDaSociedade: async () => ({
    eu: { id: "user-1", papel: papelAtual, organizacaoId: "org-1" },
  }),
  exigirEquipaOuSuperAdmin: async () => ({
    eu: { id: "user-1", papel: papelAtual, organizacaoId: papelAtual === "super_admin" ? null : "org-1" },
  }),
  podeAcederSociedade: (eu: { papel: string; organizacaoId: string | null }, orgAlvo: string) =>
    eu.papel === "super_admin" || eu.organizacaoId === orgAlvo,
  podeAprovarProcesso: (papel: string) =>
    papel === "society_admin" || papel === "gestor" || papel === "utilizador",
  podeReabrirProcesso: (papel: string) =>
    papel === "society_admin" || papel === "gestor" || papel === "super_admin",
  podeReenviarLinkProcesso: (papel: string) => papel === "society_admin" || papel === "super_admin",
}));

const { reenviarLinkProcesso } = await import("./acoes");

beforeEach(() => {
  auditados.length = 0;
  enviados.length = 0;
  atualizacoes.length = 0;
  linhas = {
    processo_onboarding: [PROCESSO()],
    organizacao: [{ id: "org-1", nome: "Sociedade Teste" }],
    dados_identificacao: [{ email: "cliente@exemplo.pt", nome: "Cliente Teste" }],
  };
  papelAtual = "society_admin";
  emailReenvioRebenta = false;
  updateNaoAfetaLinhas = false;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reenviarLinkProcesso", () => {
  it.each(["rascunho", "pendente_cliente", "em_revisao"])(
    "reenvia o link no estado '%s' — grava novo token, NÃO muda o estado, audita e envia email",
    async (estado) => {
      linhas["processo_onboarding"] = [PROCESSO({ estado })];

      const r = await reenviarLinkProcesso("proc-1");

      expect(r).toEqual({ ok: true });
      expect(atualizacoes).toContainEqual({
        tabela: "processo_onboarding",
        valores: expect.objectContaining({
          tokenAcessoHash: "sha256-do-token-reenviado",
          apagadoEm: null,
        }),
      });
      // O estado não faz parte do que se escreve — ao contrário da
      // reabertura, o reenvio não transita o processo de estado nenhum.
      expect(atualizacoes[0].valores.estado).toBeUndefined();

      expect(auditados).toContainEqual(
        expect.objectContaining({
          acao: "processo.link_reenviado",
          valorAnterior: { estado },
          valorNovo: { estado },
        }),
      );

      expect(enviados).toHaveLength(1);
      expect(enviados[0]).toEqual(
        expect.objectContaining({
          para: "cliente@exemplo.pt",
          template: "registo",
          assunto: "LexFlow | Registro",
        }),
      );
    },
  );

  it("NÃO reenvia um processo aprovado — imutabilidade definitiva", async () => {
    linhas["processo_onboarding"] = [PROCESSO({ estado: "aprovado" })];

    const r = await reenviarLinkProcesso("proc-1");

    expect(r).toEqual({
      ok: false,
      erro: "Processo aprovado — já não pode ser alterado.",
    });
    expect(atualizacoes).toHaveLength(0);
    expect(auditados).toHaveLength(0);
    expect(enviados).toHaveLength(0);
  });

  it.each(["submetido", "aguardar_aprovacao", "rejeitado", "arquivado"])(
    "bloqueia o reenvio no estado '%s' — não é um estado editável",
    async (estado) => {
      linhas["processo_onboarding"] = [PROCESSO({ estado })];

      const r = await reenviarLinkProcesso("proc-1");

      expect(r).toEqual({
        ok: false,
        erro:
          "Só é possível reenviar o link de processos em rascunho, pendentes do cliente ou em revisão.",
      });
      expect(atualizacoes).toHaveLength(0);
      expect(auditados).toHaveLength(0);
      expect(enviados).toHaveLength(0);
    },
  );

  it("RBAC: utilizador regular é bloqueado com erro de permissão", async () => {
    papelAtual = "utilizador";

    const r = await reenviarLinkProcesso("proc-1");

    expect(r).toEqual({
      ok: false,
      erro: "Não tem permissão para reenviar o link deste processo.",
    });
    expect(atualizacoes).toHaveLength(0);
  });

  it("RBAC: gestor NÃO pode reenviar — mais restrito do que a reabertura", async () => {
    papelAtual = "gestor";

    const r = await reenviarLinkProcesso("proc-1");

    expect(r).toEqual({
      ok: false,
      erro: "Não tem permissão para reenviar o link deste processo.",
    });
    expect(atualizacoes).toHaveLength(0);
  });

  it("RBAC: super_admin tem permissão transversal", async () => {
    papelAtual = "super_admin";

    const r = await reenviarLinkProcesso("proc-1");

    expect(r).toEqual({ ok: true });
    expect(atualizacoes.length).toBeGreaterThan(0);
  });

  it("bloqueia acesso a processo de outra sociedade", async () => {
    papelAtual = "society_admin";
    linhas["processo_onboarding"] = [PROCESSO({ organizacaoId: "outra-sociedade" })];

    const r = await reenviarLinkProcesso("proc-1");

    expect(r).toEqual({ ok: false, erro: "Processo não encontrado." });
    expect(atualizacoes).toHaveLength(0);
  });

  it("reenvia na mesma quando o processo não tem endereço de email", async () => {
    linhas["dados_identificacao"] = [];
    linhas["dados_faturacao"] = [];

    const r = await reenviarLinkProcesso("proc-1");

    expect(r).toEqual({ ok: true });
    expect(enviados).toHaveLength(0);
    expect(atualizacoes.length).toBeGreaterThan(0);
  });

  it("cai para o email de abertura do processo quando não há dados de identificação", async () => {
    linhas["dados_identificacao"] = [];
    linhas["dados_faturacao"] = [];
    linhas["processo_onboarding"] = [PROCESSO({ emailCliente: "abertura@exemplo.pt" })];

    const r = await reenviarLinkProcesso("proc-1");

    expect(r).toEqual({ ok: true });
    expect(enviados).toHaveLength(1);
    expect(enviados[0].para).toBe("abertura@exemplo.pt");
  });

  it("uma falha no envio de email não impede o reenvio (o token já ficou gravado)", async () => {
    emailReenvioRebenta = true;

    const r = await reenviarLinkProcesso("proc-1");

    expect(r).toEqual({ ok: true });
    expect(atualizacoes.length).toBeGreaterThan(0);
    expect(auditados).toContainEqual(
      expect.objectContaining({ acao: "processo.link_reenviado" }),
    );
  });

  it("TOCTOU: se o estado mudou entre o SELECT e o UPDATE, recusa em vez de reenviar sobre dados obsoletos", async () => {
    updateNaoAfetaLinhas = true;

    const r = await reenviarLinkProcesso("proc-1");

    expect(r).toEqual({ ok: false, erro: "O processo já mudou de estado — recarregue a página." });
    expect(auditados).toHaveLength(0);
    expect(enviados).toHaveLength(0);
  });
});

describe("regras de RBAC para reenvio de link (podeReenviarLinkProcesso)", () => {
  it("apenas society_admin e super_admin podem reenviar — mais restrito do que a reabertura", () => {
    expect(podeReenviarLinkProcesso("society_admin")).toBe(true);
    expect(podeReenviarLinkProcesso("super_admin")).toBe(true);
    expect(podeReenviarLinkProcesso("gestor")).toBe(false);
    expect(podeReenviarLinkProcesso("utilizador")).toBe(false);
  });
});
