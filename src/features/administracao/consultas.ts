import "server-only";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { organizacao, utilizador } from "@/db/schema/organizacao";
import {
  aceitacaoTermos,
  conviteUtilizador,
  documentoOrganizacao,
  perfilUtilizador,
} from "@/db/schema/sociedade";

/**
 * As consultas do portal de administração da sociedade.
 *
 * Tudo aqui é por organização, e nunca por defeito: um `select` sem
 * `organizacao_id` no `where` é, num sistema multi-tenant, uma sociedade a ver
 * a equipa de outra. As guardas de papel estão nas páginas (`exigirAdmin`); o
 * âmbito por organização está aqui, e os dois são precisos.
 */

export type LinhaEquipa = {
  id: string;
  nome: string;
  email: string;
  papel: "super_admin" | "society_admin" | "gestor" | "utilizador";
  ativo: boolean;
  criadoEm: Date;
  cargo: string | null;
  cedulaProfissional: string | null;
  /** A versão dos T&C que esta pessoa aceitou, ou `null` se não aceitou nenhuma. */
  termosVersao: string | null;
  termosAceiteEm: Date | null;
};

/**
 * A equipa da sociedade, com a prova de aceitação de cada pessoa ao lado.
 *
 * A aceitação vem por `left join` e não por consulta à parte: a pergunta que se
 * faz nesta página é sempre a mesma — quem é que ainda não aceitou o articulado
 * em vigor? — e responder-lhe com N+1 consultas era transformar uma pergunta
 * numa espera.
 *
 * `desc(aceitacaoTermos.aceiteEm)` com `distinct on` seria o ideal, mas o
 * Drizzle não o exprime bem aqui; o `max` sobre a versão mais recente resolve o
 * caso real, que é uma pessoa ter uma aceitação por versão e querer-se a última.
 */
export async function listarEquipa(organizacaoId: string): Promise<LinhaEquipa[]> {
  const ultima = db()
    .select({
      utilizadorId: aceitacaoTermos.utilizadorId,
      versao: sql<string>`max(${aceitacaoTermos.versao})`.as("versao"),
      aceiteEm: sql<Date>`max(${aceitacaoTermos.aceiteEm})`.as("aceite_em"),
    })
    .from(aceitacaoTermos)
    .where(eq(aceitacaoTermos.organizacaoId, organizacaoId))
    .groupBy(aceitacaoTermos.utilizadorId)
    .as("ultima");

  const linhas = await db()
    .select({
      id: utilizador.id,
      nome: utilizador.nome,
      email: utilizador.email,
      papel: utilizador.papel,
      ativo: utilizador.ativo,
      criadoEm: utilizador.criadoEm,
      cargo: perfilUtilizador.cargo,
      cedulaProfissional: perfilUtilizador.cedulaProfissional,
      termosVersao: ultima.versao,
      termosAceiteEm: ultima.aceiteEm,
    })
    .from(utilizador)
    .leftJoin(perfilUtilizador, eq(perfilUtilizador.utilizadorId, utilizador.id))
    .leftJoin(ultima, eq(ultima.utilizadorId, utilizador.id))
    .where(
      and(eq(utilizador.organizacaoId, organizacaoId), isNull(utilizador.apagadoEm)),
    )
    .orderBy(desc(utilizador.criadoEm));

  return linhas as LinhaEquipa[];
}

export type LinhaConvite = {
  id: string;
  nome: string;
  email: string;
  papel: "super_admin" | "society_admin" | "gestor" | "utilizador";
  estado: "pendente" | "aceite" | "cancelado";
  passoAtual: number;
  expiraEm: Date | null;
  criadoEm: Date;
  aceiteEm: Date | null;
  criadoPor: string | null;
};

/** Os convites da sociedade, incluindo os já aceites — é o histórico de entradas. */
export async function listarConvites(organizacaoId: string): Promise<LinhaConvite[]> {
  const autor = db()
    .select({ id: utilizador.id, nome: utilizador.nome })
    .from(utilizador)
    .as("autor");

  const linhas = await db()
    .select({
      id: conviteUtilizador.id,
      nome: conviteUtilizador.nome,
      email: conviteUtilizador.email,
      papel: conviteUtilizador.papel,
      estado: conviteUtilizador.estado,
      passoAtual: conviteUtilizador.passoAtual,
      expiraEm: conviteUtilizador.expiraEm,
      criadoEm: conviteUtilizador.criadoEm,
      aceiteEm: conviteUtilizador.aceiteEm,
      criadoPor: autor.nome,
    })
    .from(conviteUtilizador)
    .leftJoin(autor, eq(autor.id, conviteUtilizador.criadoPor))
    .where(
      and(
        eq(conviteUtilizador.organizacaoId, organizacaoId),
        isNull(conviteUtilizador.apagadoEm),
      ),
    )
    .orderBy(desc(conviteUtilizador.criadoEm));

  return linhas as LinhaConvite[];
}

/** A sociedade, para o ecrã de dados e de T&C. */
export async function sociedadeDe(organizacaoId: string) {
  const [org] = await db()
    .select()
    .from(organizacao)
    .where(eq(organizacao.id, organizacaoId))
    .limit(1);
  return org ?? null;
}

/**
 * Nomes das sociedades indicadas, para o seletor de sociedade ativa
 * (BUG3-002) — a única vez que o `id`, sem mais, precisa de virar algo
 * legível. Vazio devolve vazio sem consultar nada: é o caso comum, de uma
 * conta com uma única sociedade e nenhum seletor a mostrar.
 */
export async function sociedadesPorIds(ids: string[]) {
  if (!ids.length) return [];
  return db()
    .select({ id: organizacao.id, nome: organizacao.nome })
    .from(organizacao)
    .where(inArray(organizacao.id, ids));
}

/** Os documentos da sociedade — os que não pertencem a ninguém em concreto. */
export async function documentosDaSociedadeAdmin(organizacaoId: string) {
  return db()
    .select({
      id: documentoOrganizacao.id,
      nome: documentoOrganizacao.nomeOriginal,
      tipo: documentoOrganizacao.tipo,
      bytes: documentoOrganizacao.tamanhoBytes,
      criadoEm: documentoOrganizacao.criadoEm,
    })
    .from(documentoOrganizacao)
    .where(
      and(
        eq(documentoOrganizacao.organizacaoId, organizacaoId),
        isNull(documentoOrganizacao.conviteId),
        isNull(documentoOrganizacao.apagadoEm),
      ),
    )
    .orderBy(desc(documentoOrganizacao.criadoEm));
}

/**
 * Todas as aceitações de T&C da sociedade, por ordem cronológica.
 *
 * Este é o ecrã que uma validação jurídica vai pedir para ver: quem aceitou o
 * quê, quando e de onde. Não é uma lista de pessoas com um visto — é a lista
 * das **linhas de prova**, incluindo as das versões antigas, porque é
 * exatamente isso que a D3 manda preservar. Uma pessoa que tenha aceitado três
 * versões ao longo de quatro anos aparece três vezes, e é assim que tem de ser.
 */
export async function aceitacoesDaSociedade(organizacaoId: string) {
  return db()
    .select({
      id: aceitacaoTermos.id,
      versao: aceitacaoTermos.versao,
      aceiteEm: aceitacaoTermos.aceiteEm,
      ip: aceitacaoTermos.ip,
      documentoRef: aceitacaoTermos.documentoRef,
      nome: utilizador.nome,
      email: utilizador.email,
      papel: utilizador.papel,
      /**
       * O email do convite serve de recuo quando a conta ainda não existe.
       *
       * Uma aceitação dada no passo 5 e um registo abandonado no passo 6 dão
       * exatamente isso: prova válida, sem utilizador do outro lado. Deixá-la
       * sem nome na lista seria esconder uma linha de prova por uma razão de
       * apresentação.
       */
      emailConvite: conviteUtilizador.email,
      nomeConvite: conviteUtilizador.nome,
    })
    .from(aceitacaoTermos)
    .leftJoin(utilizador, eq(utilizador.id, aceitacaoTermos.utilizadorId))
    .leftJoin(conviteUtilizador, eq(conviteUtilizador.id, aceitacaoTermos.conviteId))
    .where(eq(aceitacaoTermos.organizacaoId, organizacaoId))
    .orderBy(desc(aceitacaoTermos.aceiteEm));
}

/** Contagens para o cabeçalho da página da equipa. */
export async function resumoEquipa(organizacaoId: string) {
  const [ativos] = await db()
    .select({ n: count() })
    .from(utilizador)
    .where(
      and(
        eq(utilizador.organizacaoId, organizacaoId),
        eq(utilizador.ativo, true),
        isNull(utilizador.apagadoEm),
      ),
    );

  const [pendentes] = await db()
    .select({ n: count() })
    .from(conviteUtilizador)
    .where(
      and(
        eq(conviteUtilizador.organizacaoId, organizacaoId),
        eq(conviteUtilizador.estado, "pendente"),
        isNull(conviteUtilizador.apagadoEm),
      ),
    );

  return { ativos: ativos?.n ?? 0, convitesPendentes: pendentes?.n ?? 0 };
}
