/**
 * Os emails da JMASSANO, todos num sítio só.
 *
 * 1. **JMASSANO | Registro** — vai com o link do formulário, quando a
 *    sociedade cria o processo.
 * 2. **JMASSANO | Confirmação de Receção dos seus Dados** — quando o cliente
 *    submete.
 * 3. **Bem-vindo à JMASSANO Escritório de Advogado** — quando o processo é
 *    aprovado no back-office, com o resumo das informações, os T&C e a
 *    proposta de honorários em anexo.
 * 4. **JMASSANO | Feedback Registro** — quando o processo é rejeitado no
 *    back-office. Segue, à letra, o template entregue pelo cliente em
 *    11/08/2026 — que substitui a redação própria usada até aqui.
 * 5. **JMASSANO | Processo reaberto** — quando um processo rejeitado é
 *    reaberto no back-office e volta a `rascunho`. Não vem do documento do
 *    cliente (não existia essa possibilidade até 11/08/2026); redação
 *    própria, no mesmo tom e moldura dos outros quatro.
 *
 * Os quatro primeiros seguem os assuntos **e corpos** dos documentos do
 * cliente, à letra — incluindo "Registro", que é como lá está e não se
 * corrigiu para "Registo" nos assuntos 1 e 4, e incluindo a assinatura em
 * aberto ("Assinatura do Advogado gestor do Cliente"), que é o espaço
 * deixado ao advogado que gere cada cliente. O segundo teve duas frases
 * ajustadas depois do fluxo de aprovação (migração `0013`) ter sido
 * acrescentado: o documento original dava o processo como "em análise" sem
 * segundo momento de contacto; agora há um, e o email diz que o processo
 * aguarda aprovação e que a decisão chega por email — o resto do texto do
 * cliente mantém-se à letra. O quarto (template de 11/08/2026) não menciona
 * referência nem motivo — ao contrário da redação anterior, que citava os
 * dois. O motivo continua obrigatório na UI e gravado no processo e na
 * auditoria; só deixou de ir no corpo do email, porque o template do cliente
 * não o prevê.
 *
 * O que a moldura acrescenta ao texto do cliente é só isto, e por razões
 * técnicas: o `(link)` do primeiro email e do quinto vira botão mais
 * endereço em texto (um email não tem onde carregar num parêntesis), a lista
 * de anexos do terceiro é montada a partir dos ficheiros que foram mesmo
 * gerados, e o rodapé de confidencialidade fecha as cinco mensagens.
 *
 * Consequência de seguir o texto à letra: a saudação é genérica — o documento
 * diz "Caro(a) Sr.(a)," e não abre espaço para o nome — e a referência do
 * processo deixou de aparecer no corpo dos emails 2, 3 e 4. Nos três
 * primeiros, os parâmetros `nome` e `referencia` continuam nas assinaturas,
 * aceites e ignorados, para o dia em que a sociedade queira uma dessas coisas
 * de volta sem mexer em quem chama. O quarto (`emailRejeicao`) não tinha
 * mais nenhum parâmetro a não ser `motivo` e `referencia`, e nenhum dos dois
 * entra no template novo — por isso a função deixou de aceitar argumentos,
 * em vez de ficar com parâmetros que nunca teve outra utilidade.
 */

/**
 * Paleta e tipografia exatas de `src/app/globals.css` (§3), em hex direto e com
 * fontes de recurso — um email não carrega variáveis CSS nem tipos de letra
 * pouco comuns, e a maioria dos clientes ignora `@font-face`. Cada mensagem
 * escolhe a cor da régua sob o cabeçalho pelo que representa: terracota
 * (`MARCA`) num convite a agir, latão (`LATAO`) numa mensagem de espera ou de
 * atenção, verde-arquivo (`ARQUIVO`) numa confirmação positiva, carmim
 * (`SELO`) só na única má notícia das cinco.
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

/**
 * O emblema JMASSANO, o mesmo do site (`src/components/logotipo.tsx`), refeito
 * em tabelas.
 *
 * O logo do site é um SVG, e SVG em email não serve: o Gmail remove-o e o
 * Outlook não o desenha. Uma imagem alojada também não — metade dos clientes
 * de email bloqueia imagens por omissão, e o cabeçalho da mensagem ficaria
 * vazio precisamente na primeira vez que alguém a abre. Refeito em tabelas com
 * texto, desenha-se sempre, em qualquer cliente, sem pedir nada à rede.
 *
 * As opacidades do original (a régua a 0.45, "ADVOGADO" a 0.7) vão em cor
 * já misturada com o verde por baixo: `opacity` não é fiável em email, e o
 * resultado a olho é o mesmo por ser sempre sobre o mesmo fundo.
 */
const emblema = () => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0"
       style="width:92px;background-color:${ARQUIVO};border-radius:8px;">
  <tr>
    <td style="padding:11px 6px 10px;text-align:center;">
      <div style="font-family:${FONTE_DISPLAY};font-size:34px;line-height:1;
                  color:${LATAO};letter-spacing:-0.01em;">JM</div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"
             align="center" style="margin:7px auto 6px;">
        <tr><td style="width:44px;height:1px;background-color:#667050;
                       font-size:0;line-height:0;">&nbsp;</td></tr>
      </table>
      <div style="font-family:${FONTE_MONO};font-size:9px;font-weight:500;
                  line-height:1;color:${LATAO};letter-spacing:0.2em;">MASSANO</div>
      <div style="font-family:${FONTE_MONO};font-size:6.5px;line-height:1;
                  color:#847b4f;letter-spacing:0.16em;margin-top:4px;">ADVOGADO</div>
    </td>
  </tr>
</table>`;

const moldura = (conteudo: string, corAcento: string = MARCA) => `
<div style="background:${PAPEL};padding:32px 16px;font-family:${FONTE_CORPO};">
  <div style="max-width:560px;margin:0 auto;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"
           style="margin:0 auto 22px;text-align:center;">
      <tr>
        <td style="text-align:center;">${emblema()}</td>
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

/** O botão de ação — verde-arquivo, a única cor de CTA das cinco mensagens. */
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
 * Escape do que vem de fora antes de entrar no HTML.
 *
 * O corpo destes emails é texto nosso, à letra; o único valor interpolado é o
 * `link`, e o anfitrião dele sai dos cabeçalhos do pedido
 * (`origemPublica`, em `features/processos/acoes.ts`). Um `Host` com aspas
 * fechava o `href` e o resto da etiqueta passava a ser atributo — barato de
 * evitar, e não há razão para confiar num cabeçalho que o cliente controla.
 */
const escapar = (v: string) =>
  v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * "Caro(a) Sr.(a)," é o que está no documento do cliente, e continua a ser o
 * que sai quando não se sabe o nome — um processo pode nascer só com o
 * endereço, e "Caro(a) Sr.(a) ," com a vírgula solta é pior do que a fórmula
 * neutra. Sabendo-se o nome, ele entra: o mesmo email a dizer "Caro(a) Sr.(a),"
 * a alguém cujo nome está no dossiê lê-se como circular, e esta é a primeira
 * mensagem que um cliente recebe da sociedade.
 *
 * Só o primeiro e o último nome, que é como se trata alguém por escrito —
 * "Caro(a) Sr.(a) Maria Antónia da Silva Ferreira," não é tratamento, é o
 * campo do formulário despejado na saudação.
 */
const saudacao = (nome?: string | null) => {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return p("Caro(a) Sr.(a),");
  const tratamento =
    partes.length === 1 ? partes[0] : `${partes[0]} ${partes[partes.length - 1]}`;
  return p(`Caro(a) Sr.(a) ${escapar(tratamento)},`);
};

/**
 * A referência do processo, em cima e em mono, como o "Ref.:" de um ofício.
 *
 * É o número por onde o cliente e a sociedade falam do mesmo dossiê ao
 * telefone. Sem ela, uma pessoa com dois assuntos abertos não sabe a qual dos
 * dois a mensagem diz respeito — e quem atende o telefone também não.
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

/* ---------------------------------------------------- 1. registo (o link) */

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

/* ------------------------------------------- 2. confirmação de receção */

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

/* ------------------------------------------------------ 3. boas-vindas */

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
  // A lista do documento do cliente termina em "[Outros documentos
  // aplicáveis]", que é onde o advogado acrescenta o que junte à mão; fica no
  // sítio dele. Os anexos que a vêm antes são os que foram mesmo gerados — um
  // que falhe não pode continuar anunciado, e a pontuação (";" entre linhas,
  // "." na última) acompanha o que sobrar.
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

/* ------------------------------------------------------------ 4. rejeição */

export const ASSUNTO_REJEICAO = "JMASSANO | Feedback Registro";

/**
 * Corpo do template do cliente (11/08/2026), à letra.
 *
 * Leva a referência e o nome, que são identificação e não redação: o texto
 * entregue pelo cliente é o que está entre a saudação e a despedida, e
 * continua palavra por palavra. **O motivo da rejeição não vai** — fica
 * gravado no processo e na auditoria (`motivoRejeicao`, `processo.rejeitado`),
 * que é onde tem de estar; a mensagem convida expressamente a contactar a
 * sociedade, e é aí que ele se explica a uma pessoa.
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

/* ------------------------------------------------------------ 5. reabertura */

export const ASSUNTO_REABERTURA = "JMASSANO | Processo reaberto";

/**
 * Quando um processo rejeitado é reaberto no back-office (volta a `rascunho`).
 * O template de rejeição (D33, 11/08/2026) abriu esta porta — "poderá
 * apresentar informação ou documentação complementar que permita uma nova
 * apreciação" — e este é o email que a concretiza. Leva um link novo e não o
 * antigo: o token em claro nunca fica gravado (D4), por isso reabrir gera um
 * token novo e renova a validade, em vez de tentar reenviar o que já não está
 * em lado nenhum para reenviar.
 */
export function emailReabertura({
  nome,
  referencia,
  link,
}: {
  nome?: string | null;
  referencia?: string | null;
  link: string;
}): string {
  const href = escapar(link);
  return moldura(
    `
    ${refProcesso(referencia)}
    ${saudacao(nome)}
    ${p("Agradecemos a sua compreensão relativamente ao processo em curso junto da JMASSANO Escritório de Advogado.")}
    ${p("Informamos que o seu processo foi reaberto pela nossa equipa.")}
    ${p(
      "Pode agora rever as informações e documentação do seu processo e, se pretender, voltar a submeter para nova apreciação:",
    )}
    ${botao(href, "Rever o meu processo")}
    ${linkCopiavel(href)}
    ${p("Permanecemos ao seu dispor para qualquer esclarecimento que entenda necessário.")}
    ${despedida()}
  `,
    LATAO,
  );
}
