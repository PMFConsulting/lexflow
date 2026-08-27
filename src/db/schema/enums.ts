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

/**
 * Três níveis, e não os quatro cargos de escritório que aqui estavam
 * (`admin`/`socio`/`advogado`/`assistente`).
 *
 * A diferença não é de nomes: os quatro antigos descreviam a **hierarquia de
 * uma sociedade** e por isso viviam todos dentro dela. O que a plataforma
 * passou a precisar é de um nível **acima** da sociedade — quem cria as
 * sociedades não pertence a nenhuma, e não havia forma de o dizer com um enum
 * em que todos os valores pressupunham uma.
 *
 * - `super_admin` — dono da plataforma. `organizacao_id` é **NULL** (ver a
 *   restrição `utilizador_org_por_papel` em `organizacao.ts`), e é essa
 *   ausência, e não o papel sozinho, que o mantém fora do âmbito de qualquer
 *   sociedade: todas as consultas do back-office comparam a organização do
 *   processo com a de quem lê, e `NULL` nunca é igual a nada.
 * - `society_admin` — o que era `admin`: gere a sua sociedade.
 * - `utilizador` — o que eram `socio`, `advogado` e `assistente`.
 *
 * A migração `0016` faz o mapeamento nesse sentido e não noutro. `admin` →
 * `society_admin` porque os três de produção são a equipa da sociedade e não da
 * plataforma; os outros três → `utilizador` porque a alternativa (perder o
 * `advogado` para um nível sem aprovação) tirava capacidade a quem já a tinha,
 * que é o género de migração que só se descobre no dia em que alguém não
 * consegue trabalhar.
 *
 * Ao contrário dos `ADD VALUE` dos outros enums deste ficheiro, aqui há valores
 * a **desaparecer** — e um enum do Postgres não perde valores por ALTER. Daí a
 * migração criar o tipo de raiz e converter a coluna com `USING`; a ordem deste
 * array é a da criação do tipo novo e não a de acrescentos sucessivos.
 */
export const papelUtilizador = pgEnum("papel_utilizador", [
  "super_admin",
  "society_admin",
  "utilizador",
  "gestor",
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
  /**
   * Oitavo e nono: os dois convites que abrem os percursos internos — o da
   * sociedade (o link que a leva ao seu próprio onboarding) e o de cada pessoa
   * que se junta a ela. Vão para o mesmo `email_log` que os do cliente, e é o
   * mesmo motivo: a pergunta "o convite chegou?" tem exatamente a mesma forma
   * que "o registo chegou?", e um diário que respondesse a uma e não à outra
   * obrigava a ir ao servidor para metade dos casos.
   *
   * No fim do array porque é aí que o `ALTER TYPE ADD VALUE` os põe.
   */
  "convite_sociedade",
  "convite_utilizador",
  /**
   * Décimo: as credenciais de acesso de uma conta criada por um administrador.
   *
   * É o único email da lista que leva uma palavra-passe no corpo, e é por isso
   * que o corpo não é guardado em lado nenhum — nem aqui (o `email_log` regista
   * assunto e destinatário, D34), nem em `evento_auditoria`, que dura sete anos.
   * O que fica registado é a mesma coisa que fica registado para os outros: que
   * a mensagem foi tentada, para quem, e como correu.
   *
   * A palavra-passe que ela transporta é temporária: quem a recebe é obrigado a
   * definir outra no primeiro início de sessão
   * (`utilizador.deve_redefinir_password`).
   *
   * No fim do array porque é aí que o `ALTER TYPE ADD VALUE` o põe.
   */
  "credenciais_acesso",
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

/**
 * Where a firm's own onboarding stands.
 *
 * `rascunho` is the firm filling in; `submetido` is the data delivered and the
 * first administrator invited; `ativo` is the organisation working normally.
 * The distinction between the last two exists because there is a gap between
 * them that nobody controls — the firm submits, and the administrator only
 * exists once *they* finish their own onboarding. An organisation sitting at
 * `submetido` for a week is a first invitation nobody opened, and that is a
 * thing worth being able to see.
 */
export const estadoOnboardingSociedade = pgEnum("estado_onboarding_sociedade", [
  "rascunho",
  "submetido",
  "ativo",
]);

/**
 * Where an invitation stands.
 *
 * `expirado` is deliberately **not** here. Expiry is a date, not a state, and
 * the two disagree the moment nobody runs the job that would flip it — an
 * invitation that expired on Sunday would still read `pendente` on Monday.
 * `expira_em` against the clock is the single source of that answer.
 */
export const estadoConvite = pgEnum("estado_convite", [
  "pendente",
  "aceite",
  "cancelado",
]);

/**
 * The types of document that belong to the firm or to one of its people, as
 * opposed to a client matter (`tipo_documento`).
 *
 * Two lists and not one because they answer different questions and are shown
 * in different places: nobody attaches a permanent certificate to a lawyer, and
 * nobody attaches a bar card to a matter. Merging them would give every dropdown
 * on both sides a set of options that cannot apply.
 */
export const tipoDocumentoOrganizacao = pgEnum("tipo_documento_organizacao", [
  /** The firm's own Terms and Conditions — the wording its clients accept. */
  "termos_sociedade",
  /** A person's identification document, from their onboarding. */
  "identificacao",
  /** The Bar Association card. */
  "cedula_profissional",
  /** The firm's permanent certificate. */
  "certidao_sociedade",
  "outro",
]);
