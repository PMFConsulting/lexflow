import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { notificacao } from "@/db/schema/notificacao";
import { marcarNotificacaoComoLida, marcarTodasComoLidas } from "./acoes";

/**
 * R2-05 (pentest ronda 2): um utilizador normal, com sessão de sociedade,
 * conseguia marcar como lidas notificações GLOBAIS (`organizacao_id IS NULL`)
 * dirigidas ao `super_admin` — o `where` só olhava para `organizacaoId`, nunca
 * para `paraPapel`. Um utilizador conseguia assim esconder avisos da
 * administração da plataforma de quem os devia ver.
 *
 * Corre contra um Postgres real (PGlite, em WASM) e não contra um mock de
 * `db()` que devolve sempre a tabela inteira: o defeito estava exatamente na
 * cláusula `where`, e um mock que a ignora não teria apanhado nem o bug nem a
 * regressão.
 */

let client: PGlite;
let dbTeste: ReturnType<typeof drizzle>;
let sessaoMock: { conta: { id: string; email: string }; eu: { id: string; papel: string; organizacaoId: string | null } } | null = null;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "127.0.0.1", "user-agent": "vitest" }),
}));

vi.mock("@/lib/sessao", () => ({
  eSuperAdmin: (papel: string) => papel === "super_admin",
  exigirSessao: async () => {
    if (!sessaoMock) throw new Error("Sem sessão");
    return sessaoMock;
  },
  exigirSocietyAdmin: async () => {
    if (!sessaoMock || sessaoMock.eu.papel !== "society_admin") throw new Error("Não é society_admin");
    return sessaoMock;
  },
}));

vi.mock("@/db", () => ({
  db: () => dbTeste,
}));

const ORG_A = "11111111-1111-1111-1111-111111111111";

async function semear() {
  await client.exec("delete from notificacao");
  await dbTeste.insert(notificacao).values([
    { organizacaoId: ORG_A, paraPapel: null, titulo: "Da minha sociedade", corpo: "x" },
    { organizacaoId: null, paraPapel: "super_admin", titulo: "HUNT-R2 alerta plataforma", corpo: "x" },
    { organizacaoId: null, paraPapel: null, titulo: "Difusão geral", corpo: "x" },
  ]);
}

async function estados() {
  const linhas = await dbTeste.select().from(notificacao);
  return Object.fromEntries(linhas.map((l) => [l.titulo, l.lidaEm !== null]));
}

describe("R2-05: IDOR em notificações globais (marcar como lida)", () => {
  beforeAll(async () => {
    client = new PGlite();
    await client.exec(`
      create table notificacao (
        id uuid primary key,
        organizacao_id uuid,
        para_papel text,
        titulo text not null,
        corpo text not null,
        link text,
        lida_em timestamptz,
        criado_em timestamptz not null default now()
      );
    `);
    dbTeste = drizzle(client, { schema: { notificacao } });
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    sessaoMock = null;
    await semear();
  });

  it("um utilizador normal não marca como lida a notificação global do super_admin (PoC do Norbert)", async () => {
    sessaoMock = {
      conta: { id: "u-1", email: "utilizador@pmf.pt" },
      eu: { id: "u-1", papel: "utilizador", organizacaoId: ORG_A },
    };

    const res = await marcarTodasComoLidas();
    expect(res.ok).toBe(true);

    const lidas = await estados();
    expect(lidas["Da minha sociedade"]).toBe(true);
    expect(lidas["Difusão geral"]).toBe(true);
    // A prova do fix: isto tinha de ficar `false` — a PoC do Norbert marcava-a como lida.
    expect(lidas["HUNT-R2 alerta plataforma"]).toBe(false);
  });

  it("o mesmo se aplica a marcar uma notificação individual como lida por id", async () => {
    sessaoMock = {
      conta: { id: "u-1", email: "utilizador@pmf.pt" },
      eu: { id: "u-1", papel: "utilizador", organizacaoId: ORG_A },
    };

    const linhas = await dbTeste.select().from(notificacao);
    const alvoId = linhas.find((r) => r.titulo === "HUNT-R2 alerta plataforma")!.id;

    const res = await marcarNotificacaoComoLida(alvoId);
    expect(res.ok).toBe(true);

    const lidas = await estados();
    expect(lidas["HUNT-R2 alerta plataforma"]).toBe(false);
  });

  it("o super_admin continua a poder marcar a notificação global como lida", async () => {
    sessaoMock = {
      conta: { id: "sa-1", email: "dono@plataforma.pt" },
      eu: { id: "sa-1", papel: "super_admin", organizacaoId: null },
    };

    const res = await marcarTodasComoLidas();
    expect(res.ok).toBe(true);

    const lidas = await estados();
    expect(lidas["HUNT-R2 alerta plataforma"]).toBe(true);
    expect(lidas["Da minha sociedade"]).toBe(true);
    expect(lidas["Difusão geral"]).toBe(true);
  });
});
