import { pgEnum } from "drizzle-orm/pg-core";

export const tipoCliente = pgEnum("tipo_cliente", ["particular", "empresa"]);

/**
 * `aguardar_aprovacao` was added after the others (see migration 0013) and sits
 * right after `submetido`, which is where it enters the flow: a matter
 * submitted by the client goes on to await a partner's/lawyer's decision before
 * `aprovado` or `rejeitado`. The migration's
 * `ALTER TYPE ... ADD VALUE ... AFTER 'submetido'` has to put the value exactly
 * here — diverging on order makes the next `db:generate` propose a migration
 * fixing what is not broken.
 */
export const estadoProcesso = pgEnum("estado_processo", [
  "rascunho",
  "submetido",
  "aguardar_aprovacao",
  "em_revisao",
  "pendente_cliente",
  "aprovado",
  "rejeitado",
  "arquivado",
]);

export const nivelRisco = pgEnum("nivel_risco", ["baixo", "medio", "elevado"]);

export const papelUtilizador = pgEnum("papel_utilizador", [
  "admin",
  "socio",
  "advogado",
  "assistente",
]);

/** Types seen at step 2 of the real form. */
export const tipoDocId = pgEnum("tipo_doc_id", [
  "cartao_cidadao",
  "passaporte",
  "titulo_residencia",
  "outro",
]);

/**
 * The current form has a generic, uncategorised dropzone. We categorise anyway:
 * without a type there are no expiry alerts on the dashboard (docs/CAMPOS.md
 * §2).
 */
export const tipoDocumento = pgEnum("tipo_documento", [
  "identificacao",
  "comprovativo_nif",
  "certidao_permanente",
  "procuracao",
  "ata_designacao",
  "comprovativo_rcbe",
  "dossier_assinado",
  "outro",
  /**
   * The commercial proposal the firm attaches to the invitation, in the "Novo
   * processo" dialog. Unlike the other values in this list, it is not a
   * document the client uploads: it is a document they **receive** — step 7
   * shows it in place of the generic proposal, and that is the proposal they
   * accept.
   *
   * At the end of the array because that is where `ALTER TYPE ADD VALUE` puts
   * it (migration `0015`); diverging on order makes the next `db:generate`
   * propose a migration fixing what is not broken. Same note as `canal_email`.
   */
  "proposta_comercial",
  /**
   * The firm's own Terms and Conditions — the product review's slot (see
   * `docs/TERMOS_SOCIEDADE.md`). **Nothing writes it yet**: it is reserved for
   * the day the firm submits its wording, so that day is a UI change and not an
   * enum migration with the system running.
   */
  "termos_sociedade",
]);

/** Quem é o titular de uma nacionalidade — o cliente ou o representante. */
export const titularNacionalidade = pgEnum("titular_nacionalidade", [
  "cliente",
  "representante",
]);

export const origemContacto = pgEnum("origem_contacto", [
  "recomendacao",
  "pesquisa_online",
  "evento_conferencia",
  "outro",
]);

/**
 * Só o que é mesmo consentimento. Ver divergência D2 e ambiguidade A11 em
 * docs/CAMPOS.md: prestação do serviço e obrigações legais não se consentem.
 */
export const finalidadeConsentimento = pgEnum("finalidade_consentimento", [
  "newsletter",
  "convites_iniciativas",
  "declaracao_veracidade",
  "termos_condicoes",
  "proposta",
]);

/**
 * Que email é que a linha do `email_log` regista.
 *
 * São os três do documento da JMASSANO (D31) mais o aviso interno que sai para
 * a sociedade quando um processo é submetido — esse não é dela, mas sai pelo
 * mesmo canal e falha pelas mesmas razões, e um diário de emails que o omitisse
 * mentia por omissão. `reabertura` é o sexto: o aviso ao cliente quando um
 * processo rejeitado volta a `rascunho` para correção.
 */
export const templateEmail = pgEnum("template_email", [
  "registo",
  "confirmacao_rececao",
  "boas_vindas",
  "notificacao_backoffice",
  "rejeicao",
  "reabertura",
  /**
   * Sétimo: o código de verificação do fecho. É o único email desta lista que
   * carrega um segredo de curta duração — daí ficar de fora do `tokenHash` e
   * nunca levar o código para `email_log`, que guarda assunto e destinatário e
   * não o corpo (D34).
   */
  "otp",
]);

/**
 * Como correu a mensagem, do pedido ao desfecho.
 *
 * Os dois primeiros são sobre a **aceitação** pelo fornecedor: `erro` é ele a
 * recusar, `enviado` é ele a ficar com a mensagem. `enviado` nunca quis dizer
 * "chegou à caixa", e era esse o problema — num teste de vinte empresas, uma
 * das mensagens ficou em `enviado` e nunca chegou a lado nenhum, e a plataforma
 * não tinha como o dizer.
 *
 * Os três últimos são o desfecho, perguntado ao fornecedor alguns minutos
 * depois (`confirmarEntrega`, em `lib/email.ts`). Uma linha que fique em
 * `enviado` é agora uma afirmação estreita e honesta: aceite, entrega por
 * confirmar.
 *
 * A ordem é a de acrescento no Postgres e não a lógica — `ALTER TYPE ADD VALUE`
 * põe os valores novos no fim, e o array tem de bater certo com o tipo.
 */
export const estadoEmail = pgEnum("estado_email", [
  "enviado",
  "erro",
  "entregue",
  "devolvido",
  "queixa",
]);

/**
 * Qual dos dois fornecedores aceitou a mensagem.
 *
 * Não é diagnóstico de luxo: é o que decide a **quem** se pergunta se a
 * mensagem chegou. O id que o Brevo devolve não existe no Resend, e a consulta
 * de entrega de cada um tem endereço, header e formato de resposta próprios —
 * sem esta coluna, um `mensagem_id` guardado sozinho não se sabe interpretar.
 */
export const canalEmail = pgEnum("canal_email", ["brevo", "resend", "mailjet", "smtp"]);

/** Regime de IVA — percurso Empresa. Por validar contra imagem (A18). */
export const regimeIva = pgEnum("regime_iva", [
  "normal",
  "isento_art53",
  "isento_art9",
  "misto",
]);
