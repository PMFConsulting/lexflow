import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { podeReabrirProcesso } from "@/lib/sessao";

type Linha = Record<string, unknown>;

const auditados: { acao: string; valorAnterior?: Linha; valorNovo?: Linha }[] = [];
const enviados: { para: string; template: string; html: string; assunto: string }[] = [];
const atualizacoes: { tabela: string; valores: Linha }[] = [];

let linhas: Record<string, Linha[]> = {};
let papelAtual = "society_admin";
let emailReaberturaRebenta = false;

const PROCESSO = (extra: Linha = {}): Linha => ({
  id: "proc-1",
  organizacaoId: "org-1",
  referencia: "JM-2026-0007",
  tipoCliente: "particular",
  estado: "rejeitado",
  motivoRejeicao: "Documentos em falta",
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
    if (emailReaberturaRebenta) throw new Error("o canal de email rebentou");
    enviados.push(p);
    return { ok: true, canal: "resend", mensagemId: null };
  },
}));

vi.mock("@/lib/emails/jmassano", () => ({
  ASSUNTO_REGISTO: "JMASSANO | Registro",
  emailRegisto: ({ link }: { link: string }) => `<a href="${link}">link</a>`,
  ASSUNTO_REJEICAO: "JMASSANO | Feedback Registro",
  emailRejeicao: () => "<p>rejeição</p>",
  ASSUNTO_REABERTURA: "JMASSANO | Reabertura do Processo",
  emailReabertura: () => "<p>reabertura</p>",
}));

vi.mock("@/lib/origem", () => ({ origemPublica: async () => "https://poc.terlicalabs.com" }));

vi.mock("@/lib/token", () => ({
  novoTokenAcesso: () => ({ token: "token-reaberto-123", hash: "sha256-do-token-reaberto" }),
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
}));

const { reabrirProcesso } = await import("./acoes");

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
  emailReaberturaRebenta = false;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reabrirProcesso", () => {
  it("reabre com sucesso um processo rejeitado -> transita para pendente_cliente", async () => {
    linhas["processo_onboarding"] = [PROCESSO({ estado: "rejeitado" })];

    const r = await reabrirProcesso("proc-1", "Por favor atualize o comprovativo de morada.");

    expect(r).toEqual({ ok: true });
    expect(atualizacoes).toContainEqual({
      tabela: "processo_onboarding",
      valores: expect.objectContaining({
        estado: "pendente_cliente",
        tokenAcessoHash: "sha256-do-token-reaberto",
        apagadoEm: null,
      }),
    });
    expect(auditados).toContainEqual(
      expect.objectContaining({
        acao: "reabertura",
        valorAnterior: { estado: "rejeitado" },
        valorNovo: {
          estado: "pendente_cliente",
          motivo: "Por favor atualize o comprovativo de morada.",
        },
      }),
    );
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toEqual(
      expect.objectContaining({
        para: "cliente@exemplo.pt",
        template: "reabertura",
        assunto: "JMASSANO | Reabertura do Processo",
      }),
    );
  });

  it("reabre com sucesso um processo aprovado -> transita para em_revisao", async () => {
    linhas["processo_onboarding"] = [PROCESSO({ estado: "aprovado" })];

    const r = await reabrirProcesso("proc-1", "Necessário retificar dados fiscais.");

    expect(r).toEqual({ ok: true });
    expect(atualizacoes).toContainEqual({
      tabela: "processo_onboarding",
      valores: expect.objectContaining({
        estado: "em_revisao",
        tokenAcessoHash: "sha256-do-token-reaberto",
        apagadoEm: null,
      }),
    });
    expect(auditados).toContainEqual(
      expect.objectContaining({
        acao: "reabertura",
        valorAnterior: { estado: "aprovado" },
        valorNovo: {
          estado: "em_revisao",
          motivo: "Necessário retificar dados fiscais.",
        },
      }),
    );
  });

  it("reabre com sucesso um processo arquivado -> transita para em_revisao", async () => {
    linhas["processo_onboarding"] = [PROCESSO({ estado: "arquivado" })];

    const r = await reabrirProcesso("proc-1", "Retoma do processo arquivado a pedido do cliente.");

    expect(r).toEqual({ ok: true });
    expect(atualizacoes).toContainEqual({
      tabela: "processo_onboarding",
      valores: expect.objectContaining({
        estado: "em_revisao",
        tokenAcessoHash: "sha256-do-token-reaberto",
        apagadoEm: null,
      }),
    });
    expect(auditados).toContainEqual(
      expect.objectContaining({
        acao: "reabertura",
        valorAnterior: { estado: "arquivado" },
        valorNovo: {
          estado: "em_revisao",
          motivo: "Retoma do processo arquivado a pedido do cliente.",
        },
      }),
    );
  });

  it.each([
    "rascunho",
    "submetido",
    "aguardar_aprovacao",
    "em_revisao",
    "pendente_cliente",
  ])("bloqueia reabertura no estado '%s' com mensagem explícita", async (estado) => {
    linhas["processo_onboarding"] = [PROCESSO({ estado })];

    const r = await reabrirProcesso("proc-1", "Motivo válido com mais de 10 caracteres");

    expect(r).toEqual({
      ok: false,
      erro: "Apenas processos aprovados, arquivados ou rejeitados podem ser reabertos.",
    });
    expect(atualizacoes).toHaveLength(0);
    expect(auditados).toHaveLength(0);
    expect(enviados).toHaveLength(0);
  });

  it("recusa motivo vazio ou em branco", async () => {
    linhas["processo_onboarding"] = [PROCESSO({ estado: "rejeitado" })];

    const rVazio = await reabrirProcesso("proc-1", "");
    expect(rVazio).toEqual({
      ok: false,
      erro: "Indique o motivo da reabertura.",
    });

    const rEspacos = await reabrirProcesso("proc-1", "         ");
    expect(rEspacos).toEqual({
      ok: false,
      erro: "Indique o motivo da reabertura.",
    });

    expect(atualizacoes).toHaveLength(0);
  });

  it("recusa motivo com menos de 10 caracteres", async () => {
    linhas["processo_onboarding"] = [PROCESSO({ estado: "rejeitado" })];

    const r = await reabrirProcesso("proc-1", "123456789");
    expect(r).toEqual({
      ok: false,
      erro: "O motivo deve ter pelo menos 10 caracteres.",
    });
    expect(atualizacoes).toHaveLength(0);
  });

  it("RBAC: utilizador regular é bloqueado com erro de permissão", async () => {
    papelAtual = "utilizador";
    linhas["processo_onboarding"] = [PROCESSO({ estado: "rejeitado" })];

    const r = await reabrirProcesso("proc-1", "Motivo válido com mais de 10 caracteres");

    expect(r).toEqual({
      ok: false,
      erro: "Não tem permissão para reabrir este processo.",
    });
    expect(atualizacoes).toHaveLength(0);
    expect(auditados).toHaveLength(0);
  });

  it("RBAC: gestor tem permissão para reabrir processo da sua sociedade", async () => {
    papelAtual = "gestor";
    linhas["processo_onboarding"] = [PROCESSO({ estado: "rejeitado" })];

    const r = await reabrirProcesso("proc-1", "Motivo válido do gestor com mais de 10 chars");

    expect(r).toEqual({ ok: true });
    expect(atualizacoes.length).toBeGreaterThan(0);
  });

  it("RBAC: super_admin tem permissão transversal para reabrir", async () => {
    papelAtual = "super_admin";
    linhas["processo_onboarding"] = [PROCESSO({ estado: "rejeitado" })];

    const r = await reabrirProcesso("proc-1", "Motivo válido do super admin para reabertura");

    expect(r).toEqual({ ok: true });
    expect(atualizacoes.length).toBeGreaterThan(0);
  });

  it("bloqueia acesso a processo de outra sociedade", async () => {
    papelAtual = "society_admin";
    linhas["processo_onboarding"] = [PROCESSO({ organizacaoId: "outra-sociedade", estado: "rejeitado" })];

    const r = await reabrirProcesso("proc-1", "Motivo válido com mais de 10 caracteres");

    expect(r).toEqual({
      ok: false,
      erro: "Processo não encontrado.",
    });
    expect(atualizacoes).toHaveLength(0);
  });

  it("reabre na mesma quando o processo não tem endereço de email", async () => {
    linhas["dados_identificacao"] = [];
    linhas["dados_faturacao"] = [];
    linhas["processo_onboarding"] = [PROCESSO({ estado: "rejeitado" })];

    const r = await reabrirProcesso("proc-1", "Motivo válido sem email com mais de 10 caracteres");

    expect(r).toEqual({ ok: true });
    expect(enviados).toHaveLength(0);
    expect(atualizacoes.some((a) => a.valores.estado === "pendente_cliente")).toBe(true);
  });

  it("uma falha no envio de email não impede a reabertura do processo", async () => {
    linhas["processo_onboarding"] = [PROCESSO({ estado: "rejeitado" })];
    emailReaberturaRebenta = true;

    const r = await reabrirProcesso("proc-1", "Motivo com falha de envio simulada");

    expect(r).toEqual({ ok: true });
    expect(atualizacoes.some((a) => a.valores.estado === "pendente_cliente")).toBe(true);
    expect(auditados).toContainEqual(
      expect.objectContaining({
        acao: "reabertura",
      }),
    );
  });
});

describe("regras de RBAC para reabertura (podeReabrirProcesso)", () => {
  it("apenas society_admin, gestor e super_admin podem reabrir", () => {
    expect(podeReabrirProcesso("society_admin")).toBe(true);
    expect(podeReabrirProcesso("gestor")).toBe(true);
    expect(podeReabrirProcesso("super_admin")).toBe(true);
    expect(podeReabrirProcesso("utilizador")).toBe(false);
    expect(podeReabrirProcesso("desconhecido")).toBe(false);
  });
});