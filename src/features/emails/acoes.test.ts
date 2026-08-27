import { beforeEach, describe, expect, it, vi } from "vitest";

type Linha = Record<string, unknown>;

const inseridos: Linha[] = [];
const atualizados: { id: string; valores: Linha }[] = [];
const apagados: string[] = [];
let modelosNaDb: Linha[] = [];
let sessao: { eu: { id: string; email: string; papel: string; organizacaoId: string } } | null = null;
const eventos: { acao: string; organizacaoId: string; valorNovo?: unknown; valorAnterior?: unknown }[] = [];

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c,
  eq: (...c: unknown[]) => c,
}));

vi.mock("@/db/schema/email", () => ({
  emailModelo: {
    id: "id",
    organizacaoId: "organizacaoId",
    template: "template",
  },
}));

vi.mock("@/lib/sessao", () => ({
  exigirSocietyAdmin: async () => {
    if (!sessao || sessao.eu.papel !== "society_admin") {
      throw new Error("Não autorizado");
    }
    return sessao;
  },
}));

vi.mock("@/features/auditoria/registar", () => ({
  registarEvento: async (e: { acao: string; organizacaoId: string; valorNovo?: unknown; valorAnterior?: unknown }) => {
    eventos.push(e);
  },
}));

vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => modelosNaDb,
        }),
      }),
    }),
    insert: () => ({
      values: async (v: Linha) => {
        inseridos.push(v);
        return [v];
      },
    }),
    update: () => ({
      set: (valores: Linha) => ({
        where: async () => {
          atualizados.push({ id: "mod-1", valores });
          return [{ id: "mod-1", ...valores }];
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        apagados.push("mod-1");
        return [{ id: "mod-1" }];
      },
    }),
  }),
}));

const { guardarModeloEmail, reverterModeloEmail } = await import("./acoes");

beforeEach(() => {
  inseridos.length = 0;
  atualizados.length = 0;
  apagados.length = 0;
  eventos.length = 0;
  modelosNaDb = [];
  sessao = {
    eu: { id: "u-admin", email: "admin@pmf.pt", papel: "society_admin", organizacaoId: "org-1" },
  };
});

describe("guardarModeloEmail", () => {
  it("guarda um novo modelo de email e regista evento de auditoria", async () => {
    modelosNaDb = [];

    const res = await guardarModeloEmail({
      template: "confirmacao_rececao",
      assunto: "Recebemos os seus dados {{referencia}}",
      corpoHtml: "<p>Olá {{nome_cliente}}, recebemos os seus dados.</p>",
    });

    expect(res.ok).toBe(true);
    expect(inseridos).toHaveLength(1);
    expect(inseridos[0]).toMatchObject({
      organizacaoId: "org-1",
      template: "confirmacao_rececao",
      assunto: "Recebemos os seus dados {{referencia}}",
      corpoHtml: "<p>Olá {{nome_cliente}}, recebemos os seus dados.</p>",
      atualizadoPor: "u-admin",
    });

    expect(eventos).toHaveLength(1);
    expect(eventos[0].acao).toBe("email_modelo.atualizado");
    expect(eventos[0].organizacaoId).toBe("org-1");
  });

  it("atualiza um modelo existente quando já existe personalização", async () => {
    modelosNaDb = [
      {
        id: "mod-1",
        organizacaoId: "org-1",
        template: "confirmacao_rececao",
        assunto: "Assunto anterior",
        corpoHtml: "<p>Corpo anterior</p>",
      },
    ];

    const res = await guardarModeloEmail({
      template: "confirmacao_rececao",
      assunto: "Assunto atualizado {{referencia}}",
      corpoHtml: "<p>Novo corpo {{nome_cliente}}</p>",
    });

    expect(res.ok).toBe(true);
    expect(atualizados).toHaveLength(1);
    expect(atualizados[0].valores).toMatchObject({
      assunto: "Assunto atualizado {{referencia}}",
      corpoHtml: "<p>Novo corpo {{nome_cliente}}</p>",
      atualizadoPor: "u-admin",
    });

    expect(eventos).toHaveLength(1);
    expect(eventos[0].acao).toBe("email_modelo.atualizado");
    expect(eventos[0].valorAnterior).toEqual({
      assunto: "Assunto anterior",
      corpoHtml: "<p>Corpo anterior</p>",
    });
  });

  it("recusa guardar templates não editáveis ou de segurança", async () => {
    const res = await guardarModeloEmail({
      template: "otp",
      assunto: "Tentativa de mudar OTP",
      corpoHtml: "<p>Código</p>",
    });

    expect(res.ok).toBe(false);
    expect(inseridos).toHaveLength(0);
    expect(atualizados).toHaveLength(0);
  });

  it("valida campos obrigatórios de assunto e corpo", async () => {
    const res = await guardarModeloEmail({
      template: "boas_vindas",
      assunto: "   ",
      corpoHtml: "",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.erros?.assunto).toBeDefined();
      expect(res.erros?.corpoHtml).toBeDefined();
    }
  });

  it("recusa execução se o utilizador não for society_admin", async () => {
    sessao = {
      eu: { id: "u-outro", email: "advogado@pmf.pt", papel: "utilizador", organizacaoId: "org-1" },
    };

    await expect(
      guardarModeloEmail({
        template: "boas_vindas",
        assunto: "Bem-vindo",
        corpoHtml: "<p>Texto</p>",
      }),
    ).rejects.toThrow("Não autorizado");
  });
});

describe("reverterModeloEmail", () => {
  it("elimina o modelo da base de dados e regista auditoria", async () => {
    modelosNaDb = [
      {
        id: "mod-1",
        organizacaoId: "org-1",
        template: "rejeicao",
        assunto: "Assunto personalizado",
        corpoHtml: "<p>Corpo personalizado</p>",
      },
    ];

    const res = await reverterModeloEmail({ template: "rejeicao" });

    expect(res.ok).toBe(true);
    expect(apagados).toContain("mod-1");
    expect(eventos).toHaveLength(1);
    expect(eventos[0].acao).toBe("email_modelo.revertido");
  });

  it("suporta reversão quando o modelo já estava em padrão", async () => {
    modelosNaDb = [];

    const res = await reverterModeloEmail({ template: "rejeicao" });

    expect(res.ok).toBe(true);
    expect(apagados).toHaveLength(0);
  });

  it("recusa reverter templates inválidos", async () => {
    const res = await reverterModeloEmail({ template: "credenciais_acesso" });

    expect(res.ok).toBe(false);
  });
});
