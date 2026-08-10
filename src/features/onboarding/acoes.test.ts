import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcessoOnboarding } from "./dados";

/**
 * `guardarPasso` e `submeter` — o fluxo de onboarding do lado do servidor.
 *
 * Os schemas já estão fixados em `schemas.test.ts` e o percurso em
 * `passos.test.ts`. O que faltava era o meio: quem decide se um passo pode ser
 * gravado, o que é escrito quando ele é, e as três travas que separam um
 * formulário preenchido de um processo submetido.
 *
 * São três classes de defeito distintas, e nenhuma delas se vê a olho:
 *
 *   · **guardas de acesso** — um link expirado, um processo já submetido, um
 *     passo que não pertence a este percurso. Todos têm de recusar *antes* de
 *     escrever seja o que for, e todos com a mesma explicação que a página dá;
 *   · **efeitos que não são o passo** — o risco que PPE declarada força (e que
 *     tem de voltar atrás quando a declaração volta atrás), o representante que
 *     desaparece ao trocar para pessoa singular, os consentimentos do RGPD;
 *   · **o que não pode derrubar uma submissão já gravada** — os emails e o
 *     arquivo em SFTP correm depois do `UPDATE`, e um erro em qualquer um deles
 *     não pode transformar um formulário bem preenchido num ecrã de erro (D46).
 */

const AGORA = new Date("2026-08-10T12:00:00.000Z");
const TOKEN = "abcDEF123_-abcDEF123_-abcDEF123_-abcDEF123x";
const RUBRICA = `data:image/png;base64,${"iVBORw0KGgoAAAANSUhEUg".repeat(4)}`;

type Linha = Record<string, unknown>;

/** Tudo o que foi escrito na base, por ordem. */
const operacoes: { tipo: "insert" | "update" | "delete"; tabela: string; valores?: Linha }[] = [];
const auditados: { acao: string; valorNovo?: Linha; valorAnterior?: Linha }[] = [];
const consentimentos: { finalidade: string; aceite: boolean }[] = [];
const enviados: { para: string; template: string }[] = [];
const arquivados: string[] = [];

/** As linhas que cada SELECT devolve, por tabela. */
let linhas: Record<string, Linha[]> = {};
/** A tabela cujo SELECT rebenta — para encenar uma falha depois da submissão. */
let selectRebentaEm: string | null = null;
let acesso: AcessoOnboarding;
let arquivoRebenta = false;

const processo = (extra: Linha = {}) => ({
  id: "proc-1",
  organizacaoId: "org-1",
  referencia: "JM-2026-0007",
  tipoCliente: "particular",
  estado: "rascunho",
  nivelRisco: "baixo",
  fatoresRisco: [],
  passoAtual: 1,
  submetidoEm: null,
  ...extra,
});

/* ── mocks ────────────────────────────────────────────────────────────── */

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "1.2.3.4", "user-agent": "vitest" }),
}));

/** Os construtores de condição não têm nada a dizer sobre tabelas falsas. */
vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c,
  eq: (...c: unknown[]) => c,
  isNull: (...c: unknown[]) => c,
  desc: (...c: unknown[]) => c,
  sql: (...c: unknown[]) => c,
}));

vi.mock("@/db/schema/processo", () => ({ processoOnboarding: "processo_onboarding" }));

vi.mock("@/db/schema/documentos", () => ({
  assinatura: "assinatura",
  documento: "documento",
}));

vi.mock("@/db/schema/seccoes", () => ({
  areaInteresse: "area_interesse",
  dadosFaturacao: "dados_faturacao",
  dadosFiscais: "dados_fiscais",
  dadosIdentificacao: "dados_identificacao",
  declaracaoPpe: "declaracao_ppe",
  emailNewsletter: "email_newsletter",
  fechoProposta: "fecho_proposta",
  nacionalidade: "nacionalidade",
  preferenciasContacto: "preferencias_contacto",
  relacaoNegocio: "relacao_negocio",
  representanteLegal: "representante_legal",
}));

/**
 * A base de dados, reduzida ao que estas ações lhe pedem: um SELECT por tabela,
 * e um diário de tudo o que foi escrito. O `then` é o que permite ao mesmo
 * objeto ser esperado diretamente (`await base.insert(x).values(y)`) e ainda
 * assim oferecer `onConflictDoUpdate` e `returning` a quem os chame.
 */
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
            limit: async () => {
              if (selectRebentaEm === String(t)) {
                throw new Error(`o SELECT em ${String(t)} rebentou`);
              }
              return linhas[String(t)] ?? [];
            },
          }),
        }),
      }),
      insert: (t: unknown) => ({
        values: (v: Linha | Linha[]) => {
          operacoes.push({
            tipo: "insert",
            tabela: String(t),
            valores: Array.isArray(v) ? { linhas: v } : v,
          });
          return esperavel({ onConflictDoUpdate: async () => undefined });
        },
      }),
      update: (t: unknown) => ({
        set: (v: Linha) => ({
          where: () => {
            operacoes.push({ tipo: "update", tabela: String(t), valores: v });
            return esperavel({
              returning: async () => [{ ...(linhas[String(t)]?.[0] ?? {}), ...v }],
            });
          },
        }),
      }),
      delete: (t: unknown) => ({
        where: async () => {
          operacoes.push({ tipo: "delete", tabela: String(t) });
        },
      }),
    }),
  };
});

/**
 * `motivoDoAcesso` fica o verdadeiro de propósito: o que se está a testar é que
 * a Server Action diz **a mesma frase** que a página, e uma cópia do texto no
 * teste esconderia exatamente a divergência que a D49 fechou.
 */
vi.mock("./dados", async () => {
  const real = await vi.importActual<typeof import("./dados")>("./dados");
  return {
    ...real,
    acessoPorToken: async () => acesso,
    seccoesDoProcesso: async () => ({ identificacao: null, fiscais: null }),
  };
});

vi.mock("./consentimentos", () => ({
  registarConsentimento: async (o: { finalidade: string; aceite: boolean }) => {
    consentimentos.push({ finalidade: o.finalidade, aceite: o.aceite });
  },
}));

vi.mock("@/features/auditoria/registar", () => ({
  registarEvento: async (e: { acao: string; valorNovo?: Linha; valorAnterior?: Linha }) => {
    auditados.push(e);
  },
}));

vi.mock("@/lib/email", () => ({
  enviarEmail: async (p: { para: string; template: string }) => {
    enviados.push({ para: p.para, template: p.template });
    return { ok: true };
  },
}));

vi.mock("@/lib/emails/jmassano", () => ({
  ASSUNTO_CONFIRMACAO: "JMASSANO | Confirmação de Receção dos seus Dados",
  ASSUNTO_BOAS_VINDAS: "Bem-vindo à JMASSANO Escritório de Advogado",
  emailConfirmacaoRececao: () => "<p>confirmação</p>",
  emailBoasVindas: () => "<p>boas-vindas</p>",
}));

vi.mock("@/lib/origem", () => ({ origemPublica: async () => "https://poc.terlicalabs.com" }));

vi.mock("@/env", () => ({ env: () => ({ EMAIL_NOTIFICACOES: "equipa@jmassano.pt" }) }));

vi.mock("@/lib/storage/sincronizar", () => ({
  sincronizarCliente: async (p: { referencia: string }) => {
    if (arquivoRebenta) throw new Error("o servidor SFTP não respondeu");
    arquivados.push(p.referencia);
  },
  resumoDoProcesso: async () => Buffer.from("%PDF-resumo"),
}));

vi.mock("@/lib/storage/termos-pdf", () => ({
  gerarTermosPdf: async () => Buffer.from("%PDF-termos"),
}));

/**
 * A proposta de honorários é o único dos três anexos que não é gerado — é um
 * ficheiro em `public/`. Lido daqui, o teste passaria a depender de ele existir
 * na árvore, e a falhar por uma razão que não tem nada a ver com o que mede.
 */
vi.mock("node:fs/promises", () => ({
  readFile: async () => Buffer.from("%PDF-proposta"),
}));

const { guardarPasso, submeter } = await import("./acoes");
const { motivoDoAcesso } = await import("./dados");

/* ── cargas válidas, uma por passo ────────────────────────────────────── */

const PASSO_1 = {
  tipoCliente: "particular",
  nome: "Maria Silva",
  profissao: "Arquiteta",
  entidadePatronal: "N/A",
  dataNascimento: "1985-06-14",
  nacionalidades: ["PT"],
  telefone: "+351 912 345 678",
  email: "maria@exemplo.pt",
  morada: "Rua das Flores, 12",
  pais: "PT",
  localidade: "Porto",
  codigoPostal: "4000-001",
  freguesia: "Cedofeita",
  concelho: "Porto",
  distrito: "Porto",
};

const PASSO_2 = {
  nifPortugues: true,
  resideEmPortugal: true,
  nif: "123456789",
  docTipo: "cartao_cidadao",
  docNumero: "12345678",
  docValidade: "2999-01-01",
};

const PASSO_4 = {
  ePpe: false,
  eRelacionadoPpe: false,
  servicos: "Avença",
  origemFundos: "Rendimentos do trabalho",
};

const PASSO_6 = {
  origemContacto: "recomendacao",
  origemDetalhe: "Dr. Costa",
  newsletter: true,
  emailsNewsletter: ["maria@exemplo.pt"],
  convitesIniciativas: false,
};

const PASSO_7 = { declaracaoVeracidade: true, tcAceitacao: true, assinatura: RUBRICA };

/** As tabelas escritas de um tipo, pela ordem em que o foram. */
const escritas = (tipo: "insert" | "update" | "delete") =>
  operacoes.filter((o) => o.tipo === tipo).map((o) => o.tabela);

const valoresDe = (tipo: "insert" | "update", tabela: string) =>
  operacoes.find((o) => o.tipo === tipo && o.tabela === tabela)?.valores;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  operacoes.length = 0;
  auditados.length = 0;
  consentimentos.length = 0;
  enviados.length = 0;
  arquivados.length = 0;
  // A linha que o `returning()` da submissão devolve, para o arquivo receber a
  // referência e a data de submissão e não um objeto só com o que mudou.
  linhas = { processo_onboarding: [processo()] };
  selectRebentaEm = null;
  arquivoRebenta = false;
  acesso = { estado: "ok", processo: processo() as never, token: TOKEN };
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ── as guardas, antes de haver escrita ───────────────────────────────── */

describe("guardarPasso — quem não pode gravar, não grava", () => {
  it("um link expirado é recusado com a mesma frase que a página mostra", async () => {
    const expirouEm = new Date("2026-08-01T00:00:00.000Z");
    acesso = { estado: "expirado", referencia: "JM-2026-0007", expirouEm };

    const r = await guardarPasso(TOKEN, 1, PASSO_1);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    const m = motivoDoAcesso(acesso);
    expect(r.mensagem).toBe(`${m.titulo} ${m.descricao}`);
    expect(operacoes).toHaveLength(0);
  });

  it("um dossier arquivado e um token inventado dizem coisas diferentes", async () => {
    acesso = { estado: "arquivado", referencia: "JM-2026-0007" };
    const arquivado = await guardarPasso(TOKEN, 1, PASSO_1);

    acesso = { estado: "desconhecido" };
    const desconhecido = await guardarPasso(TOKEN, 1, PASSO_1);

    expect(arquivado.ok).toBe(false);
    expect(desconhecido.ok).toBe(false);
    if (arquivado.ok || desconhecido.ok) return;
    expect(arquivado.mensagem).not.toBe(desconhecido.mensagem);
    // A referência é de quem já traz um token que bate certo.
    expect(desconhecido.mensagem).not.toContain("JM-2026-0007");
  });

  it("um processo já submetido não se altera", async () => {
    acesso = { estado: "ok", processo: processo({ estado: "submetido" }) as never, token: TOKEN };

    const r = await guardarPasso(TOKEN, 1, PASSO_1);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.mensagem).toContain("já foi submetido");
    expect(operacoes).toHaveLength(0);
  });

  /**
   * O passo 3 não pertence ao percurso de uma pessoa singular (D28), e a página
   * nem lho mostra. A Server Action é um endpoint público como outro qualquer:
   * quem a chame à mão tem de levar a mesma resposta.
   */
  it("o passo 3 não se aplica a um particular, mesmo chamado à mão", async () => {
    const r = await guardarPasso(TOKEN, 3, { eRepresentante: true });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.mensagem).toContain("não se aplica");
    expect(operacoes).toHaveLength(0);
  });

  it("numa empresa, o mesmo passo 3 grava-se", async () => {
    acesso = { estado: "ok", processo: processo({ tipoCliente: "empresa" }) as never, token: TOKEN };

    const r = await guardarPasso(TOKEN, 3, { eRepresentante: true });

    expect(r.ok).toBe(true);
    expect(escritas("insert")).toContain("representante_legal");
  });

  it("um passo que não existe é recusado", async () => {
    const r = await guardarPasso(TOKEN, 9, {});

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.mensagem).toBe("Passo inválido.");
    expect(operacoes).toHaveLength(0);
  });

  it("o Zod recusa antes de escrever seja o que for, e nomeia os campos", async () => {
    const r = await guardarPasso(TOKEN, 2, { ...PASSO_2, nif: "123456788" });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.erros)).toEqual(["nif"]);
    expect(operacoes).toHaveLength(0);
    expect(auditados).toHaveLength(0);
  });

  it("um documento caducado não entra na base", async () => {
    const r = await guardarPasso(TOKEN, 2, { ...PASSO_2, docValidade: "2020-01-01" });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.erros)).toEqual(["docValidade"]);
    expect(operacoes).toHaveLength(0);
  });
});

/* ── a navegação, gravada ─────────────────────────────────────────────── */

describe("guardarPasso — o passo seguinte é o do percurso, não o número a seguir", () => {
  it("num particular, o 2 avança para o 4 e é isso que fica em passo_atual", async () => {
    const r = await guardarPasso(TOKEN, 2, PASSO_2);

    expect(r).toEqual({ ok: true, proximo: 4 });
    expect(valoresDe("update", "processo_onboarding")).toEqual({ passoAtual: 4 });
  });

  it("numa empresa, o 2 avança para o 3", async () => {
    acesso = { estado: "ok", processo: processo({ tipoCliente: "empresa" }) as never, token: TOKEN };

    const r = await guardarPasso(TOKEN, 2, PASSO_2);

    expect(r).toEqual({ ok: true, proximo: 3 });
  });

  it("o passo 7 não tem seguinte, e o passo_atual fica onde está", async () => {
    const r = await guardarPasso(TOKEN, 7, PASSO_7);

    expect(r).toEqual({ ok: true, proximo: null });
    expect(operacoes).toContainEqual(
      expect.objectContaining({ tipo: "update", tabela: "processo_onboarding", valores: { passoAtual: 7 } }),
    );
  });

  it("cada passo gravado deixa o seu carimbo na auditoria", async () => {
    await guardarPasso(TOKEN, 2, PASSO_2);

    expect(auditados.map((e) => e.acao)).toContain("passo.2.gravado");
  });
});

/* ── os efeitos que não são o passo ───────────────────────────────────── */

describe("guardarPasso — o passo 1 e o representante que deixa de fazer sentido", () => {
  it("as nacionalidades do cliente são substituídas, não acumuladas", async () => {
    await guardarPasso(TOKEN, 1, PASSO_1);

    expect(escritas("delete")).toContain("nacionalidade");
    expect(valoresDe("insert", "nacionalidade")).toEqual({
      linhas: [{ processoId: "proc-1", titular: "cliente", pais: "PT" }],
    });
  });

  /**
   * Trocar de empresa para pessoa singular tira o passo 3 do percurso (D29). O
   * que lá tivesse sido gravado deixa de descrever este processo, e deixado lá
   * aparecia no PDF do arquivo e no back-office como se ainda descrevesse.
   */
  it("trocar para pessoa singular apaga o representante e as nacionalidades dele", async () => {
    acesso = { estado: "ok", processo: processo({ tipoCliente: "empresa" }) as never, token: TOKEN };

    await guardarPasso(TOKEN, 1, PASSO_1);

    expect(escritas("delete")).toContain("representante_legal");
    // Duas: a das nacionalidades do cliente, e a das do representante.
    expect(escritas("delete").filter((t) => t === "nacionalidade")).toHaveLength(2);
  });

  it("ficando empresa, o representante mantém-se", async () => {
    acesso = { estado: "ok", processo: processo({ tipoCliente: "empresa" }) as never, token: TOKEN };

    await guardarPasso(TOKEN, 1, {
      ...PASSO_1,
      tipoCliente: "empresa",
      nome: "Silva & Costa, Lda.",
      naturezaJuridica: "Sociedade por quotas",
      profissao: undefined,
      entidadePatronal: undefined,
      dataNascimento: undefined,
    });

    expect(escritas("delete")).not.toContain("representante_legal");
  });
});

/**
 * O risco não é mostrado a ninguém (D21), o que torna esta regra impossível de
 * verificar a olho — e foi por isso que ela esteve meses só a subir. É o valor
 * gravado, e é dele que qualquer relatório vai viver.
 */
describe("guardarPasso — o risco sobe com a PPE, e volta com ela", () => {
  it("uma PPE declarada força risco elevado e fica em auditoria", async () => {
    const r = await guardarPasso(TOKEN, 4, {
      ...PASSO_4,
      ePpe: true,
      ppeCargo: "Secretário de Estado",
      ppePais: "PT",
      ppeEntidade: "Ministério das Finanças",
      ppeInicio: "2020-01-01",
    });

    expect(r.ok).toBe(true);
    expect(valoresDe("update", "processo_onboarding")).toMatchObject({ nivelRisco: "elevado" });
    expect(auditados.map((e) => e.acao)).toContain("risco.elevado");
  });

  it("retirar a declaração repõe o risco, com o seu próprio evento", async () => {
    acesso = {
      estado: "ok",
      processo: processo({
        nivelRisco: "elevado",
        fatoresRisco: [{ codigo: "ppe", descricao: "Pessoa politicamente exposta declarada", peso: 100 }],
      }) as never,
      token: TOKEN,
    };

    await guardarPasso(TOKEN, 4, PASSO_4);

    expect(valoresDe("update", "processo_onboarding")).toEqual({
      nivelRisco: "baixo",
      fatoresRisco: [],
    });
    expect(auditados.map((e) => e.acao)).toContain("risco.reposto");
  });

  it("um Não sobre um processo que já era baixo não escreve nada de risco", async () => {
    await guardarPasso(TOKEN, 4, PASSO_4);

    expect(auditados.map((e) => e.acao)).toEqual(["passo.4.gravado"]);
  });

  it("uma PPE reafirmada não volta a escrever risco.elevado", async () => {
    acesso = { estado: "ok", processo: processo({ nivelRisco: "elevado" }) as never, token: TOKEN };

    await guardarPasso(TOKEN, 4, {
      ...PASSO_4,
      ePpe: true,
      ppeCargo: "Secretário de Estado",
      ppePais: "PT",
      ppeEntidade: "Ministério das Finanças",
      ppeInicio: "2020-01-01",
    });

    expect(auditados.map((e) => e.acao)).toEqual(["passo.4.gravado"]);
  });
});

describe("guardarPasso — RGPD: cada sim e cada não deixam consentimento", () => {
  it("as duas finalidades são gravadas com a resposta dada", async () => {
    await guardarPasso(TOKEN, 6, PASSO_6);

    expect(consentimentos).toEqual([
      { finalidade: "newsletter", aceite: true },
      { finalidade: "convites_iniciativas", aceite: false },
    ]);
  });

  it("as listas são substituídas, e um Não não deixa endereços para trás", async () => {
    await guardarPasso(TOKEN, 6, { origemContacto: "pesquisa_online" });

    expect(escritas("delete")).toEqual(["email_newsletter", "area_interesse"]);
    expect(escritas("insert")).toEqual(["preferencias_contacto"]);
    expect(consentimentos).toEqual([
      { finalidade: "newsletter", aceite: false },
      { finalidade: "convites_iniciativas", aceite: false },
    ]);
  });
});

/**
 * O que se assina é o conteúdo, não o botão: o hash é do dossier inteiro no
 * momento da assinatura. E a hora é a do servidor — a do cliente é trivial de
 * alterar, e é a hora que dá valor probatório à rubrica.
 */
describe("guardarPasso — o passo 7 assina o dossier, não a caixa", () => {
  it("grava a rubrica com o hash do dossier e o relógio do servidor", async () => {
    await guardarPasso(TOKEN, 7, PASSO_7);

    const rubrica = valoresDe("insert", "assinatura");
    expect(rubrica).toMatchObject({
      processoId: "proc-1",
      tipo: "simples",
      imagemDados: RUBRICA,
      ip: "1.2.3.4",
      userAgent: "vitest",
      assinadoEm: AGORA,
    });
    expect(String(rubrica?.hashDocumento)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a declaração fica no fecho, e a rubrica fora dele", async () => {
    await guardarPasso(TOKEN, 7, PASSO_7);

    expect(valoresDe("insert", "fecho_proposta")).toEqual({
      processoId: "proc-1",
      declaracaoVeracidade: true,
      tcAceitacao: true,
    });
  });

  it("a assinatura e a declaração deixam rasto próprio", async () => {
    await guardarPasso(TOKEN, 7, PASSO_7);

    expect(auditados.map((e) => e.acao)).toEqual(["assinatura.criada", "passo.7.gravado"]);
    expect(consentimentos).toEqual([{ finalidade: "declaracao_veracidade", aceite: true }]);
  });

  it("os T&C por aceitar não chegam a produzir assinatura nenhuma", async () => {
    const r = await guardarPasso(TOKEN, 7, { ...PASSO_7, tcAceitacao: false });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.erros)).toEqual(["tcAceitacao"]);
    expect(operacoes).toHaveLength(0);
  });
});

/* ── a submissão ──────────────────────────────────────────────────────── */

/**
 * As três travas, verificadas contra a **base de dados** e não contra a carga
 * do passo 7. É a diferença que interessa: quem chame `submeter` à mão salta o
 * formulário inteiro, e o que tem de o parar é o que ficou gravado.
 */
describe("submeter — as três travas", () => {
  const completo = () => {
    linhas["fecho_proposta"] = [{ tcAceitacao: true, declaracaoVeracidade: true }];
    linhas["assinatura"] = [{ imagemDados: RUBRICA }];
    linhas["dados_identificacao"] = [{ email: "maria@exemplo.pt", nome: "Maria Silva" }];
    linhas["dados_faturacao"] = [];
  };

  it("sem passo 7 gravado, não submete — e a queixa é dos T&C", async () => {
    linhas["fecho_proposta"] = [];

    const r = await submeter(TOKEN);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.erros)).toEqual(["tcAceitacao"]);
    expect(escritas("update")).toHaveLength(0);
  });

  it("com os T&C por aceitar, não submete", async () => {
    completo();
    linhas["fecho_proposta"] = [{ tcAceitacao: false, declaracaoVeracidade: true }];

    const r = await submeter(TOKEN);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.erros)).toEqual(["tcAceitacao"]);
  });

  it("com a declaração de veracidade por dar, não submete", async () => {
    completo();
    linhas["fecho_proposta"] = [{ tcAceitacao: true, declaracaoVeracidade: false }];

    const r = await submeter(TOKEN);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.erros)).toEqual(["declaracaoVeracidade"]);
  });

  /** A caixa de verificação sozinha não vale nada: a prova é a rubrica. */
  it("sem rubrica gravada, não submete", async () => {
    completo();
    linhas["assinatura"] = [];

    const r = await submeter(TOKEN);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.erros)).toEqual(["assinatura"]);
    expect(escritas("update")).toHaveLength(0);
  });

  it("uma rubrica curta demais é tratada como rubrica nenhuma", async () => {
    completo();
    linhas["assinatura"] = [{ imagemDados: "data:image/png;base64,AA" }];

    const r = await submeter(TOKEN);

    expect(r.ok).toBe(false);
  });

  it("um link expirado recusa antes de tocar na base", async () => {
    acesso = { estado: "expirado", referencia: "JM-2026-0007", expirouEm: AGORA };

    const r = await submeter(TOKEN);

    expect(r.ok).toBe(false);
    expect(operacoes).toHaveLength(0);
  });
});

describe("submeter — com tudo no sítio", () => {
  beforeEach(() => {
    linhas["fecho_proposta"] = [{ tcAceitacao: true, declaracaoVeracidade: true }];
    linhas["assinatura"] = [{ imagemDados: RUBRICA }];
    linhas["dados_identificacao"] = [{ email: "maria@exemplo.pt", nome: "Maria Silva" }];
    linhas["dados_faturacao"] = [];
  });

  it("fecha o processo com a hora do servidor e escreve processo.submetido", async () => {
    const r = await submeter(TOKEN);

    expect(r).toEqual({ ok: true, proximo: null });
    expect(valoresDe("update", "processo_onboarding")).toEqual({
      estado: "submetido",
      submetidoEm: AGORA,
    });
    expect(auditados.map((e) => e.acao)).toEqual(["processo.submetido"]);
    expect(auditados[0]?.valorAnterior).toEqual({ estado: "rascunho" });
  });

  it("saem os dois emails ao cliente e o aviso ao back-office", async () => {
    await submeter(TOKEN);

    expect(enviados.map((e) => e.template)).toEqual([
      "confirmacao_rececao",
      "notificacao_backoffice",
      "boas_vindas",
    ]);
    expect(enviados.slice(0, 2).map((e) => e.para)).toEqual([
      "maria@exemplo.pt",
      "equipa@jmassano.pt",
    ]);
    expect(enviados[2]?.para).toBe("maria@exemplo.pt");
  });

  it("sem email na identificação, vale o da faturação", async () => {
    linhas["dados_identificacao"] = [];
    linhas["dados_faturacao"] = [{ email: "faturacao@exemplo.pt" }];

    await submeter(TOKEN);

    expect(enviados.slice(0, 2).map((e) => e.para)).toEqual([
      "faturacao@exemplo.pt",
      "equipa@jmassano.pt",
    ]);
  });

  it("sem endereço nenhum, o aviso interno sai à mesma", async () => {
    linhas["dados_identificacao"] = [];
    linhas["dados_faturacao"] = [];

    const r = await submeter(TOKEN);

    expect(r.ok).toBe(true);
    expect(enviados.map((e) => e.template)).toEqual(["notificacao_backoffice"]);
  });

  it("a pasta do cliente é sincronizada com a linha já submetida", async () => {
    await submeter(TOKEN);

    expect(arquivados).toEqual(["JM-2026-0007"]);
  });

  /**
   * O bloco que a D46 existe para ter, deste lado. O processo já está gravado
   * quando os emails e o arquivo correm: nada do que aconteça a seguir pode
   * transformar uma submissão bem-sucedida num ecrã de erro.
   */
  it("os emails a rebentar não desfazem a submissão", async () => {
    selectRebentaEm = "dados_identificacao";

    const r = await submeter(TOKEN);

    expect(r).toEqual({ ok: true, proximo: null });
    expect(valoresDe("update", "processo_onboarding")).toMatchObject({ estado: "submetido" });
    expect(auditados.map((e) => e.acao)).toEqual(["processo.submetido"]);
  });

  it("o arquivo em SFTP a rebentar não desfaz a submissão", async () => {
    arquivoRebenta = true;

    const r = await submeter(TOKEN);

    expect(r).toEqual({ ok: true, proximo: null });
    expect(arquivados).toEqual([]);
  });
});
