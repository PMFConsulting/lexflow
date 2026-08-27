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

const JOURNAL: Journal = JSON.parse(
  readFileSync(join(PASTA, "meta", "_journal.json"), "utf8"),
);

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

/** As instruções de uma migração, já sem os blocos que são só comentário. */
function instrucoes(tag: string) {
  return readFileSync(join(PASTA, `${tag}.sql`), "utf8")
    .split("--> statement-breakpoint")
    .map((b) => b.trim())
    .filter((b) => b.length > 0 && !soComentarios(b));
}

/**
 * Aplica as migrações do journal a uma base, opcionalmente até uma delas.
 *
 * O `ate` é o que permite construir uma base **no estado anterior** a uma
 * migração — sem isso não há como verificar o que ela faz aos dados que já lá
 * estavam, que é a única parte de uma migração que não se desfaz.
 */
async function aplicar(db: PGlite, { ate }: { ate?: number } = {}) {
  for (const entrada of JOURNAL.entries) {
    if (ate !== undefined && entrada.idx > ate) break;

    for (const bloco of instrucoes(entrada.tag)) {
      try {
        await db.exec(bloco);
      } catch (e) {
        console.error(`\n✗ ${entrada.tag} falhou:\n`);
        console.error(bloco.slice(0, 400));
        console.error(`\n${(e as Error).message}\n`);
        process.exit(1);
      }
    }
    if (ate === undefined) console.log(`✓ ${entrada.tag}`);
  }
}

/**
 * A `0017` sobre uma base com contas lá dentro.
 *
 * As outras verificações deste ficheiro olham para o **esquema**: existe a
 * tabela, existe o índice, a regra bloqueia o UPDATE. Esta olha para os
 * **dados**, e é a única parte de uma migração que não se desfaz — um esquema
 * errado corrige-se com outra migração, três contas mapeadas para o papel
 * errado são três pessoas que na segunda-feira entram e veem o sistema doutra
 * maneira.
 *
 * Por isso a base é construída no estado **anterior** à `0017` (até à `0015`),
 * povoada com a forma exata do que está em produção — três `admin` na PMF — mais
 * um de cada papel descontinuado, e só então é que a `0017` corre.
 *
 * E corre **duas vezes**: a segunda passagem é a prova de idempotência. Uma
 * migração de tipos que não se possa repetir é uma migração que não se pode
 * retomar depois de uma ligação cair a meio.
 */
async function validarPapeis(falhas: string[]) {
  const db = new PGlite({ extensions: { unaccent } });
  await db.waitReady;
  // A 0017 (papeis) corre sobre o estado que a 0016 (portais) deixa: é ela que
  // cria `convite_utilizador`, de que a 0017 depende. A base é povoada no
  // estado anterior à 0017 (até à 0016).
  await aplicar(db, { ate: 16 });

  await db.exec(`
    insert into organizacao (id, nome, nif, prefixo_referencia)
    values ('fe6c269c-5358-43f9-8a7e-ccade4778940', 'PMF Consulting', '500000000', 'PMF');

    insert into utilizador (id, organizacao_id, auth_user_id, nome, email, papel)
    values
      ('01920000-0000-7000-8000-000000000101', 'fe6c269c-5358-43f9-8a7e-ccade4778940', 'a1', 'Admin',    'admin@poc.pt',                'admin'),
      ('01920000-0000-7000-8000-000000000102', 'fe6c269c-5358-43f9-8a7e-ccade4778940', 'a2', 'Pedro',    'pedro@poc.pt',                'admin'),
      ('01920000-0000-7000-8000-000000000103', 'fe6c269c-5358-43f9-8a7e-ccade4778940', 'a3', 'Teste',    'teste@poc.terlicalabs.com',   'admin'),
      ('01920000-0000-7000-8000-000000000104', 'fe6c269c-5358-43f9-8a7e-ccade4778940', 'a4', 'Sócia',    'socio@pmf.local',             'socio'),
      ('01920000-0000-7000-8000-000000000105', 'fe6c269c-5358-43f9-8a7e-ccade4778940', 'a5', 'Advogado', 'advogado@pmf.local',          'advogado'),
      ('01920000-0000-7000-8000-000000000106', 'fe6c269c-5358-43f9-8a7e-ccade4778940', 'a6', 'Assist.',  'assistente@pmf.local',        'assistente');
  `);

  for (const passagem of [1, 2]) {
    for (const bloco of instrucoes("0017_papeis_plataforma")) {
      try {
        await db.exec(bloco);
      } catch (e) {
        falhas.push(
          `a 0017 falhou na passagem ${passagem} (não é idempotente): ${(e as Error).message}`,
        );
        await db.close();
        return;
      }
    }
  }

  const papeis = await db.query<{ email: string; papel: string }>(
    "select email, papel from utilizador order by email",
  );
  const obtido = Object.fromEntries(papeis.rows.map((l) => [l.email, l.papel]));

  const esperado: Record<string, string> = {
    "admin@poc.pt": "society_admin",
    "pedro@poc.pt": "society_admin",
    "teste@poc.terlicalabs.com": "society_admin",
    "socio@pmf.local": "utilizador",
    "advogado@pmf.local": "utilizador",
    "assistente@pmf.local": "utilizador",
  };

  for (const [email, papel] of Object.entries(esperado)) {
    if (obtido[email] !== papel) {
      falhas.push(`${email} ficou "${obtido[email]}" em vez de "${papel}"`);
    }
  }

  /* --- e as restrições novas mordem mesmo? ---------------------------------- */

  const recusa = async (descricao: string, sql: string) => {
    try {
      await db.exec(sql);
      falhas.push(`${descricao} — devia ter sido recusado e passou`);
    } catch {
      /* recusado, que é o esperado */
    }
  };

  await recusa(
    "society_admin sem sociedade",
    `insert into utilizador (id, organizacao_id, nome, email, papel)
     values ('01920000-0000-7000-8000-000000000201', null, 'Sem casa', 'semcasa@x.pt', 'society_admin')`,
  );

  await recusa(
    "super_admin com sociedade",
    `insert into utilizador (id, organizacao_id, nome, email, papel)
     values ('01920000-0000-7000-8000-000000000202', 'fe6c269c-5358-43f9-8a7e-ccade4778940',
             'Dono', 'dono@plataforma.pt', 'super_admin')`,
  );

  // O super_admin legítimo entra — e o segundo com o mesmo email não.
  await db.exec(
    `insert into utilizador (id, organizacao_id, nome, email, papel)
     values ('01920000-0000-7000-8000-000000000203', null, 'Dono', 'dono@plataforma.pt', 'super_admin')`,
  );

  await recusa(
    "segundo super_admin com o mesmo email",
    `insert into utilizador (id, organizacao_id, nome, email, papel)
     values ('01920000-0000-7000-8000-000000000204', null, 'Outro', 'dono@plataforma.pt', 'super_admin')`,
  );

  await recusa(
    "segunda sociedade com o mesmo prefixo",
    `insert into organizacao (id, nome, nif, prefixo_referencia)
     values ('01920000-0000-7000-8000-000000000301', 'Outra', '500000001', 'PMF')`,
  );

  await recusa(
    "segunda sociedade com o mesmo NIF",
    `insert into organizacao (id, nome, nif, prefixo_referencia)
     values ('01920000-0000-7000-8000-000000000302', 'Outra', '500000000', 'OUT')`,
  );

  await db.close();

  console.log(
    "\nPapéis: admin → society_admin, socio/advogado/assistente → utilizador; " +
      "0017 repetida sem efeito; org obrigatória por papel e prefixo/NIF únicos.",
  );
}

/**
 * A `0021` sobre uma base existente:
 * - O papel 'gestor' é aceite.
 * - 'gestor_id' é aceite em 'utilizador' e recusado nos outros papéis pela constraint.
 * - Todas as contas existentes ganham 'aprovado_em'.
 */
async function validarGestorEAprovacao(falhas: string[]) {
  const db = new PGlite({ extensions: { unaccent } });
  await db.waitReady;

  // Aplica até à 0020
  await aplicar(db, { ate: 20 });

  await db.exec(`
    insert into organizacao (id, nome, nif, prefixo_referencia)
    values ('fe6c269c-5358-43f9-8a7e-ccade4778940', 'PMF Consulting', '500000000', 'PMF');

    insert into utilizador (id, organizacao_id, auth_user_id, nome, email, papel)
    values
      ('01920000-0000-7000-8000-000000000401', 'fe6c269c-5358-43f9-8a7e-ccade4778940', 'u1', 'Admin', 'admin@pmf.pt', 'society_admin'),
      ('01920000-0000-7000-8000-000000000402', 'fe6c269c-5358-43f9-8a7e-ccade4778940', 'u2', 'Advogado', 'adv@pmf.pt', 'utilizador');
  `);

  // Aplica a 0021 duas vezes para testar idempotência
  for (const passagem of [1, 2]) {
    for (const bloco of instrucoes("0021_gestor_e_aprovacao")) {
      try {
        await db.exec(bloco);
      } catch (e) {
        falhas.push(
          `a 0021 falhou na passagem ${passagem} (não é idempotente): ${(e as Error).message}`,
        );
        await db.close();
        return;
      }
    }
  }

  // Verifica se as contas anteriores ganharam aprovado_em
  const semAprovacao = await db.query<{ n: number }>(
    "select count(*)::int as n from utilizador where aprovado_em is null",
  );
  if (Number(semAprovacao.rows[0]?.n ?? 0) !== 0) {
    falhas.push("Backfill 0021: existem contas antigas sem aprovado_em preenchido");
  }

  // Insere um gestor
  await db.exec(`
    insert into utilizador (id, organizacao_id, auth_user_id, nome, email, papel, aprovado_em)
    values ('01920000-0000-7000-8000-000000000403', 'fe6c269c-5358-43f9-8a7e-ccade4778940', 'u3', 'Gestor 1', 'gestor@pmf.pt', 'gestor', now());
  `);

  // Insere um utilizador associado ao gestor
  await db.exec(`
    insert into utilizador (id, organizacao_id, auth_user_id, nome, email, papel, gestor_id, aprovado_em)
    values ('01920000-0000-7000-8000-000000000404', 'fe6c269c-5358-43f9-8a7e-ccade4778940', 'u4', 'Membro Equipa', 'membro@pmf.pt', 'utilizador', '01920000-0000-7000-8000-000000000403', now());
  `);

  const recusa = async (descricao: string, sql: string) => {
    try {
      await db.exec(sql);
      falhas.push(`${descricao} — devia ter sido recusado e passou`);
    } catch {
      /* recusado, esperado */
    }
  };

  // Recusa gestor_id num society_admin
  await recusa(
    "gestor_id num society_admin",
    `insert into utilizador (id, organizacao_id, auth_user_id, nome, email, papel, gestor_id)
     values ('01920000-0000-7000-8000-000000000405', 'fe6c269c-5358-43f9-8a7e-ccade4778940', 'u5', 'Admin Invalido', 'admin2@pmf.pt', 'society_admin', '01920000-0000-7000-8000-000000000403')`,
  );

  // Recusa gestor_id num gestor
  await recusa(
    "gestor_id num gestor",
    `insert into utilizador (id, organizacao_id, auth_user_id, nome, email, papel, gestor_id)
     values ('01920000-0000-7000-8000-000000000406', 'fe6c269c-5358-43f9-8a7e-ccade4778940', 'u6', 'Gestor Invalido', 'gestor2@pmf.pt', 'gestor', '01920000-0000-7000-8000-000000000403')`,
  );

  // Recusa gestor sem organização
  await recusa(
    "gestor sem organização",
    `insert into utilizador (id, organizacao_id, auth_user_id, nome, email, papel)
     values ('01920000-0000-7000-8000-000000000407', null, 'u7', 'Gestor Sem Org', 'gestor_sem_org@pmf.pt', 'gestor')`,
  );

  await db.close();

  console.log("Gestor e aprovação: papel gestor aceite; gestor_id restrito a utilizador; backfill de aprovado_em garantido.");
}

async function main() {
  // `unaccent` não vem no build base do PGlite — no Supabase é `CREATE EXTENSION`.
  const db = new PGlite({ extensions: { unaccent } });
  await db.waitReady;

  await aplicar(db);

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

  const falhas: string[] = [];

  try {
    await db.exec("truncate evento_auditoria;");
    falhas.push("TRUNCATE passou sem erro — a auditoria não está protegida contra truncagem");
  } catch {
    // Esperado: trigger trigger_impedir_truncate_evento_auditoria aborta o TRUNCATE
  }

  const restantes = await db.query<{ acao: string }>("select acao from evento_auditoria;");

  if (restantes.rows.length !== 1) {
    falhas.push(`DELETE ou TRUNCATE passou — restaram ${restantes.rows.length} linhas em vez de 1`);
  }
  if (restantes.rows[0]?.acao !== "teste.criado") {
    falhas.push(`UPDATE passou — a ação ficou "${restantes.rows[0]?.acao}"`);
  }

  console.log(
    falhas.length === 0
      ? "\nAuditoria: UPDATE, DELETE e TRUNCATE bloqueados, INSERT preservado."
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
      'João Gonçalves Antunes', '+351****5678', 'joao@exemplo.pt',
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

  /* ---------------------------------- a 0017 mexe em dados que já existiam -- */

  await validarPapeis(falhas);

  /* ---------------------------------- a 0021 adiciona gestor e aprovacao ---- */

  await validarGestorEAprovacao(falhas);

  /* ---------------------------------- a 0023 adiciona email_modelo ---------- */

  await validarEmailModelos(falhas);

  if (falhas.length > 0) {
    console.error(`\n${falhas.length} problema(s):`);
    for (const f of falhas) console.error(`  · ${f}`);
    process.exit(1);
  }

  console.log("\nMigrações válidas.");
}

/**
 * A `0023` sobre uma base existente:
 * - A tabela `email_modelo` é criada.
 * - Suporta templates de email client-facing.
 * - Restrição UNIQUE(organizacao_id, template) impede duplicados.
 * - Idempotência garantida na reaplicação.
 */
async function validarEmailModelos(falhas: string[]) {
  const db = new PGlite({ extensions: { unaccent } });
  await db.waitReady;

  // Aplica até à 0022
  await aplicar(db, { ate: 22 });

  await db.exec(`
    insert into organizacao (id, nome, nif, prefixo_referencia)
    values ('fe6c269c-5358-43f9-8a7e-ccade4778940', 'PMF Consulting', '500000000', 'PMF');

    insert into utilizador (id, organizacao_id, auth_user_id, nome, email, papel, aprovado_em)
    values
      ('01920000-0000-7000-8000-000000000501', 'fe6c269c-5358-43f9-8a7e-ccade4778940', 'u1', 'Admin', 'admin@pmf.pt', 'society_admin', now());
  `);

  // Aplica a 0023 duas vezes para testar idempotência
  for (const passagem of [1, 2]) {
    for (const bloco of instrucoes("0023_email_modelos")) {
      try {
        await db.exec(bloco);
      } catch (e) {
        falhas.push(
          `a 0023 falhou na passagem ${passagem} (não é idempotente): ${(e as Error).message}`,
        );
        await db.close();
        return;
      }
    }
  }

  // Insere modelos personalizados válidos
  await db.exec(`
    insert into email_modelo (id, organizacao_id, template, assunto, corpo_html, atualizado_por)
    values (
      '01920000-0000-7000-8000-000000000502',
      'fe6c269c-5358-43f9-8a7e-ccade4778940',
      'confirmacao_rececao',
      'PMF | Recebemos os seus dados {{referencia}}',
      '<p>Olá {{nome_cliente}}, recebemos os seus dados na {{nome_sociedade}}.</p>',
      '01920000-0000-7000-8000-000000000501'
    );
  `);

  const recusa = async (descricao: string, sql: string) => {
    try {
      await db.exec(sql);
      falhas.push(`${descricao} — devia ter sido recusado e passou`);
    } catch {
      /* recusado, esperado */
    }
  };

  // Recusa inserção duplicada do mesmo template na mesma sociedade
  await recusa(
    "duplicado de template na mesma sociedade",
    `insert into email_modelo (id, organizacao_id, template, assunto, corpo_html)
     values (
       '01920000-0000-7000-8000-000000000503',
       'fe6c269c-5358-43f9-8a7e-ccade4778940',
       'confirmacao_rececao',
       'Outro assunto',
       '<p>Outro corpo</p>'
     )`,
  );

  await db.close();

  console.log("Modelos de email: tabela email_modelo criada com sucesso; unicidade (org, template) e idempotência garantidas.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
