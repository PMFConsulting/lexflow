import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id } from "./_comum";
import { estadoEmail, templateEmail } from "./enums";
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
    /** Preenchido só quando `estado = 'erro'`. Mensagem do fornecedor, ou nossa. */
    erro: text("erro"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("email_log_criado").on(t.criadoEm),
    index("email_log_processo").on(t.processoId),
    index("email_log_estado").on(t.estado),
  ],
);
