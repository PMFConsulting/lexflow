import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { utilizador } from "@/db/schema/organizacao";

/**
 * Isolamento de equipas: um gestor não pode ver os utilizadores associados a
 * outro gestor, mesmo dentro da mesma sociedade.
 *
 * Corre contra um Postgres real (PGlite), como `gestor-processos.test.ts` —
 * o `where` é a própria condição a testar, e um mock de `db()` que o ignora
 * não apanharia uma fuga de isolamento.
 */

let client: PGlite;
let dbTeste: ReturnType<typeof drizzle>;

vi.mock("@/db", () => ({
  db: () => dbTeste,
}));

const { listarUtilizadoresDoGestor } = await import("./consultas");

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const GESTOR_A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GESTOR_B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_A1_ID = "c0000000-0000-4000-8000-0000000000a1";
const USER_A2_ID = "c0000000-0000-4000-8000-0000000000a2";
const USER_B1_ID = "c0000000-0000-4000-8000-0000000000b1";

async function semear() {
  await client.exec("delete from utilizador");

  await dbTeste.insert(utilizador).values([
    {
      id: GESTOR_A_ID,
      organizacaoId: ORG_ID,
      nome: "Gestor A",
      email: "gestor.a@sociedade.pt",
      papel: "gestor",
      gestorId: null,
    },
    {
      id: GESTOR_B_ID,
      organizacaoId: ORG_ID,
      nome: "Gestor B",
      email: "gestor.b@sociedade.pt",
      papel: "gestor",
      gestorId: null,
    },
    {
      id: USER_A1_ID,
      organizacaoId: ORG_ID,
      nome: "Utilizador A1",
      email: "a1@sociedade.pt",
      papel: "utilizador",
      gestorId: GESTOR_A_ID,
    },
    {
      id: USER_A2_ID,
      organizacaoId: ORG_ID,
      nome: "Utilizador A2",
      email: "a2@sociedade.pt",
      papel: "utilizador",
      gestorId: GESTOR_A_ID,
    },
    {
      id: USER_B1_ID,
      organizacaoId: ORG_ID,
      nome: "Utilizador B1",
      email: "b1@sociedade.pt",
      papel: "utilizador",
      gestorId: GESTOR_B_ID,
    },
  ]);
}

describe("Isolamento de equipas entre gestores", () => {
  beforeAll(async () => {
    client = new PGlite();
    await client.exec(`
      create table utilizador (
        id uuid primary key,
        organizacao_id uuid,
        auth_user_id text,
        nome text not null,
        email text not null,
        papel text not null default 'utilizador',
        gestor_id uuid,
        aprovado_em timestamptz,
        ativo boolean not null default true,
        deve_redefinir_password boolean not null default false,
        apagado_em timestamptz,
        criado_em timestamptz not null default now(),
        atualizado_em timestamptz not null default now()
      );
    `);
    dbTeste = drizzle(client, { schema: { utilizador } });
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await semear();
  });

  it("listarUtilizadoresDoGestor(gestorA) devolve só os utilizadores do gestor A", async () => {
    const membros = await listarUtilizadoresDoGestor(GESTOR_A_ID, ORG_ID);

    expect(membros.map((m) => m.id).sort()).toEqual([USER_A1_ID, USER_A2_ID].sort());
    expect(membros.some((m) => m.id === USER_B1_ID)).toBe(false);
  });

  it("gestor B, a chamar com o próprio id, não vê a equipa do gestor A", async () => {
    const membros = await listarUtilizadoresDoGestor(GESTOR_B_ID, ORG_ID);

    expect(membros.map((m) => m.id)).toEqual([USER_B1_ID]);
    expect(membros.some((m) => m.id === USER_A1_ID || m.id === USER_A2_ID)).toBe(false);
  });
});

/**
 * `listarUtilizadoresDoGestor` aceita um `gestorId` externo — não valida por
 * si só que quem chama é esse gestor. O isolamento entre equipas depende de
 * o único sítio que a chama nunca lhe passar um id vindo do cliente, só o
 * `eu.id` resolvido na sessão do servidor.
 *
 * Não há Server Action nem rota de API a expor esta função (confirmado por
 * grep a todo o `src/`) — o único chamador é a página `/equipa`, um Server
 * Component. Este teste é sobre o texto do ficheiro e não sobre
 * comportamento em runtime, na mesma lógica de `conclusao.test.ts`: o que se
 * quer impedir é que uma futura reescrita da página passe a aceitar um id de
 * gestor por `searchParams` ou por parâmetro de rota, e isto chega para o
 * apanhar sem montar um Server Component em teste.
 */
describe("a página /equipa nunca invoca listarUtilizadoresDoGestor com um id externo", () => {
  const fontePagina = readFileSync(
    fileURLToPath(new URL("../../app/(backoffice)/equipa/page.tsx", import.meta.url)),
    "utf8",
  );

  it("chama sempre com eu.id, resolvido na sessão do servidor", () => {
    expect(fontePagina).toMatch(/listarUtilizadoresDoGestor\(\s*eu\.id\s*,\s*eu\.organizacaoId\s*\)/);
  });

  it("a página não lê searchParams nem params de rota (não há id de gestor vindo do cliente)", () => {
    expect(fontePagina).not.toMatch(/searchParams/);
    expect(fontePagina.match(/export default async function EquipaDoGestorPage\(([^)]*)\)/)?.[1].trim()).toBe("");
  });
});
