import "server-only";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { processoOnboarding } from "@/db/schema/processo";
import { utilizador } from "@/db/schema/organizacao";
import { dadosFiscais, dadosIdentificacao, declaracaoPpe } from "@/db/schema/seccoes";
import { documento } from "@/db/schema/documentos";

/**
 * Consultas do back-office.
 *
 * Tudo do lado do servidor: paginação, filtros e ordenação. O brief é
 * explícito — nunca carregar tudo no cliente, porque o volume vai crescer.
 */

export type Filtros = {
  q?: string;
  estado?: string[];
  tipo?: string[];
  ppe?: "sim" | "nao";
  pagina?: number;
  porPagina?: number;
};

function condicoes(f: Filtros) {
  const partes = [isNull(processoOnboarding.apagadoEm)];

  if (f.estado?.length) {
    partes.push(inArray(processoOnboarding.estado, f.estado as never[]));
  }
  if (f.tipo?.length) {
    partes.push(inArray(processoOnboarding.tipoCliente, f.tipo as never[]));
  }
  if (f.ppe) {
    partes.push(
      sql`exists (select 1 from ${declaracaoPpe} where ${declaracaoPpe.processoId} = ${processoOnboarding.id} and ${declaracaoPpe.ePpe} = ${f.ppe === "sim"})`,
    );
  }
  if (f.q?.trim()) {
    const termo = `%${f.q.trim()}%`;
    // Pesquisa por referência, nome e NIF — os três campos que o §6 pede.
    // `unaccent` na comparação, para "goncalves" encontrar "Gonçalves".
    partes.push(
      or(
        ilike(processoOnboarding.referencia, termo),
        sql`exists (select 1 from ${dadosIdentificacao} where ${dadosIdentificacao.processoId} = ${processoOnboarding.id} and unaccent(${dadosIdentificacao.nome}) ilike unaccent(${termo}))`,
        sql`exists (select 1 from ${dadosFiscais} where ${dadosFiscais.processoId} = ${processoOnboarding.id} and ${dadosFiscais.nif} ilike ${termo})`,
      )!,
    );
  }

  return and(...partes);
}

export async function listarProcessos(f: Filtros) {
  const base = db();
  const pagina = Math.max(1, f.pagina ?? 1);
  const porPagina = Math.min(100, f.porPagina ?? 25);
  const onde = condicoes(f);

  const [linhas, [total]] = await Promise.all([
    base
      .select({
        id: processoOnboarding.id,
        referencia: processoOnboarding.referencia,
        tipoCliente: processoOnboarding.tipoCliente,
        estado: processoOnboarding.estado,
        passoAtual: processoOnboarding.passoAtual,
        submetidoEm: processoOnboarding.submetidoEm,
        atualizadoEm: processoOnboarding.atualizadoEm,
        nome: sql<string>`coalesce(${dadosIdentificacao.nome}, ${processoOnboarding.nomeCliente})`,
        nif: sql<string>`coalesce(${dadosFiscais.nif}, ${processoOnboarding.nifCliente})`,
        responsavel: utilizador.nome,
      })
      .from(processoOnboarding)
      .leftJoin(dadosIdentificacao, eq(dadosIdentificacao.processoId, processoOnboarding.id))
      .leftJoin(dadosFiscais, eq(dadosFiscais.processoId, processoOnboarding.id))
      .leftJoin(utilizador, eq(utilizador.id, processoOnboarding.responsavelId))
      .where(onde)
      .orderBy(desc(processoOnboarding.atualizadoEm))
      .limit(porPagina)
      .offset((pagina - 1) * porPagina),
    base.select({ n: count() }).from(processoOnboarding).where(onde),
  ]);

  return { linhas, total: total?.n ?? 0, pagina, porPagina };
}

/** Contagens por estado e tipo — os filtros facetados do §6. */
export async function facetas() {
  const base = db();
  const vivos = isNull(processoOnboarding.apagadoEm);

  const [porEstado, porTipo] = await Promise.all([
    base
      .select({ chave: processoOnboarding.estado, n: count() })
      .from(processoOnboarding)
      .where(vivos)
      .groupBy(processoOnboarding.estado),
    base
      .select({ chave: processoOnboarding.tipoCliente, n: count() })
      .from(processoOnboarding)
      .where(vivos)
      .groupBy(processoOnboarding.tipoCliente),
  ]);

  return { porEstado, porTipo };
}

/** Os números do painel. Só o que faz agir — nada de gráficos decorativos. */
export async function numerosDoPainel() {
  const base = db();
  const vivos = isNull(processoOnboarding.apagadoEm);
  const seteDias = new Date(Date.now() - 7 * 86_400_000);
  const sessentaDias = new Date(Date.now() + 60 * 86_400_000);

  const [[porRever], [parados], [aExpirar], [rascunhos]] = await Promise.all([
    base
      .select({ n: count() })
      .from(processoOnboarding)
      .where(
        and(
          vivos,
          inArray(processoOnboarding.estado, ["aguardar_aprovacao", "submetido", "em_revisao"]),
        ),
      ),
    base
      .select({ n: count() })
      .from(processoOnboarding)
      .where(
        and(
          vivos,
          inArray(processoOnboarding.estado, ["rascunho", "pendente_cliente"]),
          lte(processoOnboarding.atualizadoEm, seteDias),
        ),
      ),
    base
      .select({ n: count() })
      .from(dadosFiscais)
      .where(
        and(
          gte(dadosFiscais.docValidade, new Date().toISOString().slice(0, 10)),
          lte(dadosFiscais.docValidade, sessentaDias.toISOString().slice(0, 10)),
        ),
      ),
    base
      .select({ n: count() })
      .from(processoOnboarding)
      .where(and(vivos, eq(processoOnboarding.estado, "rascunho"))),
  ]);

  return {
    porRever: porRever?.n ?? 0,
    parados: parados?.n ?? 0,
    aExpirar: aExpirar?.n ?? 0,
    rascunhos: rascunhos?.n ?? 0,
  };
}

/** Atividade recente, para o painel. */
export async function recentes(limite = 6) {
  return db()
    .select({
      id: processoOnboarding.id,
      referencia: processoOnboarding.referencia,
      estado: processoOnboarding.estado,
      atualizadoEm: processoOnboarding.atualizadoEm,
      nome: dadosIdentificacao.nome,
    })
    .from(processoOnboarding)
    .leftJoin(dadosIdentificacao, eq(dadosIdentificacao.processoId, processoOnboarding.id))
    .where(isNull(processoOnboarding.apagadoEm))
    .orderBy(desc(processoOnboarding.atualizadoEm))
    .limit(limite);
}

/** Um processo pelo id, com o responsável. */
export async function processoPorId(id: string) {
  const [linha] = await db()
    .select({
      p: processoOnboarding,
      responsavel: utilizador.nome,
    })
    .from(processoOnboarding)
    .leftJoin(utilizador, eq(utilizador.id, processoOnboarding.responsavelId))
    .where(and(eq(processoOnboarding.id, id), isNull(processoOnboarding.apagadoEm)))
    .limit(1);

  return linha ? { ...linha.p, responsavel: linha.responsavel } : null;
}

/** Documentos de um processo, sem os bytes. */
export async function documentosDoProcesso(processoId: string) {
  return db()
    .select({
      id: documento.id,
      nome: documento.nomeOriginal,
      tipo: documento.tipo,
      bytes: documento.tamanhoBytes,
      hash: documento.hashSha256,
      criadoEm: documento.criadoEm,
    })
    .from(documento)
    .where(and(eq(documento.processoId, processoId), isNull(documento.apagadoEm)))
    .orderBy(asc(documento.criadoEm));
}
