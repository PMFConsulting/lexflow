import type { estadoEmail, templateEmail } from "@/db/schema/enums";

/**
 * Rótulos e tipos do diário de emails, fora de `consultas.ts` de propósito.
 *
 * As consultas são `server-only`, e os filtros são um componente de cliente:
 * importar de lá os rótulos punha o `server-only` no pacote do browser e
 * rebentava o build. O import dos enums aqui é `import type` — apaga-se na
 * compilação, e o drizzle não vai atrás dele para o cliente.
 */
export type EstadoEmail = (typeof estadoEmail.enumValues)[number];
export type TemplateEmail = (typeof templateEmail.enumValues)[number];

export const ROTULOS_TEMPLATE: Record<TemplateEmail, string> = {
  registo: "Registo",
  confirmacao_rececao: "Confirmação de receção",
  boas_vindas: "Boas-vindas",
  notificacao_backoffice: "Aviso interno",
};

export const ROTULOS_ESTADO: Record<EstadoEmail, string> = {
  enviado: "Enviado",
  erro: "Erro",
};
