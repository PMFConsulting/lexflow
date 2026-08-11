import type { canalEmail, estadoEmail, templateEmail } from "@/db/schema/enums";

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
export type CanalEmail = (typeof canalEmail.enumValues)[number];

export const ROTULOS_TEMPLATE: Record<TemplateEmail, string> = {
  registo: "Registo",
  confirmacao_rececao: "Confirmação de receção",
  boas_vindas: "Boas-vindas",
  notificacao_backoffice: "Aviso interno",
  rejeicao: "Rejeição",
  reabertura: "Reabertura",
};

/**
 * `enviado` deixou de se chamar "Enviado" de propósito.
 *
 * O que a coluna diz é que o fornecedor ficou com a mensagem — nunca disse que
 * ela chegou, mas o rótulo dizia, e foi assim que uma mensagem que nunca chegou
 * à caixa apareceu neste ecrã indistinguível de dezanove que chegaram. "Aceite"
 * é a afirmação estreita, e a diferença para "Entregue" está agora à vista na
 * mesma coluna.
 */
export const ROTULOS_ESTADO: Record<EstadoEmail, string> = {
  enviado: "Aceite",
  erro: "Erro",
  entregue: "Entregue",
  devolvido: "Devolvido",
  queixa: "Spam",
};

/**
 * Os estados em que o cliente **não** ficou com a mensagem na caixa dele.
 *
 * Numa lista só, é isto que se conta no cabeçalho e é isto que se pinta a
 * carmim. Um devolvido não é menos grave do que um erro de envio: nos dois
 * casos há um dossier sem link e alguém à espera.
 */
export const ESTADOS_FALHADOS: readonly EstadoEmail[] = ["erro", "devolvido", "queixa"];

export const ROTULOS_CANAL: Record<CanalEmail, string> = {
  brevo: "Brevo",
  resend: "Resend",
  mailjet: "Mailjet",
  smtp: "SMTP próprio",
};
