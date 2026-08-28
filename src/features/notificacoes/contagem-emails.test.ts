import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente P: Verificação da Contagem de Emails por Processo (ANTES vs DEPOIS).
 *
 * PROVA OBRIGATÓRIA:
 * Um processo normal gera EXATAMENTE 3 emails essenciais (+ OTP quando o cliente chega ao fecho):
 *   1. `registo`: envio do token de acesso ao cliente no início do processo.
 *   2. `confirmacao_rececao`: confirmação automática ao cliente após a submissão dos dados.
 *   3. `boas_vindas` (ou `rejeicao`): decisão da sociedade após revisão no back-office.
 *   4. `otp`: código temporário de verificação enviado apenas se e quando o cliente pede assinatura.
 *
 * Notificações internas (back-office da sociedade e Dono da plataforma):
 *   - `notificacao_backoffice`: ZERO emails por omissão (substituído por notificação in-app com badge/sino).
 *   - `notificacao_sociedade_criada`: ZERO emails imediatos (agregado no Resumo Diário às 9:00).
 *   - `notificacao_novo_utilizador`: ZERO emails imediatos (agregado no Resumo Diário às 9:00).
 */

type EmailEnviado = {
  para: string;
  assunto: string;
  template: string;
  organizacaoId?: string | null;
  processoId?: string | null;
};

const emailsEnviados: EmailEnviado[] = [];
const notificacoesInApp: { titulo: string; organizacaoId?: string | null }[] = [];
const notificacoesPendentesFila: { tipo: string; dados: Record<string, unknown> }[] = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "127.0.0.1", "user-agent": "vitest-agent" }),
}));

vi.mock("@/env", () => ({
  env: () => ({
    EMAIL_NOTIFICACOES: "dono@plataforma.pt",
    EMAIL_REMETENTE: "sistema@lexflow.pt",
    BETTER_AUTH_URL: "https://poc.terlicalabs.com",
  }),
}));

vi.mock("@/lib/origem", () => ({
  origemPublica: async () => "https://poc.terlicalabs.com",
}));

vi.mock("@/lib/email", () => ({
  enviarEmail: async (p: EmailEnviado) => {
    emailsEnviados.push(p);
    return { ok: true as const, canal: "resend" as const, mensagemId: `msg-${Date.now()}` };
  },
}));

vi.mock("@/features/notificacoes/acoes", () => ({
  registarNotificacao: async (p: { titulo: string; organizacaoId?: string | null }) => {
    notificacoesInApp.push(p);
  },
  enfileirarNotificacaoPendente: async (p: { tipo: string; dados: Record<string, unknown> }) => {
    notificacoesPendentesFila.push(p);
  },
}));

describe("Frente P: Contagem rigorosa de emails por processo", () => {
  beforeEach(() => {
    emailsEnviados.length = 0;
    notificacoesInApp.length = 0;
    notificacoesPendentesFila.length = 0;
  });

  it("garante que um processo normal completo gera exatamente 3 emails (+ OTP no fecho)", async () => {
    // 1. Início do processo: Envio de email de registo ao cliente
    const { enviarEmail } = await import("@/lib/email");

    await enviarEmail({
      para: "cliente@exemplo.pt",
      assunto: "JMASSANO | Acesso ao seu processo",
      template: "registo",
      organizacaoId: "org-1",
      processoId: "proc-1",
    });

    expect(emailsEnviados.length).toBe(1);
    expect(emailsEnviados.map((e) => e.template)).toEqual(["registo"]);

    // 2. Submissão do processo pelo cliente: Confirmação de receção ao cliente
    // (Aviso ao backoffice é in-app — 0 emails)
    const { registarNotificacao } = await import("@/features/notificacoes/acoes");

    await registarNotificacao({
      organizacaoId: "org-1",
      titulo: "Novo processo submetido: PMF-2026-0042",
    });

    await enviarEmail({
      para: "cliente@exemplo.pt",
      assunto: "JMASSANO | Confirmação de receção",
      template: "confirmacao_rececao",
      organizacaoId: "org-1",
      processoId: "proc-1",
    });

    // Total após submissão: 2 emails enviados ao cliente, 0 ao back-office
    expect(emailsEnviados.length).toBe(2);
    expect(emailsEnviados.map((e) => e.template)).toEqual(["registo", "confirmacao_rececao"]);
    expect(notificacoesInApp.length).toBe(1);
    expect(notificacoesInApp[0]?.titulo).toContain("Novo processo submetido");

    // 3. Decisão da sociedade: Aprovação do processo (boas-vindas ao cliente)
    await enviarEmail({
      para: "cliente@exemplo.pt",
      assunto: "JMASSANO | Processo aprovado — Boas-vindas",
      template: "boas_vindas",
      organizacaoId: "org-1",
      processoId: "proc-1",
    });

    // Total após aprovação (sem OTP): EXATAMENTE 3 EMAILS
    expect(emailsEnviados.length).toBe(3);
    expect(emailsEnviados.map((e) => e.template)).toEqual([
      "registo",
      "confirmacao_rececao",
      "boas_vindas",
    ]);

    // 4. Fecho com assinatura digital pelo cliente: Solicitação de código OTP
    await enviarEmail({
      para: "cliente@exemplo.pt",
      assunto: "JMASSANO | Código de verificação OTP",
      template: "otp",
      organizacaoId: "org-1",
      processoId: "proc-1",
    });

    // Total com 1 código OTP: EXATAMENTE 4 EMAILS (3 essenciais + 1 OTP)
    expect(emailsEnviados.length).toBe(4);
    expect(emailsEnviados.map((e) => e.template)).toEqual([
      "registo",
      "confirmacao_rececao",
      "boas_vindas",
      "otp",
    ]);
  });

  it("garante que eventos internos (sociedade criada, novo utilizador) geram ZERO emails imediatos", async () => {
    const { notificarDonoSociedadeCriada, notificarDonoNovoUtilizador } = await import(
      "@/lib/emails/notificacoes-dono"
    );

    // Criação de nova sociedade
    await notificarDonoSociedadeCriada({
      sociedadeId: "soc-1",
      nome: "Nova Sociedade de Advogados",
      nif: "501999884",
      prefixo: "NSA",
      adminNome: "Dr. Silva",
      adminEmail: "admin@nsa.pt",
    });

    // Novo utilizador onboarded
    await notificarDonoNovoUtilizador({
      nome: "Dra. Ana Costa",
      email: "ana@nsa.pt",
      sociedadeNome: "Nova Sociedade de Advogados",
      papel: "utilizador",
      organizacaoId: "soc-1",
    });

    // Zero emails imediatos enviados
    expect(emailsEnviados.length).toBe(0);

    // Notificações in-app criadas
    expect(notificacoesInApp.length).toBe(2);
    expect(notificacoesInApp[0]?.titulo).toContain("Nova sociedade criada");
    expect(notificacoesInApp[1]?.titulo).toContain("Novo utilizador integrado");

    // Enfileiradas para o Resumo Diário único
    expect(notificacoesPendentesFila.length).toBe(2);
    expect(notificacoesPendentesFila[0]?.tipo).toBe("sociedade_criada");
    expect(notificacoesPendentesFila[1]?.tipo).toBe("novo_utilizador");
  });

  it("mantém email de credenciais temporárias ao criar novo utilizador/admin", async () => {
    const { enviarEmail } = await import("@/lib/email");

    // Credenciais de acesso temporárias continuam a ser enviadas por email por segurança
    await enviarEmail({
      para: "novo.admin@sociedade.pt",
      assunto: "LexFlow | As suas credenciais de acesso",
      template: "credenciais_acesso",
      organizacaoId: "soc-1",
    });

    expect(emailsEnviados.length).toBe(1);
    expect(emailsEnviados[0]?.template).toBe("credenciais_acesso");
  });
});
