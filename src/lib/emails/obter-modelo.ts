import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { emailModelo } from "@/db/schema/email";
import {
  aplicarPlaceholders,
  comporHtmlPersonalizado,
  METADADOS_TEMPLATES,
  type TemplateEditavel,
} from "./personalizacao";
import {
  ASSUNTO_BOAS_VINDAS,
  ASSUNTO_CONFIRMACAO,
  ASSUNTO_REABERTURA,
  ASSUNTO_REJEICAO,
  emailBoasVindas,
  emailConfirmacaoRececao,
  emailReabertura,
  emailRejeicao,
} from "./jmassano";

export type ModeloEmailBase = {
  id: string;
  organizacaoId: string;
  template: TemplateEditavel;
  assunto: string;
  corpoHtml: string;
  atualizadoEm: Date;
  atualizadoPor: string | null;
};

/**
 * Consulta a base de dados pelo modelo personalizado de uma organização.
 * Nunca lança erros: devolve null se não existir ou se a leitura falhar.
 */
export async function obterModeloPersonalizado(
  organizacaoId: string | null | undefined,
  template: TemplateEditavel,
): Promise<ModeloEmailBase | null> {
  if (!organizacaoId) return null;

  try {
    const [modelo] = await db()
      .select()
      .from(emailModelo)
      .where(
        and(
          eq(emailModelo.organizacaoId, organizacaoId),
          eq(emailModelo.template, template),
        ),
      )
      .limit(1);

    return (modelo as ModeloEmailBase) ?? null;
  } catch (e) {
    console.warn(
      `[email] Erro ao ler modelo personalizado (org=${organizacaoId}, template=${template}) — a usar padrão`,
      e,
    );
    return null;
  }
}

export type ParametrosResolucaoEmail = {
  organizacaoId?: string | null;
  template: TemplateEditavel;
  variaveis: {
    nome_cliente?: string | null;
    referencia?: string | null;
    nome_sociedade?: string | null;
    link_processo?: string | null;
    motivo?: string | null;
    [chave: string]: string | null | undefined;
  };
  logotipoUrl?: string | null;
  anexosLista?: string[];
};

export type EmailResolvido = {
  personalizado: boolean;
  assunto: string;
  html: string;
};

/**
 * Resolve o assunto e o HTML final de um email para envio ao cliente:
 * - Se existir modelo personalizado na sociedade, aplica os placeholders e envolve na moldura.
 * - Caso contrário, recorre a 100% ao comportamento e template padrão do sistema.
 */
export async function resolverEmailCliente(
  p: ParametrosResolucaoEmail,
): Promise<EmailResolvido> {
  const modelo = await obterModeloPersonalizado(p.organizacaoId, p.template);

  if (modelo) {
    const metadados = METADADOS_TEMPLATES[p.template];
    const assunto = aplicarPlaceholders(modelo.assunto, p.variaveis);
    const corpoSemMoldura = aplicarPlaceholders(modelo.corpoHtml, p.variaveis);
    const html = comporHtmlPersonalizado(
      corpoSemMoldura,
      metadados.corAcento,
      p.logotipoUrl,
    );
    return {
      personalizado: true,
      assunto,
      html,
    };
  }

  // Fallback padrão retrocompatível
  switch (p.template) {
    case "confirmacao_rececao":
      return {
        personalizado: false,
        assunto: ASSUNTO_CONFIRMACAO,
        html: emailConfirmacaoRececao({
          nome: p.variaveis.nome_cliente,
          referencia: p.variaveis.referencia,
          logotipoUrl: p.logotipoUrl,
        }),
      };

    case "boas_vindas":
      return {
        personalizado: false,
        assunto: ASSUNTO_BOAS_VINDAS,
        html: emailBoasVindas({
          nome: p.variaveis.nome_cliente,
          referencia: p.variaveis.referencia ?? undefined,
          anexos: p.anexosLista ?? [],
          logotipoUrl: p.logotipoUrl,
        }),
      };

    case "rejeicao":
      return {
        personalizado: false,
        assunto: ASSUNTO_REJEICAO,
        html: emailRejeicao({
          nome: p.variaveis.nome_cliente,
          referencia: p.variaveis.referencia,
          logotipoUrl: p.logotipoUrl,
        }),
      };

    case "reabertura":
      return {
        personalizado: false,
        assunto: ASSUNTO_REABERTURA,
        html: emailReabertura({
          nome: p.variaveis.nome_cliente,
          referencia: p.variaveis.referencia,
          link: p.variaveis.link_processo,
          logotipoUrl: p.logotipoUrl,
        }),
      };
  }
}
