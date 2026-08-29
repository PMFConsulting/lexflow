/**
 * Client-facing emails, all in one place.
 *
 * 1. LexFlow | Registro — sent with the form link, when the firm creates the matter.
 * 2. LexFlow | Confirmação de Receção dos seus Dados — on submission.
 * 3. Bem-vindo à LexFlow — on approval, with summary, T&C and fee proposal attached.
 * 4. LexFlow | Feedback Registro — on rejection. Follows the client's template
 *    of 11/08/2026 verbatim, replacing the in-house wording used until then.
 * 5. LexFlow | Código de verificação — the OTP at step 7 signature. The only
 *    one with no client document behind it; written here as a platform message.
 *
 * Emails 1-4 follow the client's subjects and bodies verbatim, including
 * "Registro" (not "Registo") and the open signature ("Assinatura do Advogado
 * gestor do Cliente"). Email 2's wording was adjusted for the approval flow
 * (migration `0013`): it now says the matter awaits approval and the decision
 * arrives by email, instead of "em análise" with no second contact. Email 4
 * (template of 11/08/2026) drops reference and reason, unlike the wording it
 * replaced — both stay recorded in the matter and the audit trail regardless.
 *
 * What the frame adds beyond the client's text: email 1's `(link)` becomes a
 * button plus plain-text address (nowhere to click in a parenthesis), email
 * 3's attachment list reflects what was actually generated, and the
 * confidentiality footer closes all four.
 *
 * Following the text verbatim means the greeting stays generic ("Caro(a)
 * Sr.(a)," — no room for a name) and the reference dropped from the body of
 * emails 2-4. `nome`/`referencia` stay in the signatures of the first three,
 * accepted and ignored, so either can come back without touching callers.
 * `emailRejeicao` had no other parameters, so it stopped taking any.
 */

/**
 * Palette and typography from `src/app/globals.css` (§3), in direct hex with
 * fallback fonts — email clients ignore CSS variables and most ignore
 * `@font-face`. Header rule colour by message type: terracotta (call to
 * act), brass (waiting), archive green (confirmation), carmine (rejection).
 */
import {
  ARQUIVO,
  botao,
  despedida,
  escapar,
  FONTE_CORPO,
  FONTE_MONO,
  LATAO,
  LINHA,
  linkCopiavel,
  MARCA,
  moldura,
  p,
  PAPEL,
  refProcesso,
  saudacao,
  SELO,
  TINTA,
  TINTA_SUAVE,
} from "./moldura";

/* ------------------------------------------------ 1. registration (the link) */

export const ASSUNTO_REGISTO = "LexFlow | Registro";

export function emailRegisto({
  nome,
  link,
  logotipoUrl,
}: {
  nome?: string | null;
  link: string;
  logotipoUrl?: string | null;
}): string {
  const href = escapar(link);
  return moldura(
    `
    ${saudacao(nome)}
    ${p(
      "É com grande satisfação que o recebemos como cliente da LexFlow.",
    )}
    ${p(
      "Agradecemos a confiança depositada na nossa equipa e reiteramos o nosso compromisso de prestar um serviço jurídico rigoroso, personalizado e orientado para a melhor defesa dos seus interesses.",
    )}
    ${p(
      "Para iniciarmos o acompanhamento do seu processo e cumprirmos as obrigações legais e regulamentares aplicáveis, solicitamos que efetue o seu registo através da nossa plataforma online:",
    )}
    ${botao(href, "Iniciar o registo")}
    ${linkCopiavel(href)}
    ${p(
      "O processo é simples e permitirá a recolha segura das informações e documentos necessários para a formalização da nossa relação profissional.",
    )}
    ${p(
      "Os dados fornecidos serão tratados com estrita confidencialidade e em conformidade com o Regulamento Geral sobre a Proteção de Dados (RGPD) e legislação aplicável.",
    )}
    ${p(
      "Caso necessite de qualquer apoio durante o preenchimento do registo, não hesite em contactar-nos.",
    )}
    ${p("Agradecemos a sua colaboração e permanecemos ao seu dispor.")}
    ${despedida()}
  `,
    MARCA,
    logotipoUrl,
  );
}

/* ----------------------------------------------- 2. receipt confirmation */

export const ASSUNTO_CONFIRMACAO = "LexFlow | Confirmação de Receção dos seus Dados";

export function emailConfirmacaoRececao({
  nome,
  referencia,
  logotipoUrl,
}: { nome?: string | null; referencia?: string | null; logotipoUrl?: string | null } = {}): string {
  return moldura(
    `
    ${refProcesso(referencia)}
    ${saudacao(nome)}
    ${p("Agradecemos o registo e o envio das informações através da nossa plataforma.")}
    ${p(
      "Informamos que os dados e documentos submetidos foram recebidos com sucesso e o processo encontra-se agora a aguardar aprovação pela equipa da LexFlow.",
    )}
    ${p(
      "A nossa equipa está a proceder à respetiva validação para que possamos dar seguimento ao seu processo da forma mais célere e eficiente possível. Caso seja necessária informação adicional ou documentação complementar, entraremos em contacto consigo.",
    )}
    ${p(
      "Assim que houver uma decisão, receberá um novo email a confirmá-la — em caso de aprovação, com o resumo do processo, os Termos e Condições e a proposta de honorários em anexo.",
    )}
    ${p("Agradecemos a sua confiança e colaboração.")}
    ${despedida()}
  `,
    LATAO,
    logotipoUrl,
  );
}

/* ---------------------------------------------------------- 3. welcome */

export const ASSUNTO_BOAS_VINDAS = "Bem-vindo à LexFlow";

export function emailBoasVindas({
  nome,
  referencia,
  anexos,
  logotipoUrl,
}: {
  nome?: string | null;
  referencia?: string;
  anexos: string[];
  logotipoUrl?: string | null;
}): string {
  // Client's document ends the list with "[Outros documentos aplicáveis]" for
  // manual attachments; generated ones go before it, only if they succeeded.
  const itens = [...anexos, "[Outros documentos aplicáveis]"];
  const lista = itens
    .map(
      (item, i) =>
        `<li style="margin-bottom:4px;color:${TINTA_SUAVE};">${item}${i === itens.length - 1 ? "." : ";"}</li>`,
    )
    .join("");

  return moldura(
    `
    ${refProcesso(referencia)}
    ${saudacao(nome)}
    ${p(
      "Temos o prazer de informar que o processo de registo junto da LexFlow foi concluído com sucesso.",
    )}
    ${p(
      "Após análise das informações e documentos submetidos, procedemos à validação dos dados necessários para a formalização da nossa relação profissional e para o acompanhamento do assunto que nos confiou.",
    )}
    ${p("Em anexo a esta comunicação encontrará:")}
    <ul style="font-family:${FONTE_CORPO};font-size:14px;line-height:1.7;margin:0 0 14px;padding-left:20px;">${lista}</ul>
    ${p(
      "Solicitamos que analise cuidadosamente a documentação anexa. Caso tenha alguma questão ou necessite de esclarecimentos adicionais, a nossa equipa estará inteiramente disponível para o apoiar.",
    )}
    ${p(
      "Agradecemos, uma vez mais, a confiança depositada na LexFlow e reforçamos o nosso compromisso de prestar um acompanhamento jurídico pautado pelo rigor, proximidade e profissionalismo.",
    )}
    ${despedida()}
  `,
    ARQUIVO,
    logotipoUrl,
  );
}

/* ---------------------------------------------- 5. verification code (OTP) */

export const ASSUNTO_OTP = "LexFlow | Código de verificação";

/**
 * OTP that unlocks the signature at closing. No client document behind it —
 * platform message, kept short: the code sits alone in a mono block with the
 * deadline underneath. The "didn't request this?" line is deliberate: it's
 * the only warning if the access link leaked.
 */
export function emailCodigoOtp({
  nome,
  codigo,
  referencia,
  minutos,
  logotipoUrl,
}: {
  nome?: string | null;
  codigo: string;
  referencia?: string | null;
  minutos: number;
  logotipoUrl?: string | null;
}): string {
  return moldura(
    `
    ${refProcesso(referencia)}
    ${saudacao(nome)}
    ${p(
      "Para concluir o registo e assinar digitalmente, introduza o código abaixo na plataforma:",
    )}
    <p style="margin:6px 0 10px;text-align:center;">
      <span style="display:inline-block;background:${PAPEL};border:1px solid ${LINHA};
                   border-radius:6px;padding:14px 26px;font-family:${FONTE_MONO};
                   font-size:30px;letter-spacing:0.28em;color:${TINTA};font-weight:600;">
        ${escapar(codigo)}
      </span>
    </p>
    ${p(
      `O código é válido durante ${minutos} minutos. Findo esse prazo, peça um novo código na própria página.`,
    )}
    ${p(
      "Se não foi o senhor(a) que pediu este código, não o utilize e contacte-nos de imediato — pode significar que o seu link de acesso está em mãos de terceiros.",
    )}
    ${despedida()}
  `,
    LATAO,
    logotipoUrl,
  );
}

/* ----------------------------------------------------------- 4. rejection */

export const ASSUNTO_REJEICAO = "LexFlow | Feedback Registro";

/**
 * Body of the client's template (11/08/2026), verbatim, between greeting and
 * sign-off. The rejection reason is not included — it stays in the matter and
 * the audit trail (`motivoRejeicao`, `processo.rejeitado`); the email invites
 * contact instead.
 */
export function emailRejeicao({
  nome,
  referencia,
  logotipoUrl,
}: { nome?: string | null; referencia?: string | null; logotipoUrl?: string | null } = {}): string {
  return moldura(
    `
    ${refProcesso(referencia)}
    ${saudacao(nome)}
    ${p(
      "Agradecemos a confiança depositada na LexFlow e o interesse demonstrado nos nossos serviços.",
    )}
    ${p(
      "Após uma análise cuidada das informações e documentação submetidas, lamentamos informar que o seu processo de validação não foi aceite nesta fase.",
    )}
    ${p(
      "Esta decisão foi tomada com base nos critérios de avaliação aplicáveis ao processo em questão e após a devida apreciação dos elementos disponibilizados.",
    )}
    ${p(
      "Caso considere oportuno, poderá entrar em contacto connosco para obter esclarecimentos adicionais ou verificar a possibilidade de apresentar informação ou documentação complementar que permita uma nova apreciação da sua situação.",
    )}
    ${p("Agradecemos a sua compreensão e permanecemos à disposição para qualquer esclarecimento que entenda necessário.")}
    ${despedida()}
  `,
    SELO,
    logotipoUrl,
  );
}

/* ----------------------------------------------------------- 6. reopening */

export const ASSUNTO_REABERTURA = "LexFlow | Reabertura do Processo";

export function emailReabertura({
  nome,
  referencia,
  link,
  logotipoUrl,
}: {
  nome?: string | null;
  referencia?: string | null;
  /**
   * O link de acesso ao processo — SEMPRE o token acabado de regenerar pela
   * reabertura, nunca o anterior, que a reabertura invalidou. Sem ele, o
   * cliente sabe que o processo reabriu mas não tem como voltar (BUG-021).
   */
  link?: string | null;
  logotipoUrl?: string | null;
} = {}): string {
  const href = link ? escapar(link) : null;
  return moldura(
    `
    ${refProcesso(referencia)}
    ${saudacao(nome)}
    ${p(
      "Informamos que o seu processo junto da LexFlow foi reaberto para retificação de informações ou junção de documentos adicionais.",
    )}
    ${p(
      "Poderá aceder à plataforma através do link disponibilizado para proceder às correções necessárias.",
    )}
    ${p(
      "Caso necessite de algum esclarecimento, não hesite em contactar a nossa equipa.",
    )}
    ${href ? botao(href, "Aceder ao processo") : ""}
    ${href ? linkCopiavel(href) : ""}
    ${despedida()}
  `,
    LATAO,
    logotipoUrl,
  );
}

