import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id } from "./_comum";
import { canalEmail, estadoEmail, templateEmail } from "./enums";
import { organizacao } from "./organizacao";
import { processoOnboarding } from "./processo";

/**
 * Registo de todos os emails que o sistema tentou enviar.
 *
 * Uma linha por tentativa, escrita por `enviarEmail` — o que quer dizer que
 * nenhum caminho de envio a pode esquecer, incluindo os que ainda não existem.
 * O sucesso e o erro entram os dois: "não chegou nada ao cliente" é a pergunta
 * que se faz, e ela só tem resposta se as falhas ficarem gravadas com o motivo.
 *
 * Não é auditoria e não a substitui. `evento_auditoria` é append-only, com
 * cadeia de hashes, e continua a registar o que o envio de um link significa
 * para o processo (`link.enviado` / `link.envio_falhou`); isto é o diário
 * técnico do canal de email, que se limpa e se recria sem consequência legal.
 *
 * Não guarda o corpo da mensagem. Um email de boas-vindas leva o resumo do
 * processo em anexo, e duplicar dados pessoais numa tabela de diagnóstico é
 * multiplicar a superfície de um sistema sujeito ao RGPD sem nada ganhar.
 */
export const emailLog = pgTable(
  "email_log",
  {
    id: id(),
    /**
     * Nulo quando o envio acontece fora do contexto de uma organização. Hoje
     * não acontece; a coluna aceita-o para que um envio nunca fique por
     * registar só porque não se soube a quem atribuí-lo.
     */
    organizacaoId: uuid("organizacao_id").references(() => organizacao.id, {
      onDelete: "set null",
    }),
    /**
     * `set null` e não `cascade`: apagar um processo não pode apagar a prova de
     * que se escreveu ao cliente. A linha fica, sem processo.
     */
    processoId: uuid("processo_id").references(() => processoOnboarding.id, {
      onDelete: "set null",
    }),
    /** Destinatário, tal como foi passado ao fornecedor. */
    para: text("para").notNull(),
    assunto: text("assunto").notNull(),
    template: templateEmail("template").notNull(),
    /**
     * SHA-256 do token do link mágico, quando o email leva um — e nunca o token
     * em claro. Guardá-lo aqui desfazia a D4: bastava ler esta tabela para
     * entrar em qualquer dossier. O hash chega para cruzar a linha com
     * `processo_onboarding.token_acesso_hash` e responder a "que link é que foi
     * enviado nesta mensagem".
     */
    tokenHash: text("token_hash"),
    estado: estadoEmail("estado").notNull(),
    /**
     * Preenchido quando há motivo: o erro do fornecedor a recusar o envio, ou a
     * razão de um `devolvido`. Um `entregue` não o apaga — a razão de uma
     * tentativa anterior ter falhado continua a valer.
     */
    erro: text("erro"),
    /**
     * Qual dos dois canais aceitou a mensagem. Nulo quando nenhum aceitou.
     *
     * É o que decide a quem se pergunta pelo desfecho: o `mensagem_id` de um
     * fornecedor não quer dizer nada no outro.
     */
    canal: canalEmail("canal"),
    /**
     * O identificador que o fornecedor deu à mensagem — o `id` do Resend, o
     * `messageId` do Brevo. Não é segredo (não abre nada, ao contrário do
     * token) e é a única forma de voltar a perguntar-lhe o que fez com ela.
     *
     * Nulo quando o fornecedor aceitou sem devolver id reconhecível: nesse
     * caso a entrega não é confirmável, e a linha fica em `enviado` para
     * sempre.
     */
    mensagemId: text("mensagem_id"),
    /**
     * Quando é que o desfecho foi confirmado junto do fornecedor. Nulo enquanto
     * ninguém tiver perguntado — que é o que distingue "ainda não se sabe" de
     * "perguntou-se e ele disse que entregou".
     */
    verificadoEm: timestamp("verificado_em", { withTimezone: true }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("email_log_criado").on(t.criadoEm),
    index("email_log_processo").on(t.processoId),
    index("email_log_estado").on(t.estado),
    // Para chegar à linha a partir de um id do painel do fornecedor — e, um
    // dia, a partir do corpo de um webhook.
    index("email_log_mensagem").on(t.mensagemId),
  ],
);
