/**
 * The JMASSANO emails, all in one place.
 *
 * 1. **JMASSANO | Registro** — goes out with the form link, when the firm
 *    creates the matter.
 * 2. **JMASSANO | Confirmação de Receção dos seus Dados** — when the client
 *    submits.
 * 3. **Bem-vindo à JMASSANO Escritório de Advogado** — when the matter is
 *    approved in the back-office, with the summary of the information, the T&C
 *    and the fee proposal attached.
 * 4. **JMASSANO | Feedback Registro** — when the matter is rejected in the
 *    back-office. It follows, verbatim, the template delivered by the client on
 *    11/08/2026 — which replaces the in-house wording used until now.
 * 5. **JMASSANO | Código de verificação** — the six-digit code that unlocks the
 *    signature at step 7. It is the only one of the five that does **not** come
 *    from a client document: it is a platform message, written here, because
 *    there was nothing of this kind to follow verbatim.
 *
 * The four follow the subjects **and bodies** of the client's documents,
 * verbatim — including "Registro", which is how it reads there and was not
 * corrected to "Registo" in subjects 1 and 4, and including the open signature
 * ("Assinatura do Advogado gestor do Cliente"), which is the space left for the
 * lawyer managing each client. The second had two sentences adjusted after the
 * approval flow (migration `0013`) was added: the original document gave the
 * matter as "under review" with no second point of contact; now there is one,
 * and the email says the matter awaits approval and that the decision arrives
 * by email — the rest of the client's text stays verbatim. The fourth
 * (template of 11/08/2026) mentions neither reference nor reason — unlike the
 * previous wording, which cited both. The reason is still mandatory in the UI
 * and recorded in the matter and in the audit trail; it just stopped going in
 * the body of the email, because the client's template does not provide for it.
 *
 * What the frame adds to the client's text is only this, and for technical
 * reasons: the first email's `(link)` becomes a button plus the address in
 * text (an email has nowhere to click in a parenthesis), the third's attachment
 * list is built from the files that were actually generated, and the
 * confidentiality footer closes all four messages.
 *
 * A consequence of following the text verbatim: the greeting is generic — the
 * document says "Caro(a) Sr.(a)," and leaves no space for the name — and the
 * matter reference stopped appearing in the body of emails 2, 3 and 4. In the
 * first three, the `nome` and `referencia` parameters remain in the signatures,
 * accepted and ignored, for the day the firm wants one of those things back
 * without touching the callers. The fourth (`emailRejeicao`) had no parameter
 * other than `motivo` and `referencia`, and neither enters the new template —
 * so the function stopped accepting arguments, rather than keeping parameters
 * that never had any other use.
 */

/**
 * The exact palette and typography of `src/app/globals.css` (§3), in direct hex
 * and with fallback fonts — an email loads neither CSS variables nor uncommon
 * typefaces, and most clients ignore `@font-face`. Each message picks the
 * colour of the rule under the header by what it represents: terracotta
 * (`MARCA`) on a call to act, brass (`LATAO`) on a waiting or attention
 * message, archive green (`ARQUIVO`) on a positive confirmation, carmine
 * (`SELO`) only on the one piece of bad news of the four.
 */
const TINTA = "#101a24";
const TINTA_SUAVE = "#5c6672";
const PAPEL = "#edefea";
const PAPEL_ALTO = "#ffffff";
const ARQUIVO = "#2f5d50";
const LATAO = "#a9884f";
const SELO = "#8c2f39";
const LINHA = "#d6dad2";
const MARCA = "#d9694b";

const FONTE_CORPO = "'Inter Tight','Segoe UI',Arial,sans-serif";
const FONTE_DISPLAY = "'Instrument Serif',Georgia,serif";
const FONTE_MONO = "'IBM Plex Mono','Courier New',monospace";

const moldura = (conteudo: string, corAcento: string = MARCA) => `
<div style="background:${PAPEL};padding:32px 16px;font-family:${FONTE_CORPO};">
  <div style="max-width:560px;margin:0 auto;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"
           style="margin:0 auto 22px;text-align:center;">
      <tr>
        <td style="text-align:center;">
          <img src="https://poc.terlicalabs.com/logo-jm.png" alt="JMASSANO" width="110"
               style="display:block;margin:0 auto;max-width:100%;height:auto;">
        </td>
      </tr>
      <tr>
        <td style="padding-top:8px;text-align:center;">
          <span style="font-family:${FONTE_MONO};font-size:11px;letter-spacing:0.18em;
                       text-transform:uppercase;color:${LATAO};">JMASSANO Escritório de Advogado</span>
        </td>
      </tr>
    </table>
    <div style="height:3px;border-radius:2px;background:${corAcento};opacity:0.9;margin-bottom:24px;"></div>
    <div style="background:${PAPEL_ALTO};border:1px solid ${LINHA};border-radius:8px;padding:30px 32px;">
      ${conteudo}
    </div>
    <p style="font-family:${FONTE_MONO};font-size:11px;line-height:1.7;color:${TINTA_SUAVE};margin:22px 4px 0;">
      JMASSANO — Escritório de Advogado<br />
      Esta mensagem e os ficheiros que a acompanham são confidenciais e destinam-se
      exclusivamente ao destinatário. Se a recebeu por engano, agradecemos que nos
      informe e a elimine.
    </p>
  </div>
</div>`;

const p = (texto: string) =>
  `<p style="font-family:${FONTE_CORPO};font-size:14px;line-height:1.7;color:${TINTA_SUAVE};margin:0 0 14px;">${texto}</p>`;

/** The action button — archive green, the only CTA colour of the four messages. */
const botao = (href: string, rotulo: string) => `
<p style="margin:6px 0 18px;">
  <a href="${href}"
     style="display:inline-block;background:${ARQUIVO};color:#ffffff;text-decoration:none;
            padding:12px 24px;border-radius:4px;font-family:${FONTE_CORPO};
            font-size:14px;font-weight:600;">
    ${rotulo}
  </a>
</p>`;

const linkCopiavel = (href: string) =>
  p(
    `Se o botão não funcionar, copie este endereço para o seu navegador:<br />
     <span style="font-family:${FONTE_MONO};font-size:12px;color:${TINTA_SUAVE};word-break:break-all;">${href}</span>`,
  );

/**
 * Escapes what comes from outside before it enters the HTML.
 *
 * The body of these emails is our own text, verbatim; the only interpolated
 * value is the `link`, and its host comes from the request headers
 * (`origemPublica`, in `features/processos/acoes.ts`). A `Host` with quotes
 * closed the `href` and the rest of the tag became attributes — cheap to
 * prevent, and there is no reason to trust a header the client controls.
 */
const escapar = (v: string) =>
  v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * "Caro(a) Sr.(a)," is what the client's document says, and it is still what
 * goes out when the name is unknown — a matter can be born with only the
 * address, and "Caro(a) Sr.(a) ," with the comma left hanging is worse than the
 * neutral form. When the name is known, it goes in: the same email saying
 * "Caro(a) Sr.(a)," to somebody whose name is in the case file reads as a
 * circular, and this is the first message a client receives from the firm.
 *
 * Only the first and last name, which is how one addresses somebody in writing
 * — "Caro(a) Sr.(a) Maria Antónia da Silva Ferreira," is not a form of address,
 * it is the form field dumped into the greeting.
 */
const saudacao = (nome?: string | null) => {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return p("Caro(a) Sr.(a),");
  const tratamento =
    partes.length === 1 ? partes[0] : `${partes[0]} ${partes[partes.length - 1]}`;
  return p(`Caro(a) Sr.(a) ${escapar(tratamento)},`);
};

/**
 * The matter reference, at the top and in mono, like the "Ref.:" of an official
 * letter.
 *
 * It is the number by which the client and the firm talk about the same case
 * file on the phone. Without it, a person with two open matters does not know
 * which of the two the message concerns — and neither does whoever answers the
 * phone.
 */
const refProcesso = (referencia?: string | null) =>
  referencia
    ? `<p style="font-family:${FONTE_MONO};font-size:11px;letter-spacing:0.08em;
         text-transform:uppercase;color:${TINTA_SUAVE};margin:0 0 18px;">
         Processo n.º <span style="color:${TINTA};font-weight:500;">${escapar(referencia)}</span>
       </p>`
    : "";

const despedida = () =>
  p("Com os melhores cumprimentos,<br />Assinatura do Advogado gestor do Cliente");

/* ------------------------------------------------ 1. registration (the link) */

export const ASSUNTO_REGISTO = "JMASSANO | Registro";

export function emailRegisto({
  nome,
  link,
}: {
  nome?: string | null;
  link: string;
}): string {
  const href = escapar(link);
  return moldura(
    `
    ${saudacao(nome)}
    ${p(
      "É com grande satisfação que o recebemos como cliente da João Massano Escritório de Advogado.",
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
  );
}

/* ----------------------------------------------- 2. receipt confirmation */

export const ASSUNTO_CONFIRMACAO = "JMASSANO | Confirmação de Receção dos seus Dados";

export function emailConfirmacaoRececao({
  nome,
  referencia,
}: { nome?: string | null; referencia?: string | null } = {}): string {
  return moldura(
    `
    ${refProcesso(referencia)}
    ${saudacao(nome)}
    ${p("Agradecemos o registo e o envio das informações através da nossa plataforma.")}
    ${p(
      "Informamos que os dados e documentos submetidos foram recebidos com sucesso e o processo encontra-se agora a aguardar aprovação pela equipa da JMASSANO Escritório de Advogado.",
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
  );
}

/* ---------------------------------------------------------- 3. welcome */

export const ASSUNTO_BOAS_VINDAS = "Bem-vindo à JMASSANO Escritório de Advogado";

export function emailBoasVindas({
  nome,
  referencia,
  anexos,
}: {
  nome?: string | null;
  referencia?: string;
  anexos: string[];
}): string {
  // The list in the client's document ends in "[Outros documentos
  // aplicáveis]", which is where the lawyer adds whatever they attach by hand;
  // it stays in its place. The attachments before it are the ones actually
  // generated — one that fails cannot go on being announced, and the
  // punctuation (";" between lines, "." on the last) follows whatever remains.
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
      "Temos o prazer de informar que o processo de registo junto da JMASSANO Escritório de Advogado foi concluído com sucesso.",
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
      "Agradecemos, uma vez mais, a confiança depositada na JMASSANO Escritório de Advogado e reforçamos o nosso compromisso de prestar um acompanhamento jurídico pautado pelo rigor, proximidade e profissionalismo.",
    )}
    ${despedida()}
  `,
    ARQUIVO,
  );
}

/* ---------------------------------------------- 5. verification code (OTP) */

export const ASSUNTO_OTP = "JMASSANO | Código de verificação";

/**
 * The code that unlocks the signature at closing.
 *
 * It comes from no client document — it is a platform message, and the wording
 * is short on purpose: an email whose only useful content is six digits should
 * not force anyone to hunt for them between two paragraphs of courtesy. Hence
 * the code in a block, in mono and large, with the deadline underneath.
 *
 * The closing sentence is not boilerplate. A verification code arriving without
 * having been requested is the first sign that somebody holds the access link —
 * and the person receiving it is the only one in a position to raise the alarm.
 */
export function emailCodigoOtp({
  nome,
  codigo,
  referencia,
  minutos,
}: {
  nome?: string | null;
  codigo: string;
  referencia?: string | null;
  minutos: number;
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
  );
}

/* ----------------------------------------------------------- 4. rejection */

export const ASSUNTO_REJEICAO = "JMASSANO | Feedback Registro";

/**
 * The body of the client's template (11/08/2026), verbatim.
 *
 * It carries the reference and the name, which are identification and not
 * wording: the text delivered by the client is what sits between the greeting
 * and the sign-off, and it stays word for word. **The rejection reason does not
 * go** — it is recorded in the matter and in the audit trail (`motivoRejeicao`,
 * `processo.rejeitado`), which is where it has to be; the message expressly
 * invites contacting the firm, and that is where it gets explained to a person.
 */
export function emailRejeicao({
  nome,
  referencia,
}: { nome?: string | null; referencia?: string | null } = {}): string {
  return moldura(
    `
    ${refProcesso(referencia)}
    ${saudacao(nome)}
    ${p(
      "Agradecemos a confiança depositada na JMASSANO Escritório de Advogado e o interesse demonstrado nos nossos serviços.",
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
  );
}
