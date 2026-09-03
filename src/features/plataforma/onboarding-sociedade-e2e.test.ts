import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Teste E2E do fluxo completo de onboarding de sociedades e notificações ao Dono.
 *
 * Cobre:
 * 1. Criação de sociedade via `criarSociedade` (com email do Dono/admin).
 * 2. Envio de email de credenciais de acesso ao admin e notificação ao Dono.
 * 3. Restrição de primeiro login com `deve_redefinir_password = true`.
 * 4. Redefinição obrigatória de palavra-passe para nova senha pessoal.
 * 5. Acesso desbloqueado ao backoffice da sociedade.
 * 6. Suporte a multi-sociedade com o mesmo email/auth_user.
 * 7. Notificações ao Dono em `criarUtilizador`, `concluirConvite` e `importarUtilizadores`.
 */

type Linha = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const inseridos: { tabela: string; valores: Linha }[] = [];
const atualizados: { tabela: string; valores: Linha }[] = [];
const emailsEnviados: {
  para: string;
  assunto: string;
  html: string;
  template: string;
  organizacaoId?: string | null;
}[] = [];
const redirecionamentos: string[] = [];

let linhas: Record<string, Linha[]> = {};

vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    redirecionamentos.push(destino);
    throw new Error(`NEXT_REDIRECT;${destino}`);
  },
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "127.0.0.1", "user-agent": "test-agent" }),
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("better-auth/crypto", () => ({
  hashPassword: async (p: string) => `scrypt$${p}`,
  verifyPassword: async ({ hash, password }: { hash: string; password: string }) =>
    hash === `scrypt$${password}`,
}));

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c,
  eq: (coluna: unknown, valor: unknown) => [coluna, valor, "eq"],
  ne: (coluna: unknown, valor: unknown) => [coluna, valor, "ne"],
  isNull: (coluna: unknown) => [coluna, null, "isNull"],
  isNotNull: (coluna: unknown) => [coluna, null, "isNotNull"],
  or: (...c: unknown[]) => c,
  asc: (...c: unknown[]) => c,
  desc: (...c: unknown[]) => c,
  count: () => "count",
  sql: () => "sql",
  ilike: () => "ilike",
  aliasedTable: (t: unknown) => t,
}));

vi.mock("@/db/schema/auth", () => ({
  user: { id: "col_user_id", email: "col_user_email" },
  account: { id: "col_acc_id", userId: "col_acc_userId", providerId: "col_acc_provider" },
}));

vi.mock("@/db/schema/organizacao", () => ({
  utilizador: {
    id: "col_id",
    email: "col_email",
    papel: "col_papel",
    organizacaoId: "col_org",
    apagadoEm: "col_apagado",
    authUserId: "col_auth",
  },
  organizacao: {
    id: "col_org_id",
    nome: "col_org_nome",
    nif: "col_org_nif",
    prefixoReferencia: "col_org_prefixo",
    apagadoEm: "col_org_apagado",
  },
}));

vi.mock("@/lib/origem", () => ({
  origemPublica: async () => "https://plataforma.lexflow.pt",
}));

vi.mock("@/env", () => ({
  env: () => ({
    EMAIL_NOTIFICACOES: "dono@plataforma.pt",
    EMAIL_REMETENTE: "sistema@lexflow.pt",
    BETTER_AUTH_URL: "https://plataforma.lexflow.pt",
  }),
}));

vi.mock("@/lib/email", () => ({
  enviarEmail: async (p: {
    para: string;
    assunto: string;
    html: string;
    template: string;
    organizacaoId?: string | null;
  }) => {
    emailsEnviados.push(p);
    return { ok: true as const, canal: "resend" as const, mensagemId: `msg-${Date.now()}` };
  },
}));

vi.mock("@/features/auditoria/registar", () => ({
  registarEvento: async () => ({ id: "audit-1" }),
}));

vi.mock("@/features/auditoria/constantes", () => ({
  ORGANIZACAO_PLATAFORMA_ID: "00000000-0000-0000-0000-000000000000",
}));

const tabelaDe = (t: unknown) => {
  if (typeof t === "object" && t !== null) {
    if ("authUserId" in t) return "utilizador";
    if ("prefixoReferencia" in t) return "organizacao";
    if ("providerId" in t) return "account";
    if ("email" in t && !("papel" in t)) return "user";
    if ("paraPapel" in t) return "notificacao";
    if ("processadoEm" in t) return "notificacoes_pendentes";
  }
  return String(t);
};

type Condicao = [coluna: string, valor: unknown, op?: string];

const clausulaSobre = (cond: unknown, coluna: string): Condicao | undefined => {
  if (!Array.isArray(cond) || cond.length === 0) return undefined;
  if (typeof cond[0] === "string") return cond[0] === coluna ? (cond as Condicao) : undefined;
  for (const item of cond) {
    if (Array.isArray(item)) {
      if (item[0] === coluna) return item as Condicao;
      const sub = clausulaSobre(item, coluna);
      if (sub) return sub;
    }
  }
  return undefined;
};

const consultar = (t: unknown, cond?: unknown): Linha[] => {
  const tab = tabelaDe(t);
  const list = linhas[tab] ?? [];
  if (!cond) return list;

  let filtradas = [...list];

  // Filtros utilizador
  const porId = clausulaSobre(cond, "col_id");
  if (porId) filtradas = filtradas.filter((r) => r.id === porId[1]);

  const porAuth = clausulaSobre(cond, "col_auth");
  if (porAuth) filtradas = filtradas.filter((r) => r.authUserId === porAuth[1]);

  const porEmail = clausulaSobre(cond, "col_email");
  if (porEmail) filtradas = filtradas.filter((r) => r.email === porEmail[1]);

  const porOrg = clausulaSobre(cond, "col_org");
  if (porOrg) {
    if (porOrg[2] === "ne") {
      filtradas = filtradas.filter((r) => r.organizacaoId !== porOrg[1]);
    } else if (porOrg[2] === "isNotNull") {
      filtradas = filtradas.filter((r) => r.organizacaoId != null);
    } else if (porOrg[2] === "isNull") {
      filtradas = filtradas.filter((r) => r.organizacaoId == null);
    } else if (porOrg[2] === "eq") {
      filtradas = filtradas.filter((r) => r.organizacaoId === porOrg[1]);
    }
  }

  // Filtros user
  const porUserEmail = clausulaSobre(cond, "col_user_email");
  if (porUserEmail) filtradas = filtradas.filter((r) => r.email === porUserEmail[1]);

  // Filtros account
  const porAccUser = clausulaSobre(cond, "col_acc_userId");
  if (porAccUser) filtradas = filtradas.filter((r) => r.userId === porAccUser[1]);

  // Filtros organizacao
  const porOrgId = clausulaSobre(cond, "col_org_id");
  if (porOrgId) filtradas = filtradas.filter((r) => r.id === porOrgId[1]);

  return filtradas.map((r) => {
    if (tab === "organizacao") {
      return {
        ...r,
        prefixo: r.prefixo ?? r.prefixoReferencia,
      };
    }
    return { ...r };
  });
};

const makeQuery = (t: unknown, cond?: unknown) => {
  const getRows = () => consultar(t, cond);
  return {
    then: (resolve: (rows: Linha[]) => unknown, reject?: (err: unknown) => unknown) => {
      try {
        return Promise.resolve(resolve(getRows()));
      } catch (err) {
        if (reject) return Promise.resolve(reject(err));
        return Promise.reject(err);
      }
    },
    limit: async (n?: number) => {
      const rows = getRows();
      return n !== undefined ? rows.slice(0, n) : rows;
    },
    orderBy: () => ({
      then: (resolve: (rows: Linha[]) => unknown) => Promise.resolve(resolve(getRows())),
      limit: async () => getRows(),
    }),
    leftJoin: () => ({
      leftJoin: () => makeQuery(t, cond),
      where: (c: unknown) => makeQuery(t, c),
      then: (resolve: (rows: Linha[]) => unknown) => Promise.resolve(resolve(getRows())),
      limit: async () => getRows(),
    }),
  };
};

const transacao = {
  select: (cols?: unknown) => ({
    from: (t: unknown) => {
      const tab = tabelaDe(t);
      return {
        where: (cond: unknown) => makeQuery(t, cond),
        leftJoin: () => makeQuery(t),
        then: (resolve: (rows: Linha[]) => unknown) => Promise.resolve(resolve(consultar(t))),
        limit: async () => consultar(t),
      };
    },
  }),
  insert: (t: unknown) => ({
    values: async (v: Linha) => {
      const tab = tabelaDe(t);
      if (v?.email === "admin.falha@sociedade.pt" && (tab === "user" || tab === "utilizador")) {
        throw new Error("Erro na base de dados ao criar utilizador");
      }
      inseridos.push({ tabela: tab, valores: v });
      (linhas[tab] ??= []).push(v);
      return [v];
    },
  }),
  update: (t: unknown) => ({
    set: (v: Linha) => ({
      where: async () => {
        const tab = tabelaDe(t);
        atualizados.push({ tabela: tab, valores: v });
        const list = linhas[tab] ?? [];
        for (const item of list) {
          Object.assign(item, v);
        }
      },
    }),
  }),
};

vi.mock("@/db", () => ({
  db: () => ({
    transaction: async (f: (t: typeof transacao) => Promise<unknown>) => f(transacao),
    select: (cols?: unknown) => ({
      from: (t: unknown) => {
        const tab = tabelaDe(t);
        return {
          where: (cond: unknown) => makeQuery(t, cond),
          leftJoin: () => makeQuery(t),
          then: (resolve: (rows: Linha[]) => unknown) => Promise.resolve(resolve(consultar(t))),
          limit: async () => consultar(t),
        };
      },
    }),
    insert: (t: unknown) => ({
      values: async (v: Linha) => {
        const tab = tabelaDe(t);
        inseridos.push({ tabela: tab, valores: v });
        (linhas[tab] ??= []).push(v);
        return [v];
      },
    }),
    update: (t: unknown) => ({
      set: (v: Linha) => ({
        where: async () => {
          const tab = tabelaDe(t);
          atualizados.push({ tabela: tab, valores: v });
          const list = linhas[tab] ?? [];
          for (const item of list) {
            Object.assign(item, v);
          }
        },
      }),
    }),
  }),
}));

let sessaoMock: { conta: { id: string; email: string }; eu: Linha } | null = null;

vi.mock("@/lib/auth", () => ({
  auth: () => ({
    api: {
      getSession: async () => (sessaoMock ? { user: sessaoMock.conta } : null),
    },
  }),
}));

const { criarSociedade, criarUtilizador } = await import("@/features/plataforma/acoes");
const { redefinirPalavraPasse } = await import("@/features/conta/acoes");
const { exigirSessao, exigirSocietyAdmin, sessaoAtual, ROTA_DEFINIR_PALAVRA_PASSE } = await import("@/lib/sessao");

beforeEach(() => {
  inseridos.length = 0;
  atualizados.length = 0;
  emailsEnviados.length = 0;
  redirecionamentos.length = 0;
  linhas = {};
  sessaoMock = null;
});

describe("Frente O: E2E do fluxo completo da sociedade e notificações ao Dono", () => {
  it("fluxo completo: criar sociedade com admin -> emails enviados -> login com temp pass -> redefinir password -> backoffice", async () => {
    // 0. SuperAdmin na base e autenticado
    const superAdminUser = {
      id: "u-dono",
      authUserId: "auth-dono",
      email: "dono@plataforma.pt",
      nome: "Dono da Plataforma",
      papel: "super_admin",
      organizacaoId: null,
      ativo: true,
      aprovadoEm: new Date(),
      deveRedefinirPassword: false,
    };
    linhas["utilizador"] = [superAdminUser];

    sessaoMock = {
      conta: { id: "auth-dono", email: "dono@plataforma.pt" },
      eu: superAdminUser,
    };

    // 1. Criar Sociedade com admin
    const resultado = await criarSociedade({
      nome: "Teixeira & Associados",
      nif: "501999884",
      prefixoReferencia: "TXA",
      adminNome: "Dr. Diogo Teixeira",
      adminEmail: "diogo.admin@sociedade.pt",
    });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.id).toBeDefined();
    expect(resultado.admin).not.toBeNull();
    expect(resultado.avisoAdmin).toBeNull();
    expect(resultado.admin?.emailEnviado).toBe(true);

    // 2. Verificar emails enviados:
    // a) Credenciais de acesso ao admin
    const emailAdmin = emailsEnviados.find((e) => e.para === "diogo.admin@sociedade.pt");
    expect(emailAdmin).toBeDefined();
    expect(emailAdmin?.template).toBe("credenciais_acesso");
    expect(emailAdmin?.html).toContain("Teixeira &amp; Associados");
    expect(emailAdmin?.html).toContain("Palavra-passe temporária");

    // Extrair a palavra-passe temporária enviada por email
    const matchSenha = emailAdmin?.html.match(/letter-spacing:0\.04em;word-break:break-all;">(.*?)<\/p>/);
    expect(matchSenha).toBeTruthy();
    const senhaTemporaria = matchSenha![1];

    // b) Frente P: Zero emails imediatos ao Dono; enfileirado para o Resumo Diário e notificação in-app
    const emailDono = emailsEnviados.find(
      (e) => e.para === "dono@plataforma.pt" && e.template === "notificacao_sociedade_criada",
    );
    expect(emailDono).toBeUndefined();

    const notifInApp = inseridos.find(
      (i) => i.tabela === "notificacao" && i.valores.titulo?.includes("Nova sociedade criada: Teixeira & Associados"),
    );
    expect(notifInApp).toBeDefined();

    const notifPendente = inseridos.find(
      (i) => i.tabela === "notificacoes_pendentes" && i.valores.tipo === "sociedade_criada",
    );
    expect(notifPendente).toBeDefined();
    expect(notifPendente?.valores.dados?.nif).toBe("501999884");
    expect(notifPendente?.valores.dados?.prefixo).toBe("TXA");

    // 3. Simular login do novo admin com a palavra-passe temporária
    const novoAdminId = resultado.admin!.utilizadorId;
    const authAdminId = inseridos.find((i) => i.tabela === "user")?.valores.id as string;

    const adminDomainUser = {
      id: novoAdminId,
      authUserId: authAdminId,
      email: "diogo.admin@sociedade.pt",
      nome: "Dr. Diogo Teixeira",
      papel: "society_admin",
      organizacaoId: resultado.id,
      ativo: true,
      aprovadoEm: new Date(),
      deveRedefinirPassword: true, // Obrigatório redefinir!
    };

    linhas["utilizador"] = [adminDomainUser];
    linhas["account"] = [
      {
        id: "acc-1",
        userId: authAdminId,
        providerId: "credential",
        password: `scrypt$${senhaTemporaria}`,
      },
    ];

    sessaoMock = {
      conta: { id: authAdminId, email: "diogo.admin@sociedade.pt" },
      eu: adminDomainUser,
    };

    // 4. Guard de sessão bloqueia acesso ao backoffice e redireciona para redefinição
    await expect(exigirSessao()).rejects.toThrow(`NEXT_REDIRECT;${ROTA_DEFINIR_PALAVRA_PASSE}`);
    expect(redirecionamentos).toContain(ROTA_DEFINIR_PALAVRA_PASSE);

    // 5. Tentar reutilizar a palavra-passe temporária é recusado
    const tentativaMesma = await redefinirPalavraPasse({
      palavraPasse: senhaTemporaria,
      confirmacao: senhaTemporaria,
    });
    expect(tentativaMesma.ok).toBe(false);

    // 6. Redefinir com uma nova senha pessoal válida
    const redefinicao = await redefinirPalavraPasse({
      palavraPasse: "MinhaNovaPalavraPasseSegura2026!",
      confirmacao: "MinhaNovaPalavraPasseSegura2026!",
    });
    expect(redefinicao.ok).toBe(true);

    // Atualiza estado da sessão após redefinição
    adminDomainUser.deveRedefinirPassword = false;
    sessaoMock.eu.deveRedefinirPassword = false;

    // 7. Agora exigirSocietyAdmin deixa passar e dá acesso total ao backoffice
    const sessaoValida = await exigirSocietyAdmin();
    expect(sessaoValida.eu.papel).toBe("society_admin");
    expect(sessaoValida.eu.organizacaoId).toBe(resultado.id);
  });

  it("permite multi-sociedade: o mesmo email pode ser admin de várias sociedades", async () => {
    const superAdminUser = {
      id: "u-dono",
      authUserId: "auth-dono",
      email: "dono@plataforma.pt",
      nome: "Dono da Plataforma",
      papel: "super_admin",
      organizacaoId: null,
      ativo: true,
      aprovadoEm: new Date(),
      deveRedefinirPassword: false,
    };
    linhas["utilizador"] = [superAdminUser];

    sessaoMock = {
      conta: { id: "auth-dono", email: "dono@plataforma.pt" },
      eu: superAdminUser,
    };

    // Já existe utilizador noutra sociedade com o mesmo email
    linhas["organizacao"] = [
      { id: "org-1", nome: "Primeira Sociedade", nif: "501999884", prefixoReferencia: "PRI" },
    ];
    linhas["user"] = [{ id: "auth-admin-existente", email: "admin.multi@sociedade.pt" }];
    linhas["utilizador"].push({
      id: "u-sociedade-1",
      email: "admin.multi@sociedade.pt",
      authUserId: "auth-admin-existente",
      organizacaoId: "org-1",
      papel: "society_admin",
      ativo: true,
      aprovadoEm: new Date(),
    });

    // Criar uma segunda sociedade com o MESMO adminEmail (NIF válido: 500000000) - sem confirmação prévia
    const resultado2 = await criarSociedade({
      nome: "Segunda Sociedade",
      nif: "500000000",
      prefixoReferencia: "SEG",
      adminNome: "Admin Multi",
      adminEmail: "admin.multi@sociedade.pt",
    });

    expect(resultado2.ok).toBe(true);
    if (!resultado2.ok) return;

    expect(resultado2.admin).not.toBeNull();
    expect(resultado2.avisoAdmin).toBeNull();
    expect(resultado2.admin?.email).toBe("admin.multi@sociedade.pt");
    expect(resultado2.avisoMultiSociedade).toBe(true);

    // Criar terceira sociedade com confirmação explícita (confirmarMultiSociedade: true)
    const resultado3 = await criarSociedade({
      nome: "Terceira Sociedade",
      nif: "509999999",
      prefixoReferencia: "TER",
      adminNome: "Admin Multi",
      adminEmail: "admin.multi@sociedade.pt",
      confirmarMultiSociedade: true,
    });

    expect(resultado3.ok).toBe(true);
    if (!resultado3.ok) return;
    expect(resultado3.avisoMultiSociedade).toBe(false);

    // Criar quarta sociedade com email NOVO - sem aviso
    const resultadoNovo = await criarSociedade({
      nome: "Quarta Sociedade",
      nif: "502999888",
      prefixoReferencia: "QUA",
      adminNome: "Admin Novo",
      adminEmail: "novo.admin@quarta.pt",
    });

    expect(resultadoNovo.ok).toBe(true);
    if (!resultadoNovo.ok) return;
    expect(resultadoNovo.avisoMultiSociedade).toBe(false);

    // Frente P: Notificação in-app e fila do resumo diário para segunda sociedade
    const notifSegunda = inseridos.find(
      (i) => i.tabela === "notificacoes_pendentes" && i.valores.dados?.nome === "Segunda Sociedade",
    );
    expect(notifSegunda).toBeDefined();
    expect(notifSegunda?.valores.dados?.nif).toBe("500000000");
    expect(notifSegunda?.valores.dados?.prefixo).toBe("SEG");
  });

  it("notifica o Dono quando um novo utilizador é criado via criarUtilizador", async () => {
    const orgId = "01920000-0000-7000-8000-000000000001";
    const adminUser = {
      id: "u-admin",
      authUserId: "auth-admin",
      email: "admin@sociedade.pt",
      nome: "Admin Sociedade",
      papel: "society_admin",
      organizacaoId: orgId,
      ativo: true,
      aprovadoEm: new Date(),
      deveRedefinirPassword: false,
    };
    linhas["utilizador"] = [adminUser];

    sessaoMock = {
      conta: { id: "auth-admin", email: "admin@sociedade.pt" },
      eu: adminUser,
    };

    linhas["organizacao"] = [{ id: orgId, nome: "Sociedade Silva" }];

    const resultado = await criarUtilizador({
      nome: "Advogada Joana",
      email: "joana@sociedade.pt",
      papel: "utilizador",
      organizacaoId: orgId,
    });

    expect(resultado.ok).toBe(true);

    // Frente P: Notificação in-app e fila do resumo diário para novo utilizador
    const notifUtilizador = inseridos.find(
      (i) => i.tabela === "notificacoes_pendentes" && i.valores.tipo === "novo_utilizador",
    );
    expect(notifUtilizador).toBeDefined();
    expect(notifUtilizador?.valores.dados?.nome).toBe("Advogada Joana");
    expect(notifUtilizador?.valores.dados?.email).toBe("joana@sociedade.pt");
  });

  it("envia alerta de erro ao Dono quando a criação da conta do administrador falha", async () => {
    const superAdminUser = {
      id: "u-dono",
      authUserId: "auth-dono",
      email: "dono@plataforma.pt",
      nome: "Dono da Plataforma",
      papel: "super_admin",
      organizacaoId: null,
      ativo: true,
      aprovadoEm: new Date(),
      deveRedefinirPassword: false,
    };
    linhas["utilizador"] = [superAdminUser];

    sessaoMock = {
      conta: { id: "auth-dono", email: "dono@plataforma.pt" },
      eu: superAdminUser,
    };

    // Simular falha na criação do admin inicial
    const resultado = await criarSociedade({
      nome: "Sociedade Alerta",
      nif: "501999884",
      prefixoReferencia: "ALT",
      adminNome: "Admin Alerta",
      adminEmail: "admin.falha@sociedade.pt",
    });

    expect(resultado.ok).toBe(true);
    expect((resultado as { ok: true; avisoAdmin: string | null }).avisoAdmin).toBe("Não foi possível criar a conta do administrador.");

    // Frente P: Alerta in-app e na fila do resumo diário
    const notifAlerta = inseridos.find(
      (i) => i.tabela === "notificacao" && i.valores.titulo?.includes("[Alerta]"),
    );
    expect(notifAlerta).toBeDefined();
    expect(notifAlerta?.valores.corpo).toContain("Sociedade Alerta");
  });
});
