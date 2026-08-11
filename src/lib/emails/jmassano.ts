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
 *
 * Os quatro seguem os assuntos **e corpos** dos documentos do cliente, à
 * letra — incluindo "Registro", que é como lá está e não se corrigiu para
 * "Registo" nos assuntos 1 e 4, e incluindo a assinatura em aberto
 * ("Assinatura do Advogado gestor do Cliente"), que é o espaço deixado ao
 * advogado que gere cada cliente. O segundo teve duas frases ajustadas
 * depois do fluxo de aprovação (migração `0013`) ter sido acrescentado: o
 * documento original dava o processo como "em análise" sem segundo momento
 * de contacto; agora há um, e o email diz que o processo aguarda aprovação e
 * que a decisão chega por email — o resto do texto do cliente mantém-se à
 * letra. O quarto (template de 11/08/2026) não menciona referência nem
 * motivo — ao contrário da redação anterior, que citava os dois. O motivo
 * continua obrigatório na UI e gravado no processo e na auditoria; só deixou
 * de ir no corpo do email, porque o template do cliente não o prevê.
 *
 * O que a moldura acrescenta ao texto do cliente é só isto, e por razões
 * técnicas: o `(link)` do primeiro email vira botão mais endereço em texto
 * (um email não tem onde carregar num parêntesis), a lista de anexos do
 * terceiro é montada a partir dos ficheiros que foram mesmo gerados, e o
 * rodapé de confidencialidade fecha as quatro mensagens.
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

const CINZA = "#333";
const TINTA = "#101a24";

const moldura = (conteudo: string) => `
<div style="font-family:Georgia,'Times New Roman',serif;max-width:600px;margin:0 auto;padding:24px;color:${CINZA};">
  ${conteudo}
  <hr style="border:none;border-top:1px solid #d8d4ca;margin:28px 0 12px;" />
  <p style="font-size:12px;line-height:1.6;color:#8a8f99;margin:0;">
    JMASSANO — Escritório de Advogado<br />
    Esta mensagem e os ficheiros que a acompanham são confidenciais e destinam-se
    exclusivamente ao destinatário. Se a recebeu por engano, agradecemos que nos
    informe e a elimine.
  </p>
</div>`;

const p = (texto: string) =>
  `<p style="font-size:14px;line-height:1.7;margin:0 0 14px;">${texto}</p>`;

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

const saudacao = () => p("Caro(a) Sr.(a),");

const despedida = () =>
  p("Com os melhores cumprimentos,<br />Assinatura do Advogado gestor do Cliente");

/* ---------------------------------------------------- 1. registo (o link) */

export const ASSUNTO_REGISTO = "JMASSANO | Registro";

export function emailRegisto({ link }: { nome?: string | null; link: string }): string {
  const href = escapar(link);
  return moldura(`
    ${saudacao()}
    ${p(
      "É com grande satisfação que o recebemos como cliente da João Massano Escritório de Advogado.",
    )}
    ${p(
      "Agradecemos a confiança depositada na nossa equipa e reiteramos o nosso compromisso de prestar um serviço jurídico rigoroso, personalizado e orientado para a melhor defesa dos seus interesses.",
    )}
    ${p(
      "Para iniciarmos o acompanhamento do seu processo e cumprirmos as obrigações legais e regulamentares aplicáveis, solicitamos que efetue o seu registo através da nossa plataforma online:",
    )}
    <p style="margin:0 0 14px;">
      <a href="${href}"
         style="display:inline-block;background:${TINTA};color:#fff;text-decoration:none;
                padding:12px 22px;border-radius:2px;font-family:Helvetica,Arial,sans-serif;
                font-size:14px;">
        Iniciar o registo
      </a>
    </p>
    ${p(
      `Se o botão não funcionar, copie este endereço para o seu navegador:<br />
       <span style="font-family:'Courier New',monospace;font-size:12px;word-break:break-all;">${href}</span>`,
    )}
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
  `);
}

/* ------------------------------------------- 2. confirmação de receção */

export const ASSUNTO_CONFIRMACAO = "JMASSANO | Confirmação de Receção dos seus Dados";

export function emailConfirmacaoRececao(): string {
  return moldura(`
    ${saudacao()}
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
  `);
}

/* ------------------------------------------------------ 3. boas-vindas */

export const ASSUNTO_BOAS_VINDAS = "Bem-vindo à JMASSANO Escritório de Advogado";

export function emailBoasVindas({
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
        `<li style="margin-bottom:4px;">${item}${i === itens.length - 1 ? "." : ";"}</li>`,
    )
    .join("");

  return moldura(`
    ${saudacao()}
    ${p(
      "Temos o prazer de informar que o processo de registo junto da JMASSANO Escritório de Advogado foi concluído com sucesso.",
    )}
    ${p(
      "Após análise das informações e documentos submetidos, procedemos à validação dos dados necessários para a formalização da nossa relação profissional e para o acompanhamento do assunto que nos confiou.",
    )}
    ${p("Em anexo a esta comunicação encontrará:")}
    <ul style="font-size:14px;line-height:1.7;margin:0 0 14px;padding-left:20px;">${lista}</ul>
    ${p(
      "Solicitamos que analise cuidadosamente a documentação anexa. Caso tenha alguma questão ou necessite de esclarecimentos adicionais, a nossa equipa estará inteiramente disponível para o apoiar.",
    )}
    ${p(
      "Agradecemos, uma vez mais, a confiança depositada na JMASSANO Escritório de Advogado e reforçamos o nosso compromisso de prestar um acompanhamento jurídico pautado pelo rigor, proximidade e profissionalismo.",
    )}
    ${despedida()}
  `);
}

/* ------------------------------------------------------------ 4. rejeição */

export const ASSUNTO_REJEICAO = "JMASSANO | Feedback Registro";

/**
 * Template do cliente (11/08/2026), à letra. Não leva referência nem motivo
 * — os dois continuam obrigatórios e gravados no processo e na auditoria
 * (`motivoRejeicao`, `processo.rejeitado`), só deixaram de ir no email.
 */
export function emailRejeicao(): string {
  return moldura(`
    ${saudacao()}
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
  `);
}
