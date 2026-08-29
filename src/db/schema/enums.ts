import { pgEnum } from "drizzle-orm/pg-core";

export const tipoCliente = pgEnum("tipo_cliente", ["particular", "empresa"]);

/**
 * `aguardar_aprovacao` entrou depois dos outros (migração 0013), logo a
 * seguir a `submetido` — é aí que o `ALTER TYPE ... ADD VALUE ... AFTER` o
 * coloca; divergir na ordem faz o próximo `db:generate` propor uma migração
 * a corrigir o que não está partido.
 *
 * Dois valores sem caminho de escrita vivo, mantidos por causa de linhas
 * existentes: `submetido` é histórico anterior à 0013 (BUG3-003); `arquivado`
 * não é escrito por ação nenhuma hoje — arquivar é soft delete em `apagadoEm`,
 * mas `reabrirProcesso` continua a aceitá-lo como estado de origem (BUG3-007).
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

/**
 * Três níveis, não os quatro cargos antigos (`admin`/`socio`/`advogado`/
 * `assistente`) — a plataforma passou a precisar de um nível acima da
 * sociedade, que nenhum deles conseguia expressar.
 *
 * `super_admin` (`organizacao_id` NULL, fora do âmbito de qualquer
 * sociedade), `society_admin` (antigo `admin`), `utilizador` (antigos
 * `socio`/`advogado`/`assistente`). A migração 0016 faz este mapeamento.
 *
 * Ao contrário dos `ADD VALUE` dos outros enums, aqui há valores a
 * desaparecer — um enum do Postgres não perde valores por ALTER, daí a
 * migração criar o tipo de raiz e converter com `USING`.
 */
export const papelUtilizador = pgEnum("papel_utilizador", [
  "super_admin",
  "society_admin",
  "utilizador",
  "gestor",
]);

/** Tipos vistos no passo 2 do formulário real. */
export const tipoDocId = pgEnum("tipo_doc_id", [
  "cartao_cidadao",
  "passaporte",
  "titulo_residencia",
  "outro",
]);

/** Formulário atual tem dropzone genérica; categoriza-se na mesma — sem tipo não há alertas de validade no dashboard (CAMPOS.md §2). */
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
   * Proposta comercial anexada pela sociedade no diálogo "Novo processo" —
   * não é um documento que o cliente carrega, é um que recebe (passo 7). Fim
   * do array por ser onde o `ALTER TYPE ADD VALUE` a põe (migração 0015).
   */
  "proposta_comercial",
  /** T&C da própria sociedade — slot da revisão de produto (docs/TERMOS_SOCIEDADE.md), nada escreve ainda. */
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
 * Que email a linha do `email_log` regista: os três do documento JMASSANO
 * (D31), o aviso interno de submissão (mesmo canal, mesmas falhas) e
 * `reabertura` — aviso ao cliente quando um processo rejeitado volta a rascunho.
 */
export const templateEmail = pgEnum("template_email", [
  "registo",
  "confirmacao_rececao",
  "boas_vindas",
  "notificacao_backoffice",
  "rejeicao",
  "reabertura",
  /** Código de verificação do fecho — único com segredo de curta duração, fora do tokenHash e nunca gravado no corpo do log. */
  "otp",
  /** Convites que abrem os percursos internos: sociedade e utilizador — mesmo diário, mesma pergunta "chegou?". */
  "convite_sociedade",
  "convite_utilizador",
  /**
   * Credenciais de acesso de conta criada por admin — único email com
   * palavra-passe no corpo, por isso o corpo não é guardado em lado nenhum
   * (D34). Palavra-passe temporária (`deve_redefinir_password`).
   */
  "credenciais_acesso",
  /** Notificações operacionais ao dono da plataforma: sociedade criada e novo utilizador. */
  "notificacao_sociedade_criada",
  "notificacao_novo_utilizador",
]);

/**
 * Como correu a mensagem, do pedido ao desfecho. Os dois primeiros são sobre
 * aceitação pelo fornecedor (`enviado` nunca quis dizer "chegou à caixa" —
 * D50); os três últimos são o desfecho, perguntado minutos depois
 * (`confirmarEntrega`, `lib/email.ts`). Ordem é a de acrescento no Postgres, não a lógica.
 */
export const estadoEmail = pgEnum("estado_email", [
  "enviado",
  "erro",
  "entregue",
  "devolvido",
  "queixa",
]);

/**
 * Qual fornecedor aceitou a mensagem — decide a quem perguntar se chegou,
 * já que o id do Brevo não existe no Resend. `twilio_sendgrid` no fim (0022).
 */
export const canalEmail = pgEnum("canal_email", [
  "brevo",
  "resend",
  "mailjet",
  "smtp",
  "twilio_sendgrid",
]);

/** Regime de IVA — percurso Empresa. Por validar contra imagem (A18). */
export const regimeIva = pgEnum("regime_iva", [
  "normal",
  "isento_art53",
  "isento_art9",
  "misto",
]);

/**
 * Onde está o onboarding da sociedade: `rascunho` a preencher, `submetido`
 * dados entregues e primeiro admin convidado, `ativo` a funcionar. A
 * distinção entre os dois últimos existe porque há um intervalo que ninguém
 * controla — o admin só existe quando termina o próprio onboarding.
 */
export const estadoOnboardingSociedade = pgEnum("estado_onboarding_sociedade", [
  "rascunho",
  "submetido",
  "ativo",
]);

/**
 * Onde está um convite. `expirado` não entra de propósito — validade é data,
 * não estado, e sem um job a virá-lo ficaria `pendente` depois de expirar.
 * `expira_em` contra o relógio é a fonte única dessa resposta.
 */
export const estadoConvite = pgEnum("estado_convite", [
  "pendente",
  "aceite",
  "cancelado",
]);

/**
 * Documentos da sociedade ou das suas pessoas, ao contrário de um processo de
 * cliente (`tipo_documento`) — duas listas porque respondem a perguntas
 * diferentes; juntá-las daria a cada dropdown opções que não se aplicam.
 */
export const tipoDocumentoOrganizacao = pgEnum("tipo_documento_organizacao", [
  /** T&C da própria sociedade — o texto que os clientes aceitam. */
  "termos_sociedade",
  /** Documento de identificação de uma pessoa, do seu onboarding. */
  "identificacao",
  /** Cédula profissional da Ordem. */
  "cedula_profissional",
  /** Certidão permanente da sociedade. */
  "certidao_sociedade",
  "outro",
]);
