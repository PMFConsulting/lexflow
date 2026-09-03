import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { organizacao, utilizador } from "@/db/schema/organizacao";
import { emailLog } from "@/db/schema/email";
import { eventoAuditoria } from "@/db/schema/auditoria";
import { registarEvento } from "@/features/auditoria/registar";
import {
  aceitacaoTermos,
  conviteUtilizador,
  documentoOrganizacao,
  onboardingSociedade,
  perfilUtilizador,
} from "@/db/schema/sociedade";

/**
 * Direitos do titular (RGPD, artigos 15.º e 20.º) aplicados à **sociedade**
 * enquanto titular dos dados que a plataforma recolhe dela própria — registo,
 * equipa, administradores e documentos da organização.
 *
 * Âmbito propositadamente definido: os processos de clientes finais e os
 * documentos neles anexados **não** entram. Esses dados são de clientes da
 * sociedade — a sociedade é responsável pelo tratamento, a plataforma trata
 * por sua conta, e a retenção legal de sete anos (Lei 83/2017) prevalece
 * sobre qualquer pedido. Confundir os dois planos seria entregar num pedido
 * de portabilidade da sociedade os dados de terceiros, o que o RGPD proíbe.
 */

/** Quantos registos de auditoria se incluem na exportação — limite de sanidade para POC. */
export const LIMITE_AUDITORIA_EXPORTACAO = 1000;

export type DadosExportados = {
  geradoEm: Date;
  plataforma: string;
  sociedade: typeof organizacao.$inferSelect | null;
  onboarding: typeof onboardingSociedade.$inferSelect | null;
  utilizadores: (typeof utilizador.$inferSelect)[];
  convites: (typeof conviteUtilizador.$inferSelect)[];
  perfis: (typeof perfilUtilizador.$inferSelect)[];
  aceitacoesTermos: (typeof aceitacaoTermos.$inferSelect)[];
  documentos: {
    id: string;
    nome: string;
    tipo: string;
    mime: string;
    bytes: number;
    conviteId: string | null;
    criadoEm: Date;
    conteudoBase64?: string | null;
    localizacao: "base_de_dados" | "s3";
  }[];
  registosEmail: (typeof emailLog.$inferSelect)[];
  auditoria: (typeof eventoAuditoria.$inferSelect)[];
  nota: string;
};

/**
 * Reúne os dados pessoais da organização num objeto JSON — o pedido de
 * acesso (artigo 15.º) e de portabilidade (artigo 20.º) da sociedade.
 *
 * Devolve a estrutura inteira (sem serializar), quem chama decide como a
 * entregar — o JSON vem da rota de API. Datas ficam como `Date`; o
 * `JSON.stringify` trata delas.
 */
export async function exportarDadosDaSociedade(organizacaoId: string): Promise<DadosExportados> {
  const base = db();

  const [sociedade] = await base
    .select()
    .from(organizacao)
    .where(and(eq(organizacao.id, organizacaoId), isNull(organizacao.apagadoEm)))
    .limit(1);

  if (!sociedade) {
    throw new Error("Sociedade não encontrada.");
  }

  const [onboarding] = await base
    .select()
    .from(onboardingSociedade)
    .where(eq(onboardingSociedade.organizacaoId, organizacaoId))
    .limit(1);

  const [utilizadores, convites, perfis, aceitacoes, documentos, registosEmail] =
    await Promise.all([
      base
        .select()
        .from(utilizador)
        .where(
          and(eq(utilizador.organizacaoId, organizacaoId), isNull(utilizador.apagadoEm)),
        ),
      base
        .select()
        .from(conviteUtilizador)
        .where(
          and(
            eq(conviteUtilizador.organizacaoId, organizacaoId),
            isNull(conviteUtilizador.apagadoEm),
          ),
        ),
      base
        .select()
        .from(perfilUtilizador)
        .where(
          and(
            eq(perfilUtilizador.organizacaoId, organizacaoId),
            isNull(perfilUtilizador.apagadoEm),
          ),
        ),
      base.select().from(aceitacaoTermos).where(eq(aceitacaoTermos.organizacaoId, organizacaoId)),
      base
        .select()
        .from(documentoOrganizacao)
        .where(
          and(
            eq(documentoOrganizacao.organizacaoId, organizacaoId),
            isNull(documentoOrganizacao.apagadoEm),
          ),
        ),
      base.select().from(emailLog).where(eq(emailLog.organizacaoId, organizacaoId)),
    ]);

  // A auditoria pode ser longa; inclui-se o mais recente, com limite, e a
  // nota no fim diz que o registo completo fica na plataforma.
  const auditoria = await base
    .select()
    .from(eventoAuditoria)
    .where(eq(eventoAuditoria.organizacaoId, organizacaoId))
    .orderBy(desc(eventoAuditoria.criadoEm))
    .limit(LIMITE_AUDITORIA_EXPORTACAO);

  return {
    geradoEm: new Date(),
    plataforma: "LexFlow",
    sociedade,
    onboarding: onboarding ?? null,
    utilizadores,
    convites,
    perfis,
    aceitacoesTermos: aceitacoes,
    documentos: documentos.map((d) => ({
      id: d.id,
      nome: d.nomeOriginal,
      tipo: d.tipo,
      mime: d.mime,
      bytes: d.tamanhoBytes,
      conviteId: d.conviteId,
      criadoEm: d.criadoEm,
      // Só se inclui o conteúdo quando ele vive na base (compromisso de POC,
      // D66). Documentos em S3 são referenciados pela chave de armazenamento
      // e ficam fora do JSON — são lidos pelo armazenamento da sociedade.
      conteudoBase64: d.dados,
      localizacao: d.dados ? "base_de_dados" : "s3",
    })),
    registosEmail,
    auditoria,
    nota:
      "Exportação dos dados pessoais da sociedade recolhidos pela plataforma LexFlow, gerada " +
      `em ${new Date().toISOString()}. Não inclui dados de clientes finais nem documentos de ` +
      "processos (dados de terceiros sob responsabilidade da sociedade e sujeitos a retenção " +
      "legal de sete anos). A auditoria inclui os 1000 eventos mais recentes.",
  };
}

export type LinhaApagavel = {
  tabela: string;
  registos: number;
  /** O que se faz a cada linha — tudo apagamento lógico (soft delete), nunca remoção física. */
  acao: string;
};

export type ResultadoEliminacao =
  | {
      modo: "simulacao";
      geradoEm: Date;
      organizacaoId: string;
      motivo?: string;
      /** O que ficaria marcado para apagar, por tabela. */
      apagaria: LinhaApagavel[];
      /** O que se mantém e porquê. */
      mantem: { tabela: string; motivo: string }[];
    }
  | {
      modo: "executado";
      geradoEm: Date;
      organizacaoId: string;
      motivo: string;
      apagado: LinhaApagavel[];
      mantem: { tabela: string; motivo: string }[];
    };

/**
 * Eliminação dos dados da sociedade — **artigo 17.º, preparada com rede de
 * segurança, nunca destrutiva por omissão**.
 *
 * Por omissão (`confirmar: false`) corre em modo de simulação: mede o que
 * seria apagado e não escreve uma linha. A execução real exige
 * `confirmar: true` **e** um motivo — é o que impede um DELETE acidental de
 * apagar uma conta inteira; o motivo fica registado na auditoria.
 *
 * O que a execução faz é **apagamento lógico** (soft delete, `apagado_em`),
 * o padrão de toda a aplicação e o único compatível com as retenções legais:
 *
 * · A auditoria (`evento_auditoria`) é imutável por construção (REVOKE +
 *   RULE no Postgres, migração 0002) — não se apaga, e continua a ser a prova
 *   de tudo o que aconteceu;
 * · `aceitacao_termos` nunca é atualizada por design — cada linha é prova da
 *   aceitação de uma versão;
 * · `email_log` não tem soft delete e a FK para a organização é `set null`;
 * · documentos de **processos de clientes** não são tocados (dados de
 *   terceiros, retenção de sete anos);
 * · ficheiros em S3 seguem a lifecycle de sete anos já aplicada (migração
 *   0027) — esta função não apaga objetos do bucket.
 *
 * A remoção física (purga) é trabalho do processo de retenção, que corre
 * quando os prazos legais terminam — não desta função.
 *
 * ⚠ Execução sem transação: cada escrita é individual. Para produção, correr
 * dentro de uma transação é o passo que torna a eliminação atómica — fica
 * assinalado como nos restantes pontos de concorrência do sistema.
 */
export async function eliminarDadosDaSociedade(
  organizacaoId: string,
  opcoes: {
    confirmar?: boolean;
    motivo?: string;
    ip?: string | null;
    userAgent?: string | null;
  } = {},
): Promise<ResultadoEliminacao> {
  const base = db();

  const [sociedade] = await base
    .select()
    .from(organizacao)
    .where(eq(organizacao.id, organizacaoId))
    .limit(1);

  if (!sociedade) {
    throw new Error("Sociedade não encontrada.");
  }

  const [onboarding] = await base
    .select()
    .from(onboardingSociedade)
    .where(eq(onboardingSociedade.organizacaoId, organizacaoId))
    .limit(1);

  const [utilizadores, convites, perfis, documentos] = await Promise.all([
    base
      .select()
      .from(utilizador)
      .where(and(eq(utilizador.organizacaoId, organizacaoId), isNull(utilizador.apagadoEm))),
    base
      .select()
      .from(conviteUtilizador)
      .where(
        and(
          eq(conviteUtilizador.organizacaoId, organizacaoId),
          isNull(conviteUtilizador.apagadoEm),
        ),
      ),
    base
      .select()
      .from(perfilUtilizador)
      .where(
        and(
          eq(perfilUtilizador.organizacaoId, organizacaoId),
          isNull(perfilUtilizador.apagadoEm),
        ),
      ),
    base
      .select()
      .from(documentoOrganizacao)
      .where(
        and(
          eq(documentoOrganizacao.organizacaoId, organizacaoId),
          isNull(documentoOrganizacao.apagadoEm),
        ),
      ),
  ]);

  const apagaria: LinhaApagavel[] = [
    { tabela: "organizacao", registos: 1, acao: "soft delete (apagado_em)" },
    {
      tabela: "onboarding_sociedade",
      registos: onboarding ? 1 : 0,
      acao: "soft delete (apagado_em)",
    },
    { tabela: "convite_utilizador", registos: convites.length, acao: "soft delete (apagado_em)" },
    { tabela: "perfil_utilizador", registos: perfis.length, acao: "soft delete (apagado_em)" },
    {
      tabela: "utilizador",
      registos: utilizadores.length,
      acao: "soft delete (apagado_em) + ativo = false",
    },
    {
      tabela: "documento_organizacao",
      registos: documentos.length,
      acao: "soft delete (apagado_em); ficheiros S3 seguem a lifecycle de retenção",
    },
  ];

  const mantem = [
    {
      tabela: "evento_auditoria",
      motivo: "registo imutável por construção (REVOKE + RULE, migração 0002) — prova do que aconteceu",
    },
    {
      tabela: "aceitacao_termos",
      motivo: "prova imutável de aceitação de termos — nunca atualizada por design",
    },
    {
      tabela: "email_log",
      motivo: "registo técnico do canal de email; FK para a organização com set null",
    },
    {
      tabela: "processos e documentos de clientes",
      motivo: "dados de terceiros (clientes finais) — retenção legal de sete anos (Lei 83/2017)",
    },
  ];

  if (!opcoes.confirmar) {
    return {
      modo: "simulacao",
      geradoEm: new Date(),
      organizacaoId,
      motivo: opcoes.motivo,
      apagaria,
      mantem,
    };
  }

  const motivo = opcoes.motivo?.trim();
  if (!motivo) {
    throw new Error("Para eliminar dados é obrigatório indicar o motivo (parâmetro «motivo»).");
  }

  const agora = new Date();

  // O rasto primeiro, antes de marcar o que quer que seja: se a auditoria não
  // aceitar o evento, nada é apagado — uma eliminação sem prova é pior do que
  // uma eliminação adiada. `registarEvento` calcula a cadeia de hash (D6).
  await registarEvento({
    organizacaoId,
    acao: "sociedade.dados.eliminados",
    entidade: "organizacao",
    entidadeId: organizacaoId,
    valorNovo: { motivo },
    ip: opcoes.ip ?? null,
    userAgent: opcoes.userAgent ?? null,
  });

  if (onboarding) {
    await base
      .update(onboardingSociedade)
      .set({ apagadoEm: agora })
      .where(eq(onboardingSociedade.id, onboarding.id));
  }

  if (convites.length > 0) {
    await base
      .update(conviteUtilizador)
      .set({ apagadoEm: agora })
      .where(
        and(
          eq(conviteUtilizador.organizacaoId, organizacaoId),
          isNull(conviteUtilizador.apagadoEm),
        ),
      );
  }

  if (perfis.length > 0) {
    await base
      .update(perfilUtilizador)
      .set({ apagadoEm: agora })
      .where(
        and(
          eq(perfilUtilizador.organizacaoId, organizacaoId),
          isNull(perfilUtilizador.apagadoEm),
        ),
      );
  }

  if (utilizadores.length > 0) {
    await base
      .update(utilizador)
      .set({ apagadoEm: agora, ativo: false })
      .where(
        and(eq(utilizador.organizacaoId, organizacaoId), isNull(utilizador.apagadoEm)),
      );
  }

  if (documentos.length > 0) {
    await base
      .update(documentoOrganizacao)
      .set({ apagadoEm: agora })
      .where(
        and(
          eq(documentoOrganizacao.organizacaoId, organizacaoId),
          isNull(documentoOrganizacao.apagadoEm),
        ),
      );
  }

  await base
    .update(organizacao)
    .set({ apagadoEm: agora })
    .where(eq(organizacao.id, organizacaoId));

  return {
    modo: "executado",
    geradoEm: new Date(),
    organizacaoId,
    motivo,
    apagado: apagaria,
    mantem,
  };
}
