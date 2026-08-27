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

/**
 * `Partial` e não `Record` completo: o enum da base de dados guarda valores que
 * a aplicação já não escreve — `reabertura` deixou de existir quando a
 * reabertura de processos rejeitados foi removida, e o valor fica no
 * `template_email` porque um `ALTER TYPE` não os retira. Quem lê este mapa
 * cai no próprio valor da coluna (`?? l.template`), que é o que mantém legível
 * uma linha antiga de `email_log` sem ressuscitar o rótulo de uma
 * funcionalidade que já não há.
 */
export const ROTULOS_TEMPLATE: Partial<Record<TemplateEmail, string>> = {
  registo: "Registo",
  confirmacao_rececao: "Confirmação de receção",
  boas_vindas: "Boas-vindas",
  notificacao_backoffice: "Aviso interno",
  rejeicao: "Rejeição",
  credenciais_acesso: "Credenciais de acesso",
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

/**
 * A cor de cada estado, na paleta do §3.
 *
 * O carmim (`selo`) é para o que não chegou — o erro de envio e o devolvido são
 * o mesmo problema visto de dois sítios. O verde-arquivo é a única confirmação
 * a sério que esta tabela tem. O latão fica para a queixa de spam, que não é
 * falha de entrega mas exige atenção. O «Aceite» fica cinzento de propósito:
 * não é bom nem mau, é o estado em que ainda não se sabe.
 *
 * Vive aqui, ao lado dos rótulos, e não na página que primeiro precisou dele:
 * o mesmo estado aparece agora em dois sítios — o diário em `/emails` e a
 * secção do dossier — e duas tabelas de cores com o mesmo significado divergem
 * na primeira vez que alguém acrescenta um valor ao enum a partir de um deles.
 */
export const TOM_ESTADO: Partial<Record<EstadoEmail, string>> = {
  erro: "border-selo/40 bg-selo/10 text-selo",
  devolvido: "border-selo/40 bg-selo/10 text-selo",
  queixa: "border-latao/40 bg-latao/10 text-latao",
  entregue: "border-arquivo/40 bg-arquivo/10 text-arquivo",
};

export const ROTULOS_CANAL: Record<CanalEmail, string> = {
  brevo: "Brevo",
  resend: "Resend",
  mailjet: "Mailjet",
  smtp: "SMTP próprio",
};
