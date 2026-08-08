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
 * Como correu a tentativa de envio. Só dois valores: ou o fornecedor aceitou a
 * mensagem, ou não aceitou. O que acontece depois de aceite — entregue, aberta,
 * devolvida — é do lado do Resend e viria por webhook; enquanto não houver,
 * `enviado` quer dizer "entregue ao fornecedor" e não "chegou à caixa".
 */
export const estadoEmail = pgEnum("estado_email", ["enviado", "erro"]);

/** Regime de IVA — percurso Empresa. Por validar contra imagem (A18). */
export const regimeIva = pgEnum("regime_iva", [
  "normal",
  "isento_art53",
  "isento_art9",
  "misto",
]);
