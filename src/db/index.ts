import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/env";
import * as schema from "./schema";

/**
 * Lazy connection, reused across hot reloads. Without this, every recompile in
 * development opens a new pool and exhausts Supabase's free-plan connections in
 * minutes.
 */
const global_ = globalThis as unknown as {
  __ligacaoPostgres?: ReturnType<typeof postgres>;
};

function ligacao() {
  if (!global_.__ligacaoPostgres) {
    global_.__ligacaoPostgres = postgres(env().DATABASE_URL, {
      max: env().NODE_ENV === "production" ? 10 : 3,
      prepare: false, // o pooler do Supabase (pgBouncer) não suporta prepared statements
    });
  }
  return global_.__ligacaoPostgres;
}

let cache: ReturnType<typeof criar> | null = null;

function criar() {
  return drizzle(ligacao(), { schema, casing: "snake_case" });
}

export function db() {
  if (!cache) cache = criar();
  return cache;
}

export { schema };
