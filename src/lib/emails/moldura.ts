/**
 * A moldura das mensagens: paleta, tipografia e as peças com que se monta
 * qualquer email. Estava em `jmassano.ts`; saiu de lá quando os convites
 * (sociedade e utilizador) passaram a usar o mesmo canal e tinham de ter o
 * mesmo aspeto. Nada aqui é público fora de `lib/emails`.
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

/**
 * O logótipo, servido por esta instalação — não hard-coded ao domínio da POC
 * (qualquer instalação mandaria buscar a imagem ao servidor errado).
 *
 * Sai de `BETTER_AUTH_URL` (mesma fonte dos links, `lib/origem.ts`), não de
 * `origemPublica()`, que só existe dentro de um pedido — um email também sai
 * de script (`pnpm email:testar`) ou tarefa sem pedido nenhum.
 *
 * Lido de `process.env`, não de `env()` (D42): montar o HTML não pode
 * rebentar por falta de uma variável que nada tem a ver com ele.
 */
// `.png` e não `.svg`: Gmail recusa SVG em `<img>` sempre, sem exceção.
const logotipo = () =>
  `${(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "")}/lexflow.png`;

/**
 * Devolve o URL público do logótipo da sociedade para utilização em emails.
 *
 * Em vez de data-URI (que o Gmail Mobile bloqueia/adia por poupança de dados),
 * devolve o URL público estável `/api/sociedade/logotipo/[id]`.
 *
 * Se a sociedade não tiver logótipo configurado (ou for SVG, que o Gmail recusa
 * em <img>), devolve o URL público do logótipo padrão LexFlow (`/lexflow.png`).
 */
export function urlLogotipoSociedade(org?: {
  id?: string | null;
  logotipoDados?: string | null;
  logotipoMime?: string | null;
  logotipoAtualizadoEm?: Date | string | null;
} | null): string {
  const base = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  if (!org?.id || !org?.logotipoDados) return `${base}/lexflow.png`;
  const mime = org.logotipoMime || "image/png";
  // Mesmo motivo do fallback acima: Gmail não mostra SVG em <img>.
  if (mime === "image/svg+xml") return `${base}/lexflow.png`;
  return `${base}/api/sociedade/logotipo/${org.id}`;
}

export const moldura = (
  conteudo: string,
  corAcento: string = MARCA,
  logotipoUrl?: string | null,
) => {
  const urlLogo = logotipoUrl || logotipo();
  return `
<div style="background:${PAPEL};padding:32px 16px;font-family:${FONTE_CORPO};">
  <div style="max-width:560px;margin:0 auto;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"
           style="margin:0 auto 22px;text-align:center;">
      <tr>
        <td style="text-align:center;">
          <img src="${urlLogo}" alt="LexFlow" width="150"
               style="display:block;margin:0 auto;max-width:100%;height:auto;">
        </td>
      </tr>
      <tr>
        <td style="padding-top:8px;text-align:center;">
          <span style="font-family:${FONTE_MONO};font-size:11px;letter-spacing:0.18em;
                       text-transform:uppercase;color:${LATAO};">LexFlow · Software de gestão para sociedades de advogados</span>
        </td>
      </tr>
    </table>
    <div style="height:3px;border-radius:2px;background:${corAcento};opacity:0.9;margin-bottom:24px;"></div>
    <div style="background:${PAPEL_ALTO};border:1px solid ${LINHA};border-radius:8px;padding:30px 32px;">
      ${conteudo}
    </div>
    <p style="font-family:${FONTE_MONO};font-size:11px;line-height:1.7;color:${TINTA_SUAVE};margin:22px 4px 0;">
      LexFlow — Software de gestão para sociedades de advogados<br />
      Esta mensagem e os ficheiros que a acompanham são confidenciais e destinam-se
      exclusivamente ao destinatário. Se a recebeu por engano, agradecemos que nos
      informe e a elimine.
    </p>
  </div>
</div>`;
};

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
 * Escapes what comes from outside before it enters the HTML. The only
 * interpolated value is `link`, whose host comes from the request headers
 * (`origemPublica`) — a `Host` header with quotes would close `href` early
 * and turn the rest of the tag into attributes.
 */
export const escapar = (v: string) =>
  v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * "Caro(a) Sr.(a)," is the client's document wording, used when the name is
 * unknown (a matter can be born with only the address). When known, only
 * first + last name go in — the full name read out is a form field dumped
 * into a greeting, not a form of address.
 */
export const saudacao = (nome?: string | null) => {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return p("Caro(a) Sr.(a),");
  const tratamento =
    partes.length === 1 ? partes[0] : `${partes[0]} ${partes[partes.length - 1]}`;
  return p(`Caro(a) Sr.(a) ${escapar(tratamento)},`);
};

/** The matter reference, at the top in mono — like "Ref.:" on a letter, and the number both sides use on the phone for the same case file. */
export const refProcesso = (referencia?: string | null) =>
  referencia
    ? `<p style="font-family:${FONTE_MONO};font-size:11px;letter-spacing:0.08em;
         text-transform:uppercase;color:${TINTA_SUAVE};margin:0 0 18px;">
         Processo n.º <span style="color:${TINTA};font-weight:500;">${escapar(referencia)}</span>
       </p>`
    : "";

export const despedida = () =>
  p("Com os melhores cumprimentos,<br />Assinatura do Advogado gestor do Cliente");
