import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { emailLog, emailModelo } from "@/db/schema/email";
import { processoOnboarding } from "@/db/schema/processo";
import type { CanalEmail, EstadoEmail, TemplateEmail } from "./rotulos";
import {
  METADADOS_TEMPLATES,
  TEMPLATES_EDITAVEIS,
  type TemplateEditavel,
} from "@/lib/emails/personalizacao";

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

/** Tecto de segurança numa página sem paginação — a página avisa quando a lista sai cortada. */
export const LIMITE = 500;

/** Função própria porque a listagem e as contagens de facetas têm de usar as mesmas condições — senão o botão diz "3" e a lista mostra 5. */
function condicoes(organizacaoId: string, { q, estado, template }: FiltrosEmails): SQL[] {
  // Sociedade de quem lê, sempre primeiro — esta tabela guarda endereços de
  // clientes, e sem este filtro seria a lista de contactos de outra sociedade.
  const onde: SQL[] = [eq(emailLog.organizacaoId, organizacaoId)];

  const termo = q?.trim();
  if (termo) {
    const like = `%${termo}%`;
    // Sem unaccent, ao contrário de /processos: pesquisa endereços, assuntos e
    // referências — nenhum é nome próprio onde o acento decida o resultado.
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

/** Diário do canal de email, do mais recente ao mais antigo. `left join` deliberado: um processo apagado deixa `processo_id` null, e `inner join` esconderia essas linhas. */
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

/** Mensagens de um processo, para a secção ao lado da auditoria — menos colunas que `LinhaEmail`, já se sabe de que processo se trata. */
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
 * O que a plataforma escreveu ao cliente neste processo, por ordem crescente
 * — ao contrário de `/emails`, para ficar ao lado da auditoria (mesmo
 * sentido). `organizacaoId` exigido e não inferido do processo, mesma razão
 * de `listarEmails`: um id de processo vindo do URL não prova de quem ele é.
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

/** Contagens por estado e template para os botões de filtro — sem o filtro da própria faceta, para o filtro ficar navegável. */
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

/* ------------------------------------------- modelos de email da sociedade */

export type ModeloEmailItem = {
  template: TemplateEditavel;
  titulo: string;
  descricao: string;
  personalizado: boolean;
  assunto: string;
  corpoHtml: string;
  assuntoPadrao: string;
  corpoHtmlPadrao: string;
  corAcento: string;
  atualizadoEm: Date | string | null;
  atualizadoPor: string | null;
};

/**
 * Consulta o estado de todos os templates editáveis para a sociedade indicada.
 * Devolve a lista ordenada com indicação de quais estão personalizados ou em padrão.
 */
export async function consultarModelosEmail(
  organizacaoId: string,
): Promise<ModeloEmailItem[]> {
  const modelosGuardados = await db()
    .select()
    .from(emailModelo)
    .where(eq(emailModelo.organizacaoId, organizacaoId));

  const mapaGuardados = new Map(
    modelosGuardados.map((m) => [m.template as TemplateEditavel, m]),
  );

  return TEMPLATES_EDITAVEIS.map((template) => {
    const meta = METADADOS_TEMPLATES[template];
    const guardado = mapaGuardados.get(template);

    if (guardado) {
      return {
        template,
        titulo: meta.titulo,
        descricao: meta.descricao,
        personalizado: true,
        assunto: guardado.assunto,
        corpoHtml: guardado.corpoHtml,
        assuntoPadrao: meta.assuntoPadrao,
        corpoHtmlPadrao: meta.corpoHtmlPadrao,
        corAcento: meta.corAcento,
        atualizadoEm: guardado.atualizadoEm,
        atualizadoPor: guardado.atualizadoPor,
      };
    }

    return {
      template,
      titulo: meta.titulo,
      descricao: meta.descricao,
      personalizado: false,
      assunto: meta.assuntoPadrao,
      corpoHtml: meta.corpoHtmlPadrao,
      assuntoPadrao: meta.assuntoPadrao,
      corpoHtmlPadrao: meta.corpoHtmlPadrao,
      corAcento: meta.corAcento,
      atualizadoEm: null,
      atualizadoPor: null,
    };
  });
}

