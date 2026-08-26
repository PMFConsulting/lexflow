import "server-only";
import { and, asc, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { organizacao, utilizador } from "@/db/schema/organizacao";
import { processoOnboarding } from "@/db/schema/processo";

/**
 * Consultas do portal da plataforma.
 *
 * Tudo aqui atravessa sociedades — é o que distingue este portal do
 * back-office, onde toda a consulta é filtrada pela organização de quem lê. Por
 * isso nenhuma destas funções é chamada de outro sítio que não seja `/admin`,
 * que tem `exigirSuperAdmin()` no layout.
 */

/**
 * As sociedades, com os números que dizem se estão vivas.
 *
 * As contagens vão em subconsultas e não em `join` + `group by`: com dois
 * `join` sobre a mesma linha (contas e processos) as contagens multiplicam-se
 * uma pela outra, e uma sociedade com 3 contas e 4 processos aparecia com 12
 * de cada. É o erro clássico e não dá erro nenhum — dá números plausíveis.
 */
export async function listarSociedades(procura?: string) {
  const termo = procura?.trim();
  const vivas = isNull(organizacao.apagadoEm);

  const onde = termo
    ? and(
        vivas,
        or(
          sql`unaccent(${organizacao.nome}) ilike unaccent(${`%${termo}%`})`,
          ilike(organizacao.nif, `%${termo}%`),
          ilike(organizacao.prefixoReferencia, `%${termo}%`),
        )!,
      )
    : vivas;

  return db()
    .select({
      id: organizacao.id,
      nome: organizacao.nome,
      nif: organizacao.nif,
      prefixoReferencia: organizacao.prefixoReferencia,
      criadoEm: organizacao.criadoEm,
      contas: sql<number>`(
        select count(*)::int from ${utilizador}
        where ${utilizador.organizacaoId} = ${organizacao.id}
          and ${utilizador.apagadoEm} is null
      )`,
      administradores: sql<number>`(
        select count(*)::int from ${utilizador}
        where ${utilizador.organizacaoId} = ${organizacao.id}
          and ${utilizador.apagadoEm} is null
          and ${utilizador.papel} = 'society_admin'
      )`,
      processos: sql<number>`(
        select count(*)::int from ${processoOnboarding}
        where ${processoOnboarding.organizacaoId} = ${organizacao.id}
          and ${processoOnboarding.apagadoEm} is null
      )`,
    })
    .from(organizacao)
    .where(onde)
    .orderBy(asc(organizacao.nome));
}

export async function sociedadePorId(id: string) {
  const [linha] = await db()
    .select()
    .from(organizacao)
    .where(and(eq(organizacao.id, id), isNull(organizacao.apagadoEm)))
    .limit(1);

  return linha ?? null;
}

/**
 * As contas de uma sociedade — ou, com `organizacaoId` a `null`, as da
 * plataforma.
 *
 * O `null` não é um "todas": é literalmente o grupo dos `super_admin`, que é
 * como eles estão guardados. Um `null` a significar "sem filtro" numa função
 * cujo argumento também pode ser legitimamente nulo era uma armadilha à espera
 * — por isso a lista global tem função própria, abaixo.
 */
export async function utilizadoresDaSociedade(organizacaoId: string | null) {
  return db()
    .select({
      id: utilizador.id,
      nome: utilizador.nome,
      email: utilizador.email,
      papel: utilizador.papel,
      ativo: utilizador.ativo,
      ligado: utilizador.authUserId,
      criadoEm: utilizador.criadoEm,
    })
    .from(utilizador)
    .where(
      and(
        isNull(utilizador.apagadoEm),
        organizacaoId
          ? eq(utilizador.organizacaoId, organizacaoId)
          : isNull(utilizador.organizacaoId),
      ),
    )
    .orderBy(asc(utilizador.papel), asc(utilizador.nome));
}

/** Só os emails, para a importação saber com o que é que o ficheiro colide. */
export async function emailsDaSociedade(organizacaoId: string | null) {
  const linhas = await db()
    .select({ email: utilizador.email })
    .from(utilizador)
    .where(
      and(
        isNull(utilizador.apagadoEm),
        organizacaoId
          ? eq(utilizador.organizacaoId, organizacaoId)
          : isNull(utilizador.organizacaoId),
      ),
    );

  return linhas.map((l) => l.email);
}

/** Todas as contas da plataforma, com a sociedade de cada uma. */
export async function listarUtilizadores(procura?: string) {
  const termo = procura?.trim();
  const vivos = isNull(utilizador.apagadoEm);

  const onde = termo
    ? and(
        vivos,
        or(
          sql`unaccent(${utilizador.nome}) ilike unaccent(${`%${termo}%`})`,
          ilike(utilizador.email, `%${termo}%`),
        )!,
      )
    : vivos;

  return db()
    .select({
      id: utilizador.id,
      nome: utilizador.nome,
      email: utilizador.email,
      papel: utilizador.papel,
      ativo: utilizador.ativo,
      ligado: utilizador.authUserId,
      criadoEm: utilizador.criadoEm,
      organizacaoId: utilizador.organizacaoId,
      sociedade: organizacao.nome,
    })
    .from(utilizador)
    .leftJoin(organizacao, eq(organizacao.id, utilizador.organizacaoId))
    .where(onde)
    .orderBy(asc(utilizador.papel), asc(organizacao.nome), asc(utilizador.nome));
}

/** Os números do painel da plataforma. */
export async function numerosDaPlataforma() {
  const base = db();

  const [[sociedades], [contas], [processos], [semAdmin]] = await Promise.all([
    base.select({ n: count() }).from(organizacao).where(isNull(organizacao.apagadoEm)),
    base.select({ n: count() }).from(utilizador).where(isNull(utilizador.apagadoEm)),
    base
      .select({ n: count() })
      .from(processoOnboarding)
      .where(isNull(processoOnboarding.apagadoEm)),
    /**
     * Sociedades sem nenhum administrador — o número que faz agir.
     *
     * Uma sociedade nesse estado está criada e não tem quem a opere: ninguém
     * entra nela, ninguém abre processos, e do lado de fora parece que está a
     * funcionar. É o resultado de criar a sociedade e adiar o primeiro
     * `society_admin`, que o formulário permite de propósito.
     */
    base
      .select({ n: count() })
      .from(organizacao)
      .where(
        and(
          isNull(organizacao.apagadoEm),
          sql`not exists (
            select 1 from ${utilizador}
            where ${utilizador.organizacaoId} = ${organizacao.id}
              and ${utilizador.apagadoEm} is null
              and ${utilizador.papel} = 'society_admin'
          )`,
        ),
      ),
  ]);

  return {
    sociedades: sociedades?.n ?? 0,
    contas: contas?.n ?? 0,
    processos: processos?.n ?? 0,
    semAdmin: semAdmin?.n ?? 0,
  };
}

/** Os processos de quem só vê os da sua sociedade — o portal do `utilizador`. */
export async function processosDaSociedade(organizacaoId: string, limite = 50) {
  return db()
    .select({
      id: processoOnboarding.id,
      referencia: processoOnboarding.referencia,
      estado: processoOnboarding.estado,
      tipoCliente: processoOnboarding.tipoCliente,
      passoAtual: processoOnboarding.passoAtual,
      atualizadoEm: processoOnboarding.atualizadoEm,
      nomeCliente: processoOnboarding.nomeCliente,
    })
    .from(processoOnboarding)
    .where(
      and(
        eq(processoOnboarding.organizacaoId, organizacaoId),
        isNull(processoOnboarding.apagadoEm),
      ),
    )
    .orderBy(desc(processoOnboarding.atualizadoEm))
    .limit(limite);
}
