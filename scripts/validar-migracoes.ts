/**
 * Aplica todas as migrações a um Postgres efémero em WASM (PGlite) e verifica
 * o que elas deviam ter criado.
 *
 * Serve para apanhar erros de SQL sem precisar de servidor nenhum — as
 * migrações personalizadas (triggers, configuração de pesquisa, regras da
 * auditoria) são a parte que o drizzle-kit não valida por si.
 *
 *   pnpm db:validar
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";

const PASTA = join(process.cwd(), "src", "db", "migrations");

type Journal = { entries: { idx: number; tag: string }[] };

/**
 * O bloco é só comentários (e, portanto, não há nada para executar)?
 *
 * Isto era um `/^(--[^\n]*\n?)+$/`, e o grupo repetido sobre linhas com um
 * `\n?` opcional é a receita de backtracking catastrófico: num bloco de
 * comentários com uma dezena de linhas que *quase* casa — basta uma linha em
 * branco no fim para o `$` falhar —, o motor tenta todas as maneiras de
 * repartir o texto pelas repetições e o `pnpm db:validar` deixa de terminar. O
 * sintoma não aponta para aqui: o script fica parado imediatamente **antes** de
 * imprimir a primeira instrução da migração nova, e a leitura óbvia é que é a
 * migração que está mal.
 *
 * Linha a linha é linear e diz exatamente o mesmo.
 */
function soComentarios(bloco: string): boolean {
  return bloco
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .every((l) => l.startsWith("--"));
}

async function main() {
  const journal: Journal = JSON.parse(
    readFileSync(join(PASTA, "meta", "_journal.json"), "utf8"),
  );

  // `unaccent` não vem no build base do PGlite — no Supabase é `CREATE EXTENSION`.
  const db = new PGlite({ extensions: { unaccent } });
  await db.waitReady;

  for (const entrada of journal.entries) {
    const sql = readFileSync(join(PASTA, `${entrada.tag}.sql`), "utf8");
    const blocos = sql
      .split("--> statement-breakpoint")
      .map((b) => b.trim())
      .filter((b) => b.length > 0 && !soComentarios(b));

    for (const bloco of blocos) {
      try {
        await db.exec(bloco);
      } catch (e) {
        console.error(`\n✗ ${entrada.tag} falhou:\n`);
        console.error(bloco.slice(0, 400));
        console.error(`\n${(e as Error).message}\n`);
        process.exit(1);
      }
    }
    console.log(`✓ ${entrada.tag}`);
  }

  /* ------------------------------------------------ verificações do estado */

  const conta = async (sql: string) => {
    const r = await db.query<{ n: number }>(sql);
    return Number(r.rows[0]?.n ?? 0);
  };

  const tabelas = await conta(
    "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
  );
  const triggers = await conta(
    "select count(*)::int as n from pg_trigger where tgname like 'pesquisa_%'",
  );
  const regras = await conta(
    "select count(*)::int as n from pg_rules where tablename = 'evento_auditoria'",
  );
  const configs = await conta(
    "select count(*)::int as n from pg_ts_config where cfgname = 'pt_unaccent'",
  );

  console.log(`\nTabelas: ${tabelas}`);
  console.log(`Triggers de pesquisa: ${triggers}`);
  console.log(`Regras em evento_auditoria: ${regras}`);
  console.log(`Configuração de pesquisa pt_unaccent: ${configs}`);

  /* ---------------------------- a auditoria aceita mesmo só INSERT? ------- */

  await db.exec(`
    insert into evento_auditoria (id, organizacao_id, acao, entidade, hash)
    values (
      '01920000-0000-7000-8000-000000000001',
      '01920000-0000-7000-8000-0000000000aa',
      'teste.criado', 'teste', repeat('a', 64)
    );
  `);

  await db.exec("update evento_auditoria set acao = 'adulterado';");
  await db.exec("delete from evento_auditoria;");

  const restantes = await db.query<{ acao: string }>("select acao from evento_auditoria;");

  const falhas: string[] = [];
  if (restantes.rows.length !== 1) {
    falhas.push(`DELETE passou — restaram ${restantes.rows.length} linhas em vez de 1`);
  }
  if (restantes.rows[0]?.acao !== "teste.criado") {
    falhas.push(`UPDATE passou — a ação ficou "${restantes.rows[0]?.acao}"`);
  }

  console.log(
    falhas.length === 0
      ? "\nAuditoria: UPDATE e DELETE bloqueados, INSERT preservado."
      : `\nAuditoria NÃO é imutável:\n  · ${falhas.join("\n  · ")}`,
  );

  /* ------------------- a pesquisa é mesmo insensível a acentos? ----------- */

  await db.exec(`
    insert into organizacao (id, nome, nif, prefixo_referencia)
    values ('01920000-0000-7000-8000-0000000000bb', 'PMF Consulting', '500000000', 'PMF');

    insert into processo_onboarding (id, organizacao_id, referencia, tipo_cliente, token_acesso_hash)
    values (
      '01920000-0000-7000-8000-000000000002',
      '01920000-0000-7000-8000-0000000000bb',
      'PMF-2026-0142', 'particular', repeat('b', 64)
    );

    -- O id é gerado pela aplicação (uuidv7), não pela base de dados: o Postgres
    -- só tem uuidv7() nativo na v18. Em SQL cru tem de vir explícito.
    insert into dados_identificacao
      (id, processo_id, nome, telefone, email, morada, pais, localidade, codigo_postal, freguesia, concelho, distrito)
    values (
      '01920000-0000-7000-8000-000000000003',
      '01920000-0000-7000-8000-000000000002',
      'João Gonçalves Antunes', '+351912345678', 'joao@exemplo.pt',
      'Rua das Amoreiras 12', 'PT', 'Lisboa', '1250-096', 'Campolide', 'Lisboa', 'Lisboa'
    );
  `);

  const procura = async (termo: string) => {
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from processo_onboarding
       where pesquisa @@ to_tsquery('pt_unaccent', $1)`,
      [termo],
    );
    return Number(r.rows[0]?.n ?? 0);
  };

  const casos: [string, string][] = [
    ["goncalves", "sem acentos encontra com acentos"],
    ["gonçalves", "com acentos encontra"],
    ["JOAO", "maiúsculas encontram"],
    ["PMF-2026-0142", "referência encontra"],
  ];

  for (const [termo, descricao] of casos) {
    const n = await procura(termo);
    if (n !== 1) falhas.push(`pesquisa "${termo}" (${descricao}) devolveu ${n} em vez de 1`);
  }

  const inexistente = await procura("cardoso");
  if (inexistente !== 0) falhas.push(`pesquisa "cardoso" devolveu ${inexistente} em vez de 0`);

  if (falhas.length === 0) {
    console.log("Pesquisa: acentos, maiúsculas e referência resolvidos pelo trigger.");
  }

  await db.close();

  if (falhas.length > 0) {
    console.error(`\n${falhas.length} problema(s):`);
    for (const f of falhas) console.error(`  · ${f}`);
    process.exit(1);
  }

  console.log("\nMigrações válidas.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
