/**
 * Revalida a cadeia de hashes do registo de auditoria.
 *
 * Critério de aceitação do §9 do brief: a cadeia tem de ser verificável por um
 * script. Relê tudo por ordem, recalcula cada hash e compara.
 *
 *   pnpm auditoria:verificar
 */
import { config } from "dotenv";
import { asc } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { calcularHash } from "../src/features/auditoria/hash";
import { eventoAuditoria } from "../src/db/schema/auditoria";

config({ path: ".env" });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL não definido. Copia o .env.example para .env.");
    process.exit(1);
  }

  const ligacao = postgres(url, { max: 1, prepare: false });
  const db = drizzle(ligacao, { casing: "snake_case" });

  const eventos = await db
    .select()
    .from(eventoAuditoria)
    .orderBy(asc(eventoAuditoria.organizacaoId), asc(eventoAuditoria.criadoEm), asc(eventoAuditoria.id));

  // A cadeia é por organização — ver decisão D6 em CLAUDE.md.
  const ultimoHash = new Map<string, string | null>();
  const falhas: string[] = [];

  for (const evento of eventos) {
    const anterior = ultimoHash.get(evento.organizacaoId) ?? null;

    if (evento.hashAnterior !== anterior) {
      falhas.push(
        `${evento.id}: hash_anterior não corresponde ao último da organização (esperado ${anterior ?? "null"}, encontrado ${evento.hashAnterior ?? "null"})`,
      );
    }

    const esperado = calcularHash(evento, anterior);
    if (esperado !== evento.hash) {
      falhas.push(`${evento.id}: hash não bate — a linha foi alterada depois de escrita`);
    }

    ultimoHash.set(evento.organizacaoId, evento.hash);
  }

  await ligacao.end();

  console.log(`Eventos verificados: ${eventos.length}`);
  console.log(`Organizações: ${ultimoHash.size}`);

  if (falhas.length > 0) {
    console.error(`\nCadeia INVÁLIDA — ${falhas.length} problema(s):`);
    for (const f of falhas) console.error(`  · ${f}`);
    process.exit(1);
  }

  console.log("Cadeia íntegra.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
