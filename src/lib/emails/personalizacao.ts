import { ARQUIVO, LATAO, moldura, SELO } from "./moldura";

/**
 * Templates de email editáveis e não editáveis (Frente J).
 *
 * Apenas os templates direcionados ao CLIENTE são personalizáveis pelas sociedades.
 * Templates de segurança, autenticação e fluxo interno permanecem fixos e intocáveis.
 */

export const TEMPLATES_EDITAVEIS = [
  "confirmacao_rececao",
  "boas_vindas",
  "rejeicao",
  "reabertura",
] as const;

export type TemplateEditavel = (typeof TEMPLATES_EDITAVEIS)[number];

export const TEMPLATES_NAO_EDITAVEIS = [
  "otp",
  "credenciais_acesso",
  "convite_sociedade",
  "convite_utilizador",
  "registo",
  "notificacao_backoffice",
] as const;

export type TemplateNaoEditavel = (typeof TEMPLATES_NAO_EDITAVEIS)[number];

/**
 * Placeholders disponíveis para personalização de emails.
 */
export const PLACEHOLDERS_DISPONIVEIS = [
  {
    chave: "nome_cliente",
    rotulo: "{{nome_cliente}}",
    descricao: "Nome do cliente ou destinatário",
  },
  {
    chave: "referencia",
    rotulo: "{{referencia}}",
    descricao: "Referência do processo (ex: PMF-2026-0142)",
  },
  {
    chave: "nome_sociedade",
    rotulo: "{{nome_sociedade}}",
    descricao: "Nome da sociedade de advogados",
  },
  {
    chave: "link_processo",
    rotulo: "{{link_processo}}",
    descricao: "Endereço web de acesso ao processo",
  },
  {
    chave: "motivo",
    rotulo: "{{motivo}}",
    descricao: "Motivo associado à decisão (ex: razão da rejeição)",
  },
] as const;

export type PlaceholderChave = (typeof PLACEHOLDERS_DISPONIVEIS)[number]["chave"];

/**
 * Escapa caracteres HTML para prevenir XSS ao interpolar dados variáveis.
 */
export function escaparHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Aplica placeholders no texto/HTML do email.
 *
 * - Substitui `{{chave}}` pelo valor disponível em `variaveis`.
 * - Tolera espaços internos como `{{ chave }}`.
 * - Placeholders desconhecidos ou não fornecidos permanecem literais `{{desconhecido}}`.
 * - Escapa valores de variáveis para segurança HTML (prevenção XSS).
 * - Função pura e totalmente segura contra falhas (nunca rebenta).
 */
export function aplicarPlaceholders(
  texto: string | null | undefined,
  variaveis: Record<string, string | null | undefined>,
): string {
  if (!texto || typeof texto !== "string") return "";

  return texto.replace(/{{\s*([a-zA-Z0-9_-]+)\s*}}/g, (correspondenciaOriginal, chave: string) => {
    if (Object.prototype.hasOwnProperty.call(variaveis, chave)) {
      const valor = variaveis[chave];
      if (valor === undefined) {
        return correspondenciaOriginal;
      }
      if (valor === null) {
        return "";
      }
      return escaparHtml(String(valor));
    }
    return correspondenciaOriginal;
  });
}

/**
 * Sanitizador de HTML baseado em lista branca de tags para corpos de email.
 *
 * Aproximação por expressões regulares para o ambiente da POC sem introduzir
 * novas dependências.
 * TODO: Substituir por DOMPurify / sanitize-html server-side quando houver
 * orçamento de dependências.
 *
 * Tags permitidas (whitelist): p, br, strong, b, em, i, u, a[href], ul, ol, li, h1, h2, h3, h4, span.
 * Atributos permitidos:
 *   - 'a': apenas 'href' seguro (http:, https:, mailto:, tel: ou {{placeholder}})
 *   - 'style' inline geral sanitizado
 */
export function sanitizarHtmlEmail(htmlBruto: string | null | undefined): string {
  if (!htmlBruto || typeof htmlBruto !== "string") return "";

  // 1. Remover blocos perigosos inteiros: script, style, iframe, object, embed, svg, math, form, input, button, textarea
  let limpo = htmlBruto
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[\s\S]*?>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<math[\s\S]*?<\/math>/gi, "")
    .replace(/<form[\s\S]*?<\/form>/gi, "");

  const TAGS_PERMITIDAS = new Set([
    "p",
    "br",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "a",
    "ul",
    "ol",
    "li",
    "h1",
    "h2",
    "h3",
    "h4",
    "span",
  ]);

  // 2. Substituir cada tag pelo seu equivalente seguro ou remover se não permitida
  limpo = limpo.replace(/<(\/)?([a-zA-Z0-9]+)([^>]*)>/g, (_match, barra, nomeTag, atributos) => {
    const tag = String(nomeTag).toLowerCase();
    if (!TAGS_PERMITIDAS.has(tag)) {
      return "";
    }

    if (barra) {
      return `</${tag}>`;
    }

    if (tag === "br") {
      return "<br />";
    }

    const atributosPermitidos: string[] = [];

    // Para <a>: permitir apenas href seguro
    if (tag === "a") {
      const matchHref = String(atributos).match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      if (matchHref) {
        const hrefValor = (matchHref[1] ?? matchHref[2] ?? matchHref[3] ?? "").trim();
        const ehSeguro =
          /^https?:\/\//i.test(hrefValor) ||
          /^mailto:/i.test(hrefValor) ||
          /^tel:/i.test(hrefValor) ||
          /^{{\s*[a-zA-Z0-9_-]+\s*}}$/.test(hrefValor) ||
          hrefValor.startsWith("/");

        const ehPerigoso = /^(javascript|data|vbscript):/i.test(hrefValor.replace(/\s+/g, ""));

        if (ehSeguro && !ehPerigoso) {
          atributosPermitidos.push(`href="${escaparHtml(hrefValor)}"`);
        }
      }
    }

    // Para style inline: permitir apenas CSS seguro (sem javascript/expression/url/behaviors)
    const matchStyle = String(atributos).match(/style\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (matchStyle) {
      const estiloValor = (matchStyle[1] ?? matchStyle[2] ?? matchStyle[3] ?? "").trim();
      const contemAtaque = /(javascript|expression|url\(|behavior|binding|<|>|alert)/i.test(estiloValor);
      if (!contemAtaque) {
        atributosPermitidos.push(`style="${escaparHtml(estiloValor)}"`);
      }
    }

    const attrsStr = atributosPermitidos.length > 0 ? ` ${atributosPermitidos.join(" ")}` : "";
    return `<${tag}${attrsStr}>`;
  });

  return limpo;
}

export interface DetalheTemplate {
  template: TemplateEditavel;
  titulo: string;
  descricao: string;
  assuntoPadrao: string;
  corpoHtmlPadrao: string;
  corAcento: string;
}

export const METADADOS_TEMPLATES: Record<TemplateEditavel, DetalheTemplate> = {
  confirmacao_rececao: {
    template: "confirmacao_rececao",
    titulo: "Confirmação de receção",
    descricao: "Enviado ao cliente quando este submete o formulário de onboarding com sucesso.",
    assuntoPadrao: "LexFlow | Confirmação de Receção dos seus Dados",
    corpoHtmlPadrao: `<p style="font-family:'IBM Plex Mono','Courier New',monospace;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#5c6672;margin:0 0 18px;">Processo n.º <span style="color:#101a24;font-weight:500;">{{referencia}}</span></p>
<p style="font-family:'Inter Tight','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#5c6672;margin:0 0 14px;">Caro(a) Sr.(a) {{nome_cliente}},</p>
<p style="font-family:'Inter Tight','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#5c6672;margin:0 0 14px;">Agradecemos o registo e o envio das informações através da nossa plataforma.</p>
<p style="font-family:'Inter Tight','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#5c6672;margin:0 0 14px;">Informamos que os dados e documentos submetidos foram recebidos com sucesso e o processo encontra-se agora a aguardar aprovação pela equipa da {{nome_sociedade}}.</p>
<p style="font-family:'Inter Tight','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#5c6672;margin:0 0 14px;">A nossa equipa está a proceder à respetiva validação para que possamos dar seguimento ao seu processo da forma mais célere e eficiente possível. Caso seja necessária informação adicional ou documentação complementar, entraremos em contacto consigo.</p>
<p style="font-family:'Inter Tight','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#5c6672;margin:0 0 14px;">Assim que houver uma decisão, receberá um novo email a confirmá-la — em caso de aprovação, com o resumo do processo, os Termos e Condições e a proposta de honorários em anexo.</p>
<p style="font-family:'Inter Tight','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#5c6672;margin:0 0 14px;">Agradecemos a sua confiança e colaboração.</p>
<p style="font-family:'Inter Tight','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#5c6672;margin:0 0 14px;">Com os melhores cumprimentos,<br />Assinatura do Advogado gestor do Cliente</p>`,
    corAcento: LATAO,
  },
  boas_vindas: {
    template: "boas_vindas",
    titulo: "Boas-vindas",
    descricao: "Enviado ao cliente após a aprovação do processo no backoffice, acompanhado dos anexos.",
    assuntoPadrao: "Bem-vindo à LexFlow",
    corpoHtmlPadrao: `<p style="font-family:'IBM Plex Mono','Courier New',monospace;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#5c6672;margin:0 0 18px;">Processo n.º <span style="color:#101a24;font-weight:500;">{{referencia}}</span></p>
<p style="font-family:'Inter Tight','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#5c6672;margin:0 0 14px;">Caro(a) Sr.(a) {{nome_cliente}},</p>
<p style="font-family:'Inter Tight','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#5c6672;margin:0 0 14px;">Temos o prazer de informar que o processo de registo junto da {{nome_sociedade}} foi concluído com sucesso.</p>
<p style="font-family:'Inter Tight','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#5c6672;margin:0 0 14px;">Após análise das informações e documentos submetidos, procedemos à validação dos dados necessários para a formalização da nossa relação profissional e para o acompanhamento do assunto que nos confiou.</p>
<p style="font-family:'Inter Tight','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#5c6672;margin:0 0 14px;">Em anexo a esta comunicação encontrará a documentação relevante do seu processo.</p>
<p style="font-family:'Inter Tight','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#5c6672;margin:0 0 14px;">Solicitamos que analise cuidadosamente a documentação anexa. Caso tenha alguma questão ou necessite de esclarecimentos adicionais, a nossa equipa estará inteiramente disponível para o apoiar.</p>
<p style="font-family:'Inter Tight','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#5c6672;margin:0 0 14px;">Agradecemos, uma vez mais, a confiança depositada na {{nome_sociedade}} e reforçamos o nosso compromisso de prestar um acompanhamento jurídico pautado pelo rigor, proximidade e profissionalismo.</p>
<p style="font-family:'Inter Tight','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#5c6672;margin:0 0 14px;">Com os melhores cumprimentos,<br />Assinatura do Advogado gestor do Cliente</p>`,
    corAcento: ARQUIVO,
  },
  rejeicao: {
    template: "rejeicao",
    titulo: "Rejeição",
    descricao: "Enviado ao cliente quando o processo é rejeitado no backoffice.",
    assuntoPadrao: "LexFlow | Feedback Registro",
    corpoHtmlPadrao: `<p style="font-family:'IBM Plex Mono','Courier New',monospace;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#5c6672;margin:0 0 18px;">Processo n.º <span style="color:#101a24;font-weight:500;">{{referencia}}</span></p>
<p style="font-family:'Inter Tight','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#5c6672;margin:0 0 14px;">Caro(a) Sr.(a) {{nome_cliente}},</p>
<p style="font-family:'Inter Tight','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#5c6672;margin:0 0 14px;">Agradecemos a confiança depositada na {{nome_sociedade}} e o interesse demonstrado nos nossos serviços.</p>
<p style="font-family:'Inter Tight','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#5c6672;margin:0 0 14px;">Após uma análise cuidada das informações e documentação submetidas, lamentamos informar que o seu processo de validação não foi aceite nesta fase.</p>
<p style="font-family:'Inter Tight','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#5c6672;margin:0 0 14px;">Esta decisão foi tomada com base nos critérios de avaliação aplicáveis ao processo em questão e após a devida apreciação dos elementos disponibilizados.</p>
<p style="font-family:'Inter Tight','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#5c6672;margin:0 0 14px;">Caso considere oportuno, poderá entrar em contacto connosco para obter esclarecimentos adicionais ou verificar a possibilidade de apresentar informação ou documentação complementar que permita uma nova apreciação da sua situação.</p>
<p style="font-family:'Inter Tight','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#5c6672;margin:0 0 14px;">Agradecemos a sua compreensão e permanecemos à disposição para qualquer esclarecimento que entenda necessário.</p>
<p style="font-family:'Inter Tight','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#5c6672;margin:0 0 14px;">Com os melhores cumprimentos,<br />Assinatura do Advogado gestor do Cliente</p>`,
    corAcento: SELO,
  },
  reabertura: {
    template: "reabertura",
    titulo: "Reabertura",
    descricao: "Enviado ao cliente caso um processo seja reaberto para correção ou envio de novos dados.",
    assuntoPadrao: "LexFlow | Reabertura do Processo",
    corpoHtmlPadrao: `<p style="font-family:'IBM Plex Mono','Courier New',monospace;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#5c6672;margin:0 0 18px;">Processo n.º <span style="color:#101a24;font-weight:500;">{{referencia}}</span></p>
<p style="font-family:'Inter Tight','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#5c6672;margin:0 0 14px;">Caro(a) Sr.(a) {{nome_cliente}},</p>
<p style="font-family:'Inter Tight','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#5c6672;margin:0 0 14px;">Informamos que o seu processo junto da {{nome_sociedade}} foi reaberto para atualização de informações ou documentação complementar.</p>
<p style="font-family:'Inter Tight','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#5c6672;margin:0 0 14px;">Poderá aceder à plataforma através do link disponibilizado para proceder às correções necessárias.</p>
<p style="font-family:'Inter Tight','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#5c6672;margin:0 0 14px;">Caso tenha alguma dúvida, não hesite em contactar a nossa equipa.</p>
<p style="font-family:'Inter Tight','Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.7;color:#5c6672;margin:0 0 14px;">Com os melhores cumprimentos,<br />Assinatura do Advogado gestor do Cliente</p>`,
    corAcento: LATAO,
  },
};

export function obterMetadadosTemplate(template: TemplateEditavel): DetalheTemplate {
  return METADADOS_TEMPLATES[template];
}

/**
 * Envolve o corpo personalizado na moldura oficial com o logótipo da sociedade.
 */
export function comporHtmlPersonalizado(
  corpoHtml: string,
  corAcento: string,
  logotipoUrl?: string | null,
): string {
  return moldura(corpoHtml, corAcento, logotipoUrl);
}
