import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { processoOnboarding } from "@/db/schema/processo";
import { organizacao, utilizador } from "@/db/schema/organizacao";
import { dadosFiscais, dadosIdentificacao } from "@/db/schema/seccoes";
import { vi } from "vitest";

/**
 * BUG3-001: o `gestor` via zero processos.
 *
 * `listarProcessos`/`facetas` aceitavam um `gestorId` opcional que filtrava por
 * `exists (select 1 from utilizador where utilizador.id = processo.responsavel_id
 * and (utilizador.gestor_id = :gestorId or utilizador.id = :gestorId))` — e
 * `responsavel_id` nunca chegou a ser escrito por caminho nenhum do produto (218
 * processos em produção, 0 com responsável). Um `exists` sobre uma coluna sempre
 * `NULL` nunca é verdadeiro, e a página do gestor ficava sempre vazia.
 *
 * A correção não é escrever `responsavel_id` — é tratar o `gestor` como o que
 * ele é na sociedade: equipa que trabalha os processos, tal como `society_admin`
 * e `utilizador`. `listarProcessos`/`facetas` deixaram de aceitar `gestorId` de
 * todo, e a página (`processos/page.tsx`) já não o passa.
 *
 * Corre contra um Postgres real (PGlite) e não contra um mock de `db()` que
 * ignora o `where` — o defeito estava exatamente na condição SQL, e um mock que
 * a ignora não teria apanhado nem o bug nem a regressão.
 */

let client: PGlite;
let dbTeste: ReturnType<typeof drizzle>;

vi.mock("@/db", () => ({
  db: () => dbTeste,
}));

const { listarProcessos, facetas } = await import("./consultas");

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";

async function semear() {
  await client.exec("delete from processo_onboarding");
  await client.exec("delete from organizacao");
  await client.exec("delete from utilizador");

  await dbTeste.insert(organizacao).values([
    { id: ORG_A, nome: "Sociedade A", nif: "500000001", prefixoReferencia: "SA" },
    { id: ORG_B, nome: "Sociedade B", nif: "500000002", prefixoReferencia: "SB" },
  ]);

  // Três processos na sociedade A, todos sem responsavel_id — o estado real em
  // produção — e um na sociedade B, para confirmar que o isolamento por
  // organização continua intacto sem o filtro de gestor.
  await dbTeste.insert(processoOnboarding).values([
    {
      organizacaoId: ORG_A,
      referencia: "SA-2026-0001",
      tipoCliente: "particular",
      estado: "rascunho",
      tokenAcessoHash: "hash-1",
      responsavelId: null,
    },
    {
      organizacaoId: ORG_A,
      referencia: "SA-2026-0002",
      tipoCliente: "particular",
      estado: "pendente_cliente",
      tokenAcessoHash: "hash-2",
      responsavelId: null,
    },
    {
      organizacaoId: ORG_A,
      referencia: "SA-2026-0003",
      tipoCliente: "empresa",
      estado: "aprovado",
      tokenAcessoHash: "hash-3",
      responsavelId: null,
    },
    {
      organizacaoId: ORG_B,
      referencia: "SB-2026-0001",
      tipoCliente: "particular",
      estado: "rascunho",
      tokenAcessoHash: "hash-4",
      responsavelId: null,
    },
  ]);
}

describe("BUG3-001: gestor vê os processos da sociedade", () => {
  beforeAll(async () => {
    client = new PGlite();
    await client.exec(`
      create table organizacao (
        id uuid primary key,
        nome text not null,
        nif text not null,
        prefixo_referencia text not null,
        natureza_juridica text,
        numero_ordem text,
        email_geral text,
        telefone text,
        website text,
        morada text,
        pais text,
        localidade text,
        codigo_postal text,
        freguesia text,
        concelho text,
        distrito text,
        termos_documento_ref text,
        termos_versao text,
        termos_atualizado_em timestamptz,
        email_remetente text,
        dominio_email text,
        dominio_resend_id text,
        dominio_verificado_em timestamptz,
        dominio_estado text,
        logotipo_dados text,
        logotipo_mime text,
        logotipo_nome text,
        logotipo_atualizado_em timestamptz,
        notificar_submissoes_email boolean not null default false,
        apagado_em timestamptz,
        criado_em timestamptz not null default now(),
        atualizado_em timestamptz not null default now()
      );
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
      create table processo_onboarding (
        id uuid primary key,
        organizacao_id uuid not null,
        referencia text not null,
        tipo_cliente text not null,
        nome_cliente text,
        nif_cliente text,
        email_cliente text,
        estado text not null default 'rascunho',
        passo_atual smallint not null default 1,
        responsavel_id uuid,
        nivel_risco text not null default 'baixo',
        fatores_risco jsonb not null default '[]',
        token_acesso_hash text not null,
        expira_em timestamptz,
        submetido_em timestamptz,
        aprovado_em timestamptz,
        aprovado_por uuid,
        motivo_rejeicao text,
        pesquisa tsvector,
        criado_em timestamptz not null default now(),
        atualizado_em timestamptz not null default now(),
        apagado_em timestamptz
      );
      create table dados_identificacao (
        id uuid primary key,
        processo_id uuid,
        nome text
      );
      create table dados_fiscais (
        id uuid primary key,
        processo_id uuid,
        nif text
      );
    `);
    dbTeste = drizzle(client, {
      schema: { processoOnboarding, organizacao, utilizador, dadosIdentificacao, dadosFiscais },
    });
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await semear();
  });

  it("listarProcessos devolve os processos da sociedade mesmo sem responsavel_id", async () => {
    const { linhas, total } = await listarProcessos({}, ORG_A);

    expect(total).toBe(3);
    expect(linhas.map((l) => l.referencia).sort()).toEqual([
      "SA-2026-0001",
      "SA-2026-0002",
      "SA-2026-0003",
    ]);
    // Isolamento por sociedade continua a valer sem o filtro de gestor.
    expect(linhas.some((l) => l.referencia === "SB-2026-0001")).toBe(false);
  });

  it("facetas conta os processos da sociedade, sem depender de responsavel_id", async () => {
    const { porEstado } = await facetas(ORG_A);
    const total = porEstado.reduce((soma, e) => soma + Number(e.n), 0);
    expect(total).toBe(3);
  });

  it("listarProcessos aceita só (filtros, organizacaoId) — não há gestorId para filtrar", async () => {
    // A assinatura antiga aceitava um terceiro parâmetro opcional
    // `{ gestorId }`; não existe mais — passá-lo não teria efeito nenhum, o
    // que já não é o comportamento a testar. Confirma-se a assinatura nova.
    expect(listarProcessos.length).toBe(2);
    expect(facetas.length).toBe(1);
  });
});
