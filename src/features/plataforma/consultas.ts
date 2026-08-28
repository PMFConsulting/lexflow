import "server-only";
import {
  aliasedTable,
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import { organizacao, utilizador } from "@/db/schema/organizacao";
import { processoOnboarding } from "@/db/schema/processo";
import { dadosFiscais, dadosIdentificacao } from "@/db/schema/seccoes";

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
 * As contagens **não** podem ir em subconsulta correlacionada escrita num
 * `sql` template dentro da lista de campos. O Drizzle constrói a lista de
 * campos com `buildSelection({ isSingleTable })`, e quando a consulta tem uma
 * tabela só — que é o caso aqui, `from(organizacao)` sem `join` — ele **retira
 * o prefixo de tabela a todas as colunas** que apareçam nesses templates. O que
 * saía era isto:
 *
 *   (select count(*)::int from "utilizador" where "organizacao_id" = "id" ...)
 *
 * Dentro da subconsulta, `"id"` já não é o da organização: resolve para
 * `utilizador.id`. A condição passa a comparar duas colunas da mesma tabela, é
 * sempre falsa, e o Postgres não se queixa de nada — a página mostrava 0 contas
 * e 0 processos em todas as sociedades. Dar um alias à tabela de fora não
 * salva: a remoção do prefixo é incondicional.
 *
 * Também não vão em `join` + `group by` sobre esta consulta: com dois `join`
 * sobre a mesma linha (contas e processos) as contagens multiplicam-se uma pela
 * outra, e uma sociedade com 3 contas e 4 processos aparecia com 12 de cada. É
 * o erro clássico e, tal como o de cima, não dá erro nenhum — dá números
 * plausíveis.
 *
 * O que fica são três agregações independentes, cada uma agrupada pela sua
 * organização e com `count()` nativo, reunidas em memória. Sem produto
 * cartesiano, sem subconsulta correlacionada, e nada que dependa de como o
 * Drizzle qualifica colunas.
 */
export async function listarSociedades(procura?: string) {
  const base = db();
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

  const [linhas, porContas, porAdministradores, porProcessos] = await Promise.all([
    base
      .select({
        id: organizacao.id,
        nome: organizacao.nome,
        nif: organizacao.nif,
        prefixoReferencia: organizacao.prefixoReferencia,
        criadoEm: organizacao.criadoEm,
      })
      .from(organizacao)
      .where(onde)
      .orderBy(asc(organizacao.nome)),
    base
      .select({ organizacaoId: utilizador.organizacaoId, n: count() })
      .from(utilizador)
      .where(isNull(utilizador.apagadoEm))
      .groupBy(utilizador.organizacaoId),
    base
      .select({ organizacaoId: utilizador.organizacaoId, n: count() })
      .from(utilizador)
      .where(and(isNull(utilizador.apagadoEm), eq(utilizador.papel, "society_admin")))
      .groupBy(utilizador.organizacaoId),
    base
      .select({ organizacaoId: processoOnboarding.organizacaoId, n: count() })
      .from(processoOnboarding)
      .where(isNull(processoOnboarding.apagadoEm))
      .groupBy(processoOnboarding.organizacaoId),
  ]);

  /**
   * O `organizacaoId` do `utilizador` é anulável desde a `0016` — é assim que o
   * `super_admin` está guardado. Essas linhas não pertencem a sociedade
   * nenhuma e ficam de fora do mapa em vez de irem parar a uma chave inventada.
   */
  const mapa = (ls: { organizacaoId: string | null; n: number }[]) =>
    new Map(
      ls.filter((l): l is { organizacaoId: string; n: number } => l.organizacaoId !== null).map(
        (l) => [l.organizacaoId, l.n],
      ),
    );

  const contas = mapa(porContas);
  const administradores = mapa(porAdministradores);
  const processos = mapa(porProcessos);

  return linhas.map((l) => ({
    ...l,
    contas: contas.get(l.id) ?? 0,
    administradores: administradores.get(l.id) ?? 0,
    processos: processos.get(l.id) ?? 0,
  }));
}

export async function sociedadePorId(id: string) {
  const [linha] = await db()
    .select()
    .from(organizacao)
    .where(and(eq(organizacao.id, id), isNull(organizacao.apagadoEm)))
    .limit(1);

  return linha ?? null;
}

const gestor = aliasedTable(utilizador, "gestor");

export type LinhaDeUtilizador = {
  id: string;
  nome: string;
  email: string;
  papel: "super_admin" | "society_admin" | "gestor" | "utilizador";
  ativo: boolean;
  ligado: string | null;
  criadoEm: Date;
  aprovadoEm: Date | null;
  gestorId: string | null;
  gestorNome: string | null;
};

/**
 * As contas de uma sociedade — ou, com `organizacaoId` a `null`, as da
 * plataforma.
 *
 * O `null` não é um "todas": é literalmente o grupo dos `super_admin`, que é
 * como eles estão guardados. Um `null` a significar "sem filtro" numa função
 * cujo argumento também pode ser legitimamente nulo era uma armadilha à espera
 * — por isso a lista global tem função própria, abaixo.
 */
export async function utilizadoresDaSociedade(
  organizacaoId: string | null,
): Promise<LinhaDeUtilizador[]> {
  const linhas = await db()
    .select({
      id: utilizador.id,
      nome: utilizador.nome,
      email: utilizador.email,
      papel: utilizador.papel,
      ativo: utilizador.ativo,
      ligado: utilizador.authUserId,
      criadoEm: utilizador.criadoEm,
      aprovadoEm: utilizador.aprovadoEm,
      gestorId: utilizador.gestorId,
      gestorNome: gestor.nome,
    })
    .from(utilizador)
    .leftJoin(gestor, eq(gestor.id, utilizador.gestorId))
    .where(
      and(
        isNull(utilizador.apagadoEm),
        organizacaoId
          ? eq(utilizador.organizacaoId, organizacaoId)
          : isNull(utilizador.organizacaoId),
      ),
    )
    .orderBy(asc(utilizador.papel), asc(utilizador.nome));

  return linhas as LinhaDeUtilizador[];
}

export type LinhaUtilizadorGlobal = {
  id: string;
  nome: string;
  email: string;
  papel: "super_admin" | "society_admin" | "gestor" | "utilizador";
  ativo: boolean;
  ligado: string | null;
  criadoEm: Date;
  aprovadoEm: Date | null;
  gestorId: string | null;
  gestorNome: string | null;
  organizacaoId: string | null;
  sociedade: string | null;
};

/** Todas as contas da plataforma, com a sociedade de cada uma. */
export async function listarUtilizadores(procura?: string): Promise<LinhaUtilizadorGlobal[]> {
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

  const linhas = await db()
    .select({
      id: utilizador.id,
      nome: utilizador.nome,
      email: utilizador.email,
      papel: utilizador.papel,
      ativo: utilizador.ativo,
      ligado: utilizador.authUserId,
      criadoEm: utilizador.criadoEm,
      aprovadoEm: utilizador.aprovadoEm,
      gestorId: utilizador.gestorId,
      gestorNome: gestor.nome,
      organizacaoId: utilizador.organizacaoId,
      sociedade: organizacao.nome,
    })
    .from(utilizador)
    .leftJoin(organizacao, eq(organizacao.id, utilizador.organizacaoId))
    .leftJoin(gestor, eq(gestor.id, utilizador.gestorId))
    .where(onde)
    .orderBy(asc(utilizador.papel), asc(organizacao.nome), asc(utilizador.nome));

  return linhas as LinhaUtilizadorGlobal[];
}

export type LinhaUtilizadorPendente = {
  id: string;
  nome: string;
  email: string;
  papel: string;
  ativo: boolean;
  criadoEm: Date;
  aprovadoEm: Date | null;
  gestorId: string | null;
  gestorNome: string | null;
  organizacaoId: string | null;
  sociedadeNome: string | null;
};

/** Utilizadores propostos pelas sociedades que aguardam aprovação do super_admin. */
export async function listarUtilizadoresPendentes(
  organizacaoId?: string,
): Promise<LinhaUtilizadorPendente[]> {
  const condicoes = [
    isNull(utilizador.apagadoEm),
    isNull(utilizador.aprovadoEm),
    ne(utilizador.papel, "super_admin"),
  ];

  if (organizacaoId) {
    condicoes.push(eq(utilizador.organizacaoId, organizacaoId));
  }

  return db()
    .select({
      id: utilizador.id,
      nome: utilizador.nome,
      email: utilizador.email,
      papel: utilizador.papel,
      ativo: utilizador.ativo,
      criadoEm: utilizador.criadoEm,
      aprovadoEm: utilizador.aprovadoEm,
      gestorId: utilizador.gestorId,
      gestorNome: gestor.nome,
      organizacaoId: utilizador.organizacaoId,
      sociedadeNome: organizacao.nome,
    })
    .from(utilizador)
    .leftJoin(organizacao, eq(organizacao.id, utilizador.organizacaoId))
    .leftJoin(gestor, eq(gestor.id, utilizador.gestorId))
    .where(and(...condicoes))
    .orderBy(desc(utilizador.criadoEm));
}

/** Utilizadores associados a um gestor numa sociedade (área do gestor). */
export async function listarUtilizadoresDoGestor(gestorId: string, organizacaoId: string) {
  return db()
    .select({
      id: utilizador.id,
      nome: utilizador.nome,
      email: utilizador.email,
      papel: utilizador.papel,
      ativo: utilizador.ativo,
      aprovadoEm: utilizador.aprovadoEm,
      criadoEm: utilizador.criadoEm,
    })
    .from(utilizador)
    .where(
      and(
        eq(utilizador.gestorId, gestorId),
        eq(utilizador.organizacaoId, organizacaoId),
        isNull(utilizador.apagadoEm),
      ),
    )
    .orderBy(asc(utilizador.nome));
}

/** Os números do painel da plataforma. */
export async function numerosDaPlataforma() {
  const base = db();

  const [[sociedades], [contas], [processos], [semAdmin], [pendentes]] = await Promise.all([
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
     *
     * Aqui a subconsulta correlacionada **é** segura, ao contrário da de
     * `listarSociedades`: esta vive no `where` e não na lista de campos, e o
     * `where` não passa por `buildSelection` — o Drizzle mantém o prefixo, e o
     * SQL gerado diz `"utilizador"."organizacao_id" = "organizacao"."id"`.
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
    base
      .select({ n: count() })
      .from(utilizador)
      .where(
        and(
          isNull(utilizador.apagadoEm),
          isNull(utilizador.aprovadoEm),
          ne(utilizador.papel, "super_admin"),
        ),
      ),
  ]);

  return {
    sociedades: sociedades?.n ?? 0,
    contas: contas?.n ?? 0,
    processos: processos?.n ?? 0,
    semAdmin: semAdmin?.n ?? 0,
    pendentesAprovacao: pendentes?.n ?? 0,
  };
}

/**
 * Repartição de todos os processos da plataforma por estado.
 *
 * Uma contagem agrupada por `estado` — os valores vêm do enum `estado_processo`
 * e o devolvido é um objeto com todas as chaves a zero por omissão, para o
 * painel nunca renderizar `undefined` num estado que ainda não tem processos.
 * Usa a mesma cláusula de vivos de `numerosDaPlataforma` (`apagado_em is null`).
 */
export async function reparticaoProcessosPorEstado() {
  const linhas = await db()
    .select({ estado: processoOnboarding.estado, n: count() })
    .from(processoOnboarding)
    .where(isNull(processoOnboarding.apagadoEm))
    .groupBy(processoOnboarding.estado);

  const reparticao: Record<(typeof processoOnboarding.estado.enumValues)[number], number> = {
    rascunho: 0,
    submetido: 0,
    aguardar_aprovacao: 0,
    em_revisao: 0,
    pendente_cliente: 0,
    aprovado: 0,
    rejeitado: 0,
    arquivado: 0,
  };
  for (const linha of linhas) {
    reparticao[linha.estado] = linha.n;
  }
  return reparticao;
}

/** Os processos da sociedade para o portal do utilizador (`/meus-processos`). */
export async function processosDaSociedade(organizacaoId: string, limite = 100) {
  return db()
    .select({
      id: processoOnboarding.id,
      referencia: processoOnboarding.referencia,
      estado: processoOnboarding.estado,
      tipoCliente: processoOnboarding.tipoCliente,
      passoAtual: processoOnboarding.passoAtual,
      atualizadoEm: processoOnboarding.atualizadoEm,
      nomeCliente: sql<string>`coalesce(${dadosIdentificacao.nome}, ${processoOnboarding.nomeCliente})`,
      nifCliente: sql<string>`coalesce(${dadosFiscais.nif}, ${processoOnboarding.nifCliente})`,
    })
    .from(processoOnboarding)
    .leftJoin(dadosIdentificacao, eq(dadosIdentificacao.processoId, processoOnboarding.id))
    .leftJoin(dadosFiscais, eq(dadosFiscais.processoId, processoOnboarding.id))
    .where(
      and(
        eq(processoOnboarding.organizacaoId, organizacaoId),
        isNull(processoOnboarding.apagadoEm),
      ),
    )
    .orderBy(desc(processoOnboarding.atualizadoEm))
    .limit(limite);
}

/** Os metadados de processos da sociedade para a visão do super_admin em `/admin/sociedades/[id]`. */
export async function metadadosProcessosDaSociedade(organizacaoId: string, limite = 100) {
  return db()
    .select({
      id: processoOnboarding.id,
      referencia: processoOnboarding.referencia,
      estado: processoOnboarding.estado,
      tipoCliente: processoOnboarding.tipoCliente,
      passoAtual: processoOnboarding.passoAtual,
      atualizadoEm: processoOnboarding.atualizadoEm,
      responsavel: utilizador.nome,
    })
    .from(processoOnboarding)
    .leftJoin(utilizador, eq(utilizador.id, processoOnboarding.responsavelId))
    .where(
      and(
        eq(processoOnboarding.organizacaoId, organizacaoId),
        isNull(processoOnboarding.apagadoEm),
      ),
    )
    .orderBy(desc(processoOnboarding.atualizadoEm))
    .limit(limite);
}
