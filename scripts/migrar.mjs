/**
 * Aplica as migrações pendentes. Corre no arranque do contentor, antes do
 * servidor Next.
 *
 * É .mjs e não .ts de propósito: na imagem de produção não há `tsx` nem
 * dependências de desenvolvimento. Só precisa do `postgres` e do `drizzle-orm`,
 * que o Dockerfile copia explicitamente.
 *
 * O drizzle regista o que já aplicou em `__drizzle_migrations`, por isso correr
 * isto a cada arranque é seguro — as migrações já aplicadas são ignoradas.
 */
import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;

if (!url) {
  console.error("DATABASE_URL não definido — o contentor não arranca sem base de dados.");
  process.exit(1);
}

// ./migracoes na imagem Docker, ./src/db/migrations quando corre a partir do repo.
const pasta = existsSync("./migracoes") ? "./migracoes" : "./src/db/migrations";

// max: 1 e sem prepared statements — o pooler em modo transaction não os suporta,
// e uma migração não beneficia de concorrência nenhuma.
const ligacao = postgres(url, { max: 1, prepare: false });

try {
  await migrate(drizzle(ligacao), { migrationsFolder: pasta });
  console.log(`Migrações aplicadas a partir de ${pasta}.`);
} catch (e) {
  console.error("Falha a migrar:", e);
  process.exit(1);
} finally {
  await ligacao.end();
}
