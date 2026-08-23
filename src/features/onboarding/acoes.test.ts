import { createHash } from "node:crypto";
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

vi.mock("@/db/schema/otp", () => ({ codigoOtp: "codigo_otp" }));

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
        from: (t: unknown) => {
          const ler = async () => {
            if (selectRebentaEm === String(t)) {
              throw new Error(`o SELECT em ${String(t)} rebentou`);
            }
            return linhas[String(t)] ?? [];
          };
          // Um SELECT termina de três maneiras — `.limit()`, `.orderBy().limit()`
          // ou o próprio `where` esperado diretamente (a lista dos tipos de
          // documento anexados não pede limite nenhum). As três têm de devolver
          // as mesmas linhas.
          const fim = () => ({
            limit: ler,
            orderBy: () => ({ limit: ler }),
            then: (aceitar: (v: unknown) => unknown) => ler().then(aceitar),
          });
          return { where: fim, ...fim() };
        },
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
  ASSUNTO_OTP: "JMASSANO | Código de verificação",
  emailConfirmacaoRececao: () => "<p>confirmação</p>",
  emailBoasVindas: () => "<p>boas-vindas</p>",
  emailCodigoOtp: () => "<p>código</p>",
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

const { guardarPasso, submeter, enviarCodigoOtp, verificarCodigoOtp } = await import("./acoes");
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

/** NIPC de pessoa coletiva: começa por 5 e o mod-11 fecha. */
const NIPC_VALIDO = "500000000";

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

const PASSO_7 = {
  declaracaoVeracidade: true,
  tcAceitacao: true,
  propostaAceitacao: true,
  assinatura: RUBRICA,
};

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
  //
  // `documento` traz os dois anexos que o passo 2 passou a exigir, e `codigo_otp`
  // uma verificação acabada de fazer: são agora pré-condições do fluxo normal, e
  // sem elas todos os testes de passo 2 e de passo 7 mediriam a trava nova em
  // vez do que se propõem medir. As travas em si têm testes próprios, mais
  // abaixo, que **tiram** estas linhas de propósito.
  linhas = {
    processo_onboarding: [processo()],
    documento: [{ tipo: "identificacao" }, { tipo: "comprovativo_nif" }],
    codigo_otp: [
      {
        id: "otp-1",
        processoId: "proc-1",
        codigoHash: "irrelevante",
        enviadoPara: "maria@exemplo.pt",
        expiraEm: new Date(AGORA.getTime() + 5 * 60_000),
        tentativas: 1,
        verificadoEm: new Date(AGORA.getTime() - 60_000),
        criadoEm: new Date(AGORA.getTime() - 120_000),
      },
    ],
  };
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
    // O percurso Empresa pede mais uma coisa a cada uma das duas regras novas:
    // um NIPC de pessoa coletiva e a certidão permanente entre os anexos.
    linhas.documento = [
      { tipo: "identificacao" },
      { tipo: "comprovativo_nif" },
      { tipo: "certidao_permanente" },
    ];

    const r = await guardarPasso(TOKEN, 2, { ...PASSO_2, nif: NIPC_VALIDO });

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
      propostaAceitacao: true,
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

/**
 * A verificação por email, e o momento em que ela é perguntada.
 *
 * O link mágico é o único fator de autenticação do onboarding, e um link mágico
 * é um segredo que viaja por email e se cola em conversas. O código fecha essa
 * distância no único ponto em que ela importa — quem assina prova, no momento de
 * assinar, que continua a ter acesso à caixa para onde a sociedade escreveu.
 *
 * O que estes testes fixam é sobretudo a **ordem**: a pergunta é feita antes do
 * Zod e antes de qualquer escrita. Feita depois, a resposta ao cliente seria
 * «Assine no quadro antes de submeter» — sobre um quadro que a própria
 * plataforma está a esconder até ele validar o código.
 */
describe("guardarPasso — o passo 7 exige o código verificado", () => {
  it("sem código nenhum, recusa antes de escrever seja o que for", async () => {
    linhas.codigo_otp = [];

    const r = await guardarPasso(TOKEN, 7, PASSO_7);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.erros)).toEqual(["otp"]);
    expect(operacoes).toHaveLength(0);
    expect(auditados).toHaveLength(0);
  });

  it("um código pedido mas por verificar não abre a porta", async () => {
    linhas.codigo_otp = [
      {
        expiraEm: new Date(AGORA.getTime() + 5 * 60_000),
        tentativas: 0,
        verificadoEm: null,
        criadoEm: AGORA,
      },
    ];

    const r = await guardarPasso(TOKEN, 7, PASSO_7);

    expect(r.ok).toBe(false);
    expect(operacoes).toHaveLength(0);
  });

  /**
   * A verificação vale uma hora, e não para sempre: entre acertar no código e
   * carregar em Submeter há a leitura dos T&C, a da proposta e a rubrica, e
   * obrigar a repetir a meio disso era transformar a medida num obstáculo que se
   * contorna pedindo outro código. Ao fim da hora, deixa de valer.
   */
  it("uma verificação de ontem já não vale hoje", async () => {
    linhas.codigo_otp = [
      {
        expiraEm: new Date(AGORA.getTime() - 23 * 3600_000),
        tentativas: 1,
        verificadoEm: new Date(AGORA.getTime() - 24 * 3600_000),
        criadoEm: new Date(AGORA.getTime() - 25 * 3600_000),
      },
    ];

    const r = await guardarPasso(TOKEN, 7, PASSO_7);

    expect(r.ok).toBe(false);
    expect(operacoes).toHaveLength(0);
  });

  /** A trava é só do fecho: os outros passos não sabem que ela existe. */
  it("não trava os passos que não assinam nada", async () => {
    linhas.codigo_otp = [];

    expect((await guardarPasso(TOKEN, 2, PASSO_2)).ok).toBe(true);
  });
});

/**
 * Os anexos obrigatórios do passo 2, medidos contra a **base de dados**.
 *
 * O `Anexos` não é campo do formulário — sobe por uma Server Action à parte e o
 * input nem `name` tem —, por isso a carga do passo nunca traz ficheiro nenhum e
 * nunca poderia trazer. A única fonte honesta do que está anexado é a tabela
 * `documento`, e é de lá que o `guardarPasso` a injeta antes do Zod.
 */
describe("guardarPasso — o passo 2 não fecha sem os documentos", () => {
  it("sem anexo nenhum, recusa e nomeia o campo", async () => {
    linhas.documento = [];

    const r = await guardarPasso(TOKEN, 2, PASSO_2);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.erros)).toEqual(["documentos"]);
    expect(r.erros.documentos[0]).toBe("Anexe o documento de identificação para continuar.");
    expect(operacoes).toHaveLength(0);
  });

  /**
   * A remoção pelo cliente é soft delete (a lei manda reter). Sem o filtro de
   * `apagado_em`, anexar o cartão de cidadão e removê-lo a seguir deixava o
   * passo dar-se por satisfeito com um documento que já não está lá — e é o
   * `where` da consulta que o garante, não este teste; o que aqui se fixa é que
   * a lista vem da base e não da carga.
   */
  it("um `documentos` inventado na carga não substitui o que está na base", async () => {
    linhas.documento = [];

    const r = await guardarPasso(TOKEN, 2, {
      ...PASSO_2,
      documentos: ["identificacao", "comprovativo_nif"],
    });

    expect(r.ok).toBe(false);
    expect(operacoes).toHaveLength(0);
  });

  /**
   * O mesmo vale para o `tipoCliente`: quem o mandasse na carga escolhia a régua
   * do seu próprio NIF. Um particular a declarar-se empresa levaria com a régua
   * do NIPC; uma empresa a declarar-se particular escapava-lhe. O que decide é a
   * linha do processo.
   */
  it("um `tipoCliente` inventado na carga não muda a régua do NIF", async () => {
    const r = await guardarPasso(TOKEN, 2, { ...PASSO_2, tipoCliente: "empresa" });

    // O processo é `particular` e o NIF é de pessoa singular: passa, apesar de a
    // carga pedir a régua de coletiva.
    expect(r.ok).toBe(true);
  });

  it("nem `tipoCliente` nem `documentos` chegam a `dados_fiscais`", async () => {
    await guardarPasso(TOKEN, 2, PASSO_2);

    const gravado = valoresDe("insert", "dados_fiscais");
    expect(gravado).not.toHaveProperty("tipoCliente");
    expect(gravado).not.toHaveProperty("documentos");
    expect(gravado).toMatchObject({ processoId: "proc-1", nif: "123456789" });
  });
});

/* ── a submissão ──────────────────────────────────────────────────────── */

/**
 * As quatro travas, verificadas contra a **base de dados** e não contra a
 * carga do passo 7. É a diferença que interessa: quem chame `submeter` à mão
 * salta o formulário inteiro, e o que tem de o parar é o que ficou gravado.
 */
describe("submeter — as quatro travas", () => {
  const completo = () => {
    linhas["fecho_proposta"] = [
      { tcAceitacao: true, propostaAceitacao: true, declaracaoVeracidade: true },
    ];
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
    linhas["fecho_proposta"] = [
      { tcAceitacao: false, propostaAceitacao: true, declaracaoVeracidade: true },
    ];

    const r = await submeter(TOKEN);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.erros)).toEqual(["tcAceitacao"]);
  });

  it("com a proposta de honorários por aceitar, não submete", async () => {
    completo();
    linhas["fecho_proposta"] = [
      { tcAceitacao: true, propostaAceitacao: false, declaracaoVeracidade: true },
    ];

    const r = await submeter(TOKEN);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.erros)).toEqual(["propostaAceitacao"]);
  });

  it("com a declaração de veracidade por dar, não submete", async () => {
    completo();
    linhas["fecho_proposta"] = [
      { tcAceitacao: true, propostaAceitacao: true, declaracaoVeracidade: false },
    ];

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

  /**
   * A quinta trava, e é a que fecha o caminho de trás.
   *
   * O `guardarPasso` já exige o código antes de escrever a rubrica, mas o
   * `submeter` é uma Server Action à parte e chamável por si. Um processo com
   * uma rubrica de outro dia na tabela e nenhuma verificação válida agora não
   * pode passar por aqui só porque a linha já lá estava.
   */
  it("sem verificação por email válida, não submete", async () => {
    completo();
    linhas.codigo_otp = [];

    const r = await submeter(TOKEN);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.erros)).toEqual(["otp"]);
    expect(escritas("update")).toHaveLength(0);
  });
});

/* ── o código de verificação ──────────────────────────────────────────── */

describe("enviarCodigoOtp", () => {
  beforeEach(() => {
    linhas.dados_identificacao = [{ email: "maria@exemplo.pt", nome: "Maria Silva" }];
    linhas.dados_faturacao = [];
    linhas.codigo_otp = [];
  });

  it("grava o hash — nunca o código — e manda o email", async () => {
    const r = await enviarCodigoOtp(TOKEN);

    expect(r.ok).toBe(true);
    const linha = valoresDe("insert", "codigo_otp");
    expect(linha).toMatchObject({ processoId: "proc-1", enviadoPara: "maria@exemplo.pt" });
    // Sessenta e quatro hexadecimais, e nenhuma coluna com o código em claro.
    expect(String(linha?.codigoHash)).toMatch(/^[0-9a-f]{64}$/);
    expect(linha).not.toHaveProperty("codigo");
    expect(enviados).toEqual([{ para: "maria@exemplo.pt", template: "otp" }]);
  });

  /**
   * O endereço vai mascarado para o ecrã. O cliente já sabe qual é o seu — não
   * lhe esconde nada —, mas um link reencaminhado não pode dizer a quem o abrir
   * para onde é que o código está a ir.
   */
  it("devolve o destino mascarado, e não o endereço inteiro", async () => {
    const r = await enviarCodigoOtp(TOKEN);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.para).not.toContain("maria");
    expect(r.para.endsWith("@exemplo.pt")).toBe(true);
  });

  /**
   * Sem intervalo, o botão "Enviar código" é um botão para mandar emails a
   * partir do domínio da sociedade — em nome dela e à custa da quota dela.
   */
  it("não deixa pedir dois códigos no mesmo minuto", async () => {
    linhas.codigo_otp = [
      { expiraEm: new Date(AGORA.getTime() + 9 * 60_000), verificadoEm: null, tentativas: 0, criadoEm: new Date(AGORA.getTime() - 10_000) },
    ];

    const r = await enviarCodigoOtp(TOKEN);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.esperarSegundos).toBe(50);
    expect(operacoes).toHaveLength(0);
    expect(enviados).toHaveLength(0);
  });

  it("sem endereço no processo, diz onde é que ele se põe", async () => {
    linhas.dados_identificacao = [];
    acesso = {
      estado: "ok",
      processo: processo({ emailCliente: null }) as never,
      token: TOKEN,
    };

    const r = await enviarCodigoOtp(TOKEN);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("passo 1");
    expect(operacoes).toHaveLength(0);
  });

  it("um processo já submetido não pede códigos", async () => {
    acesso = { estado: "ok", processo: processo({ estado: "submetido" }) as never, token: TOKEN };

    expect((await enviarCodigoOtp(TOKEN)).ok).toBe(false);
    expect(operacoes).toHaveLength(0);
  });

  /** O código nunca entra em auditoria: é um segredo de dez minutos num registo que dura sete anos. */
  it("audita o pedido sem o código lá dentro", async () => {
    await enviarCodigoOtp(TOKEN);

    expect(auditados.map((e) => e.acao)).toEqual(["otp.enviado"]);
    expect(JSON.stringify(auditados)).not.toContain("codigo:");
    expect(auditados[0].valorNovo).toEqual({ para: "maria@exemplo.pt" });
  });
});

describe("verificarCodigoOtp", () => {
  const CODIGO = "482913";
  const hashDe = (codigo: string) =>
    createHash("sha256").update(`proc-1:${codigo}`, "utf8").digest("hex");

  const pendente = (extra: Linha = {}) => {
    linhas.codigo_otp = [
      {
        id: "otp-1",
        codigoHash: hashDe(CODIGO),
        enviadoPara: "maria@exemplo.pt",
        expiraEm: new Date(AGORA.getTime() + 5 * 60_000),
        tentativas: 0,
        verificadoEm: null,
        criadoEm: AGORA,
        ...extra,
      },
    ];
  };

  it("aceita o código certo, marca-o e deixa rasto", async () => {
    pendente();

    const r = await verificarCodigoOtp(TOKEN, CODIGO);

    expect(r.ok).toBe(true);
    expect(valoresDe("update", "codigo_otp")).toMatchObject({ verificadoEm: AGORA });
    expect(auditados.map((e) => e.acao)).toEqual(["otp.verificado"]);
  });

  /** Espaços colados na cópia são formatação, não engano: não valem uma tentativa. */
  it("ignora a formatação de quem cola o código do email", async () => {
    pendente();
    expect((await verificarCodigoOtp(TOKEN, " 482 913 ")).ok).toBe(true);
  });

  it("conta a tentativa falhada, diz quantas restam e não verifica nada", async () => {
    pendente({ tentativas: 2 });

    const r = await verificarCodigoOtp(TOKEN, "000000");

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("Restam 2 tentativas");
    expect(valoresDe("update", "codigo_otp")).toEqual({ tentativas: 3 });
    expect(auditados.map((e) => e.acao)).toEqual(["otp.falhado"]);
  });

  it("ao fim de cinco tentativas o código morre", async () => {
    pendente({ tentativas: 5 });

    const r = await verificarCodigoOtp(TOKEN, CODIGO);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("bloqueado");
    // Nem sequer se compara: um código bloqueado não é um código.
    expect(operacoes).toHaveLength(0);
  });

  it("um código expirado manda pedir outro", async () => {
    pendente({ expiraEm: new Date(AGORA.getTime() - 1_000) });

    const r = await verificarCodigoOtp(TOKEN, CODIGO);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("expirou");
  });

  it("sem código pedido, diz o que fazer em vez de dizer que está errado", async () => {
    linhas.codigo_otp = [];

    const r = await verificarCodigoOtp(TOKEN, CODIGO);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("Enviar código");
  });

  it("um código com menos de seis dígitos não gasta tentativa", async () => {
    pendente();

    const r = await verificarCodigoOtp(TOKEN, "4829");

    expect(r.ok).toBe(false);
    expect(operacoes).toHaveLength(0);
  });
});

describe("submeter — com tudo no sítio", () => {
  beforeEach(() => {
    linhas["fecho_proposta"] = [
      { tcAceitacao: true, propostaAceitacao: true, declaracaoVeracidade: true },
    ];
    linhas["assinatura"] = [{ imagemDados: RUBRICA }];
    linhas["dados_identificacao"] = [{ email: "maria@exemplo.pt", nome: "Maria Silva" }];
    linhas["dados_faturacao"] = [];
  });

  it("fecha o processo com a hora do servidor e passa a aguardar aprovação", async () => {
    const r = await submeter(TOKEN);

    expect(r).toEqual({ ok: true, proximo: null });
    expect(valoresDe("update", "processo_onboarding")).toEqual({
      estado: "aguardar_aprovacao",
      submetidoEm: AGORA,
    });
    expect(auditados.map((e) => e.acao)).toEqual(["processo.submetido"]);
    expect(auditados[0]?.valorAnterior).toEqual({ estado: "rascunho" });
    expect(auditados[0]?.valorNovo).toEqual({ estado: "aguardar_aprovacao" });
  });

  /**
   * As boas-vindas já não saem aqui — passam a sair quando o processo é
   * aprovado no back-office (`aprovarProcesso`, em `features/processos/acoes.ts`).
   * Na submissão só saem a confirmação de receção ao cliente e o aviso interno.
   */
  it("sai a confirmação ao cliente e o aviso ao back-office — sem boas-vindas", async () => {
    await submeter(TOKEN);

    expect(enviados.map((e) => e.template)).toEqual([
      "confirmacao_rececao",
      "notificacao_backoffice",
    ]);
    expect(enviados.map((e) => e.para)).toEqual(["maria@exemplo.pt", "equipa@jmassano.pt"]);
  });

  it("sem email na identificação, vale o da faturação", async () => {
    linhas["dados_identificacao"] = [];
    linhas["dados_faturacao"] = [{ email: "faturacao@exemplo.pt" }];

    await submeter(TOKEN);

    expect(enviados.map((e) => e.para)).toEqual(["faturacao@exemplo.pt", "equipa@jmassano.pt"]);
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
    expect(valoresDe("update", "processo_onboarding")).toMatchObject({
      estado: "aguardar_aprovacao",
    });
    expect(auditados.map((e) => e.acao)).toEqual(["processo.submetido"]);
  });

  it("o arquivo em SFTP a rebentar não desfaz a submissão", async () => {
    arquivoRebenta = true;

    const r = await submeter(TOKEN);

    expect(r).toEqual({ ok: true, proximo: null });
    expect(arquivados).toEqual([]);
  });
});
