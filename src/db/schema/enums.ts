import { pgEnum } from "drizzle-orm/pg-core";

export const tipoCliente = pgEnum("tipo_cliente", ["particular", "empresa"]);

export const estadoProcesso = pgEnum("estado_processo", [
  "rascunho",
  "submetido",
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

/** Tipos vistos no passo 2 do formulário real. */
export const tipoDocId = pgEnum("tipo_doc_id", [
  "cartao_cidadao",
  "passaporte",
  "titulo_residencia",
  "outro",
]);

/**
 * O formulário atual tem um dropzone genérico, sem categorizar. Categorizamos
 * na mesma: sem tipo não há alertas de validade no painel (docs/CAMPOS.md §2).
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
 * mentia por omissão.
 */
export const templateEmail = pgEnum("template_email", [
  "registo",
  "confirmacao_rececao",
  "boas_vindas",
  "notificacao_backoffice",
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
export const canalEmail = pgEnum("canal_email", ["brevo", "resend"]);

/** Regime de IVA — percurso Empresa. Por validar contra imagem (A18). */
export const regimeIva = pgEnum("regime_iva", [
  "normal",
  "isento_art53",
  "isento_art9",
  "misto",
]);
