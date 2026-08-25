/**
 * A moldura das mensagens: paleta, tipografia e as peças de que todos os emails
 * são feitos.
 *
 * Estava dentro de `jmassano.ts`, que era o único ficheiro a mandar emails.
 * Deixou de ser: os convites — o da sociedade e o de cada pessoa que se junta a
 * ela — saem pelo mesmo canal e têm de ter o mesmo aspeto. Copiar a moldura era
 * garantir que os dois conjuntos divergiriam, e o que divergisse seria o
 * interno, que é o menos visto.
 *
 * Nada aqui é público para fora de `lib/emails`: são peças de construção, e um
 * email monta-se com elas num ficheiro de templates, não à solta.
 */

export const TINTA = "#101a24";
export const TINTA_SUAVE = "#5c6672";
export const PAPEL = "#edefea";
export const PAPEL_ALTO = "#ffffff";
export const ARQUIVO = "#2f5d50";
export const LATAO = "#a9884f";
export const SELO = "#8c2f39";
export const LINHA = "#d6dad2";
export const MARCA = "#d9694b";

export const FONTE_CORPO = "'Inter Tight','Segoe UI',Arial,sans-serif";
export const FONTE_DISPLAY = "'Instrument Serif',Georgia,serif";
export const FONTE_MONO = "'IBM Plex Mono','Courier New',monospace";

export const moldura = (conteudo: string, corAcento: string = MARCA) => `
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

export const p = (texto: string) =>
  `<p style="font-family:${FONTE_CORPO};font-size:14px;line-height:1.7;color:${TINTA_SUAVE};margin:0 0 14px;">${texto}</p>`;

/** The action button — archive green, the only CTA colour of the four messages. */
export const botao = (href: string, rotulo: string) => `
<p style="margin:6px 0 18px;">
  <a href="${href}"
     style="display:inline-block;background:${ARQUIVO};color:#ffffff;text-decoration:none;
            padding:12px 24px;border-radius:4px;font-family:${FONTE_CORPO};
            font-size:14px;font-weight:600;">
    ${rotulo}
  </a>
</p>`;

export const linkCopiavel = (href: string) =>
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
export const escapar = (v: string) =>
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
export const saudacao = (nome?: string | null) => {
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
export const refProcesso = (referencia?: string | null) =>
  referencia
    ? `<p style="font-family:${FONTE_MONO};font-size:11px;letter-spacing:0.08em;
         text-transform:uppercase;color:${TINTA_SUAVE};margin:0 0 18px;">
         Processo n.º <span style="color:${TINTA};font-weight:500;">${escapar(referencia)}</span>
       </p>`
    : "";

export const despedida = () =>
  p("Com os melhores cumprimentos,<br />Assinatura do Advogado gestor do Cliente");
