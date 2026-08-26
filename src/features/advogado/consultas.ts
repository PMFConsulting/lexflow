import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { utilizador } from "@/db/schema/organizacao";
import {
  conviteUtilizador,
  documentoOrganizacao,
  perfilUtilizador,
} from "@/db/schema/sociedade";

/**
 * As consultas do portal de cada pessoa da equipa.
 *
 * Tudo aqui é sobre **quem está a ver**, e o `utilizadorId` vem sempre da
 * sessão — nunca de um parâmetro. É a diferença entre um portal pessoal e uma
 * página que, com um id na barra de endereço, mostra o perfil e os documentos
 * de identificação de um colega.
 */

/** O perfil de quem está autenticado, se ele existir. */
export async function perfilDe(utilizadorId: string) {
  const [linha] = await db()
    .select()
    .from(perfilUtilizador)
    .where(
      and(
        eq(perfilUtilizador.utilizadorId, utilizadorId),
        isNull(perfilUtilizador.apagadoEm),
      ),
    )
    .limit(1);
  return linha ?? null;
}

/**
 * Os documentos que esta pessoa anexou no registo dela.
 *
 * Chega-se lá pelo convite: os documentos pendurados no `convite_id`, e o
 * convite é encontrado pelo `utilizador_id` que ficou lá gravado quando a conta
 * foi criada. Não é um `join` bonito, e é o correto — os documentos pertencem
 * ao momento do registo, e é esse momento que o convite representa.
 */
export async function documentosDe(utilizadorId: string) {
  const [convite] = await db()
    .select({ id: conviteUtilizador.id })
    .from(conviteUtilizador)
    .where(eq(conviteUtilizador.utilizadorId, utilizadorId))
    .orderBy(desc(conviteUtilizador.criadoEm))
    .limit(1);

  if (!convite) return [];

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
        eq(documentoOrganizacao.conviteId, convite.id),
        isNull(documentoOrganizacao.apagadoEm),
      ),
    )
    .orderBy(desc(documentoOrganizacao.criadoEm));
}

/** Os colegas, para o portal poder mostrar com quem se trabalha. */
export async function colegasDe(organizacaoId: string, exceto: string) {
  const linhas = await db()
    .select({
      id: utilizador.id,
      nome: utilizador.nome,
      email: utilizador.email,
      papel: utilizador.papel,
      cargo: perfilUtilizador.cargo,
    })
    .from(utilizador)
    .leftJoin(perfilUtilizador, eq(perfilUtilizador.utilizadorId, utilizador.id))
    .where(
      and(
        eq(utilizador.organizacaoId, organizacaoId),
        eq(utilizador.ativo, true),
        isNull(utilizador.apagadoEm),
      ),
    )
    .orderBy(utilizador.nome);

  // Sem a própria pessoa: «colegas» com o próprio nome na lista lê-se como um
  // erro, e ela já tem o seu perfil no topo da página.
  return linhas.filter((l) => l.id !== exceto);
}
