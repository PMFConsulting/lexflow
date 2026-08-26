import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O logótipo da sociedade carregado **durante o registo**, sem sessão nenhuma.
 *
 * O que estes testes fixam não é a validação da imagem — essa é a mesma do
 * percurso de gestão e está coberta em `administracao/logotipo.test.ts`. É o que
 * muda quando a autenticação deixa de ser uma sessão e passa a ser um token:
 *
 *  · quem escolhe a organização de destino é o token, e não o `FormData` — um
 *    `organizacaoId` colado no pedido não pode ir parar ao `where`;
 *  · um link expirado, apagado ou já submetido não escreve nada;
 *  · e o que corre **depois** da gravação (auditoria, revalidação) não pode
 *    desfazê-la nem transformá-la num erro no ecrã (D46).
 */

type Escrita = Record<string, unknown>;

const ORG = { id: "org-1", nome: "Andrade & Costa" };

let acessoDevolve: "ok" | "desconhecido" | "expirado" | "concluido" = "ok";
let orgsNaBase: Escrita[] = [];
const atualizacoes: Escrita[] = [];
const auditados: { acao: string; valorAnterior?: unknown; valorNovo?: unknown }[] = [];
const revalidados: string[] = [];

let auditoriaRebenta = false;
let revalidacaoRebenta = false;
let cabecalhosRebentam = false;

vi.mock("next/cache", () => ({
  revalidatePath: (caminho: string) => {
    if (revalidacaoRebenta) throw new Error("revalidatePath fora de contexto");
    revalidados.push(caminho);
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => {
    if (cabecalhosRebentam) throw new Error("headers() fora de um pedido");
    return new Headers({ "x-forwarded-for": "1.2.3.4", "user-agent": "vitest" });
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c,
  eq: (coluna: unknown, valor: unknown) => ({ coluna, valor }),
  isNull: (c: unknown) => c,
  sql: (...c: unknown[]) => c,
}));

vi.mock("@/db/schema/organizacao", () => ({
  organizacao: {
    id: "organizacao.id",
    logotipoDados: "logotipo_dados",
    logotipoMime: "logotipo_mime",
    logotipoNome: "logotipo_nome",
    logotipoAtualizadoEm: "logotipo_atualizado_em",
  },
}));

/** O `where` do UPDATE, guardado para se poder afirmar em que organização caiu. */
const alvos: { coluna: unknown; valor: unknown }[] = [];

vi.mock("@/db", () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => orgsNaBase }),
      }),
    }),
    update: () => ({
      set: (v: Escrita) => ({
        where: async (condicao: { coluna: unknown; valor: unknown }) => {
          atualizacoes.push(v);
          alvos.push(condicao);
        },
      }),
    }),
  }),
}));

vi.mock("./dados", () => ({
  acessoSociedadePorToken: async () => {
    if (acessoDevolve === "desconhecido") return { estado: "desconhecido" };
    if (acessoDevolve === "expirado") {
      return { estado: "expirado", nome: ORG.nome, expirouEm: new Date("2026-01-01") };
    }
    if (acessoDevolve === "concluido") return { estado: "concluido", nome: ORG.nome };
    // O token que a função devolve é o **normalizado** (D47): é ele que tem de
    // formar o caminho da revalidação, e não o que o cliente enviou.
    return { estado: "ok", org: ORG, onboarding: { estado: "rascunho" }, token: "token-limpo" };
  },
}));

vi.mock("@/features/auditoria/registar", () => ({
  registarEvento: async (e: { acao: string }) => {
    if (auditoriaRebenta) throw new Error("a cadeia de auditoria recusou o evento");
    auditados.push(e);
  },
}));

const { guardarLogotipoOnboarding, removerLogotipoOnboarding } = await import(
  "./logotipo-onboarding"
);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const PDF = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n");

/** O token que o cliente envia — de propósito diferente do normalizado. */
const TOKEN_BRUTO = "  token-limpo.  ";

function pedido(ficheiro: File, extra?: Record<string, string>) {
  const fd = new FormData();
  fd.set("logotipo", ficheiro);
  for (const [k, v] of Object.entries(extra ?? {})) fd.set(k, v);
  return fd;
}

const ficheiroPng = (nome = "marca.png", bytes: Uint8Array = PNG) =>
  new File([bytes as BlobPart], nome, { type: "image/png" });

beforeEach(() => {
  acessoDevolve = "ok";
  orgsNaBase = [
    { id: ORG.id, logotipoNome: null, logotipoMime: null, logotipoAtualizadoEm: null },
  ];
  atualizacoes.length = 0;
  alvos.length = 0;
  auditados.length = 0;
  revalidados.length = 0;
  auditoriaRebenta = false;
  revalidacaoRebenta = false;
  cabecalhosRebentam = false;
});

describe("guardarLogotipoOnboarding — o token é que autentica", () => {
  it("recusa um token desconhecido sem escrever nada", async () => {
    acessoDevolve = "desconhecido";
    const r = await guardarLogotipoOnboarding(TOKEN_BRUTO, pedido(ficheiroPng()));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensagem).toMatch(/já não é válido/i);
    expect(atualizacoes).toHaveLength(0);
    expect(auditados).toHaveLength(0);
  });

  it("recusa um link expirado sem escrever nada", async () => {
    acessoDevolve = "expirado";
    const r = await guardarLogotipoOnboarding(TOKEN_BRUTO, pedido(ficheiroPng()));

    expect(r.ok).toBe(false);
    expect(atualizacoes).toHaveLength(0);
  });

  it("recusa um registo já submetido, e manda a pessoa ao sítio certo", async () => {
    acessoDevolve = "concluido";
    const r = await guardarLogotipoOnboarding(TOKEN_BRUTO, pedido(ficheiroPng()));

    expect(r.ok).toBe(false);
    // Não é a mesma frase do link inválido: aqui o link está bom e o que mudou
    // foi o estado do registo — e a saída é a área de Administração.
    if (!r.ok) expect(r.mensagem).toMatch(/Administração/);
    expect(atualizacoes).toHaveLength(0);
  });
});

describe("guardarLogotipoOnboarding — o ficheiro", () => {
  it("recusa um ficheiro acima de 2 MB, dizendo o tamanho que tem", async () => {
    const grande = new File([new Uint8Array(2 * 1024 * 1024 + 1) as BlobPart], "enorme.png", {
      type: "image/png",
    });
    const r = await guardarLogotipoOnboarding(TOKEN_BRUTO, pedido(grande));

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erros.logotipo?.[0]).toMatch(/2\.0 MB/);
      expect(r.erros.logotipo?.[0]).toMatch(/máximo permitido são 2 MB/);
    }
    expect(atualizacoes).toHaveLength(0);
  });

  it("recusa um formato não suportado", async () => {
    const gif = new File([PNG as BlobPart], "animacao.gif", { type: "image/gif" });
    const r = await guardarLogotipoOnboarding(TOKEN_BRUTO, pedido(gif));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.logotipo?.[0]).toMatch(/formato não suportado/i);
    expect(atualizacoes).toHaveLength(0);
  });

  it("recusa um PDF disfarçado de PNG — o nome e o MIME são do browser, os bytes não", async () => {
    const disfarcado = new File([PDF as BlobPart], "marca.png", { type: "image/png" });
    const r = await guardarLogotipoOnboarding(TOKEN_BRUTO, pedido(disfarcado));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.logotipo?.[0]).toMatch(/não corresponde ao formato/i);
    expect(atualizacoes).toHaveLength(0);
  });

  it("recusa um ficheiro vazio", async () => {
    const vazio = new File([], "marca.png", { type: "image/png" });
    const r = await guardarLogotipoOnboarding(TOKEN_BRUTO, pedido(vazio));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.logotipo?.[0]).toMatch(/Escolha um ficheiro/i);
    expect(atualizacoes).toHaveLength(0);
  });

  it("aceita um SVG cujo conteúdo é mesmo SVG", async () => {
    const svg = new File(
      [new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>') as BlobPart],
      "marca.svg",
      { type: "image/svg+xml" },
    );
    const r = await guardarLogotipoOnboarding(TOKEN_BRUTO, pedido(svg));

    expect(r.ok).toBe(true);
    expect(atualizacoes[0]?.logotipoMime).toBe("image/svg+xml");
  });

  it("guarda o PNG em base64, com mime e nome, e audita a alteração", async () => {
    const r = await guardarLogotipoOnboarding(TOKEN_BRUTO, pedido(ficheiroPng()));

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.nome).toBe("marca.png");

    const escrita = atualizacoes[0];
    expect(escrita?.logotipoMime).toBe("image/png");
    expect(escrita?.logotipoNome).toBe("marca.png");
    expect(escrita?.logotipoDados).toBe(Buffer.from(PNG).toString("base64"));
    expect(escrita?.logotipoAtualizadoEm).toBeInstanceOf(Date);

    expect(auditados.map((e) => e.acao)).toEqual(["sociedade.logotipo_alterado"]);
  });
});

describe("guardarLogotipoOnboarding — isolamento e revalidação", () => {
  it("escreve na organização do token, e ignora um organizacaoId enviado no pedido", async () => {
    const r = await guardarLogotipoOnboarding(
      TOKEN_BRUTO,
      pedido(ficheiroPng(), { organizacaoId: "org-de-outra-sociedade" }),
    );

    expect(r.ok).toBe(true);
    expect(alvos).toHaveLength(1);
    expect(alvos[0]?.valor).toBe("org-1");
    expect(JSON.stringify(alvos)).not.toContain("org-de-outra-sociedade");
  });

  it("revalida com o token normalizado, e não com o que veio do cliente", async () => {
    await guardarLogotipoOnboarding(TOKEN_BRUTO, pedido(ficheiroPng()));

    expect(revalidados).toEqual(["/sociedade/token-limpo"]);
  });
});

describe("guardarLogotipoOnboarding — nada depois da gravação a desfaz (D46)", () => {
  it("a auditoria a rebentar não transforma uma gravação boa num erro no ecrã", async () => {
    auditoriaRebenta = true;
    const r = await guardarLogotipoOnboarding(TOKEN_BRUTO, pedido(ficheiroPng()));

    expect(r.ok).toBe(true);
    expect(atualizacoes).toHaveLength(1);
  });

  it("o `headers()` a rebentar também não", async () => {
    cabecalhosRebentam = true;
    const r = await guardarLogotipoOnboarding(TOKEN_BRUTO, pedido(ficheiroPng()));

    expect(r.ok).toBe(true);
    expect(atualizacoes).toHaveLength(1);
  });

  it("o `revalidatePath` a rebentar também não", async () => {
    revalidacaoRebenta = true;
    const r = await guardarLogotipoOnboarding(TOKEN_BRUTO, pedido(ficheiroPng()));

    expect(r.ok).toBe(true);
    expect(atualizacoes).toHaveLength(1);
  });
});

describe("removerLogotipoOnboarding", () => {
  it("recusa um token que não abre", async () => {
    acessoDevolve = "desconhecido";
    const r = await removerLogotipoOnboarding(TOKEN_BRUTO);

    expect(r.ok).toBe(false);
    expect(atualizacoes).toHaveLength(0);
  });

  it("não inventa uma remoção quando não havia logótipo nenhum", async () => {
    const r = await removerLogotipoOnboarding(TOKEN_BRUTO);

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mensagem).toMatch(/Não havia logótipo/i);
    expect(atualizacoes).toHaveLength(0);
    // Um registo que a lei manda guardar sete anos não leva remoções que não
    // removeram nada.
    expect(auditados).toHaveLength(0);
  });

  it("põe as quatro colunas a null e audita a remoção", async () => {
    orgsNaBase = [
      {
        id: ORG.id,
        logotipoNome: "marca.png",
        logotipoMime: "image/png",
        logotipoAtualizadoEm: new Date("2026-08-20T10:00:00.000Z"),
      },
    ];

    const r = await removerLogotipoOnboarding(TOKEN_BRUTO);

    expect(r.ok).toBe(true);
    expect(atualizacoes[0]).toEqual({
      logotipoDados: null,
      logotipoMime: null,
      logotipoNome: null,
      logotipoAtualizadoEm: null,
    });
    expect(alvos[0]?.valor).toBe("org-1");

    expect(auditados).toHaveLength(1);
    expect(auditados[0]?.acao).toBe("sociedade.logotipo_removido");
    // O que lá estava fica escrito no evento: é o que uma revisão jurídica tem
    // de conseguir ler sem a imagem à frente.
    expect(auditados[0]?.valorAnterior).toMatchObject({
      nome: "marca.png",
      mime: "image/png",
    });
  });
});
