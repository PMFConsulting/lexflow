import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { emailLog } from "@/db/schema/email";
import { processoOnboarding } from "@/db/schema/processo";
import type { CanalEmail, EstadoEmail, TemplateEmail } from "./rotulos";

export type { CanalEmail, EstadoEmail, TemplateEmail };

export type LinhaEmail = {
  id: string;
  para: string;
  assunto: string;
  template: TemplateEmail;
  estado: EstadoEmail;
  erro: string | null;
  criadoEm: Date | string;
  processoId: string | null;
  referencia: string | null;
  /** Quem aceitou a mensagem e com que id — o par que se leva ao painel dele. */
  canal: CanalEmail | null;
  mensagemId: string | null;
  /** Quando é que o desfecho foi confirmado. Nulo enquanto ninguém perguntou. */
  verificadoEm: Date | string | null;
};

export type FiltrosEmails = {
  q?: string;
  estado?: EstadoEmail[];
  template?: TemplateEmail[];
};

/**
 * Tecto de segurança numa página sem paginação. A página avisa quando a lista
 * sai cortada — um corte silencioso lia-se como "é isto que há".
 */
export const LIMITE = 500;

/**
 * Só o que interessa filtrar. Fica numa função porque a listagem e as contagens
 * das facetas têm de usar exatamente as mesmas condições — se divergirem, o
 * botão diz "3" e a lista mostra 5.
 */
function condicoes(organizacaoId: string, { q, estado, template }: FiltrosEmails): SQL[] {
  // A sociedade de quem lê, sempre e antes de tudo o resto. Esta tabela guarda
  // endereços de clientes ao lado do assunto da mensagem, e uma listagem sem
  // este filtro era a lista de contactos de outra sociedade servida a quem
  // abrisse a página. `organizacao_id` é anulável no schema (um envio fora do
  // contexto de uma sociedade); uma linha assim não pertence a nenhuma
  // listagem, e a igualdade deixa-a de fora sem ser preciso dizer mais nada.
  const onde: SQL[] = [eq(emailLog.organizacaoId, organizacaoId)];

  const termo = q?.trim();
  if (termo) {
    const like = `%${termo}%`;
    // Sem `unaccent` aqui, ao contrário de `/processos`: o que se pesquisa são
    // endereços de email, assuntos escritos por nós e referências — nenhum
    // deles é um nome próprio onde o acento decida o resultado.
    const alvo = or(
      ilike(emailLog.para, like),
      ilike(emailLog.assunto, like),
      ilike(processoOnboarding.referencia, like),
    );
    if (alvo) onde.push(alvo);
  }

  if (estado?.length) onde.push(inArray(emailLog.estado, estado));
  if (template?.length) onde.push(inArray(emailLog.template, template));

  return onde;
}

/**
 * O diário do canal de email, do mais recente para o mais antigo.
 *
 * O `left join` é deliberado: um processo apagado deixa a linha do log com
 * `processo_id` a null (ver a FK, em `db/schema/email.ts`), e um `inner join`
 * fazia desaparecer da lista exatamente as mensagens cujo destino já não
 * existe — que são as que alguém iria lá procurar.
 */
export async function listarEmails(
  organizacaoId: string,
  filtros: FiltrosEmails = {},
): Promise<LinhaEmail[]> {
  const onde = condicoes(organizacaoId, filtros);

  return db()
    .select({
      id: emailLog.id,
      para: emailLog.para,
      assunto: emailLog.assunto,
      template: emailLog.template,
      estado: emailLog.estado,
      erro: emailLog.erro,
      criadoEm: emailLog.criadoEm,
      processoId: emailLog.processoId,
      referencia: processoOnboarding.referencia,
      canal: emailLog.canal,
      mensagemId: emailLog.mensagemId,
      verificadoEm: emailLog.verificadoEm,
    })
    .from(emailLog)
    .leftJoin(processoOnboarding, eq(processoOnboarding.id, emailLog.processoId))
    .where(onde.length ? and(...onde) : undefined)
    .orderBy(desc(emailLog.criadoEm))
    .limit(LIMITE);
}

/* ------------------------------------------- o que saiu no âmbito de um processo */

/**
 * As mensagens de um processo, para a secção ao lado da auditoria.
 *
 * Menos colunas do que a `LinhaEmail`: aqui já se sabe de que processo se trata,
 * e a referência e o `processoId` seriam a mesma informação repetida em todas as
 * linhas.
 */
export type LinhaEmailDoProcesso = {
  id: string;
  para: string;
  assunto: string;
  template: TemplateEmail;
  estado: EstadoEmail;
  erro: string | null;
  canal: CanalEmail | null;
  criadoEm: Date | string;
};

/**
 * O que a plataforma escreveu ao cliente no âmbito deste processo.
 *
 * **Por ordem crescente**, ao contrário de `/emails`: esta lista fica encostada
 * à auditoria, que é uma linha do tempo do mais antigo para o mais recente, e
 * duas cronologias lado a lado a correrem em sentidos opostos leem-se mal. São
 * meia dúzia de linhas por processo — não há aqui o problema que faz o diário
 * geral começar pelo fim.
 *
 * A `organizacaoId` é exigida e não inferida do processo, pela mesma razão que
 * `listarEmails` a exige: esta tabela guarda endereços de clientes, e um
 * identificador de processo vindo do URL não prova de quem ele é. As páginas que
 * chamam isto já confirmaram o par — passá-lo outra vez é o que garante que a
 * consulta não devolve nada se algum dia alguma delas se esquecer.
 */
export async function emailsDoProcesso(
  processoId: string,
  organizacaoId: string,
): Promise<LinhaEmailDoProcesso[]> {
  return db()
    .select({
      id: emailLog.id,
      para: emailLog.para,
      assunto: emailLog.assunto,
      template: emailLog.template,
      estado: emailLog.estado,
      erro: emailLog.erro,
      canal: emailLog.canal,
      criadoEm: emailLog.criadoEm,
    })
    .from(emailLog)
    .where(
      and(
        eq(emailLog.processoId, processoId),
        eq(emailLog.organizacaoId, organizacaoId),
      ),
    )
    .orderBy(asc(emailLog.criadoEm))
    .limit(LIMITE);
}

/**
 * Contagens por estado e por template, para os botões de filtro.
 *
 * Calculadas sobre a pesquisa mas *sem* o filtro da própria faceta — é o que
 * faz um filtro facetado ser navegável: os números continuam a dizer quanto é
 * que cada botão traz, mesmo com um deles já carregado.
 */
export async function facetasEmails(organizacaoId: string, filtros: FiltrosEmails = {}) {
  const base = db();

  const contar = async <T extends string>(
    coluna: typeof emailLog.estado | typeof emailLog.template,
    semEste: FiltrosEmails,
  ) => {
    const onde = condicoes(organizacaoId, semEste);
    const linhas = await base
      .select({ chave: sql<T>`${coluna}`.as("chave"), n: count() })
      .from(emailLog)
      .leftJoin(processoOnboarding, eq(processoOnboarding.id, emailLog.processoId))
      .where(onde.length ? and(...onde) : undefined)
      .groupBy(coluna);

    return linhas.map((l) => ({ chave: l.chave, n: Number(l.n) }));
  };

  const [porEstado, porTemplate] = await Promise.all([
    contar<EstadoEmail>(emailLog.estado, { ...filtros, estado: undefined }),
    contar<TemplateEmail>(emailLog.template, { ...filtros, template: undefined }),
  ]);

  return { porEstado, porTemplate };
}
