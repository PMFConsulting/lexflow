import "server-only";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db";
import { emailLog } from "@/db/schema/email";
import type { canalEmail, estadoEmail, templateEmail } from "@/db/schema/enums";
import { enviarSmtp } from "@/lib/smtp";
import { env, type Ambiente } from "@/env";

export type CanalEmail = (typeof canalEmail.enumValues)[number];
export type EstadoEmail = (typeof estadoEmail.enumValues)[number];
export type TemplateEmail = (typeof templateEmail.enumValues)[number];

/**
 * O que o canal devolve. O sucesso leva agora o canal que aceitou e o
 * identificador que ele deu à mensagem — sem esse identificador não há como
 * voltar a perguntar-lhe o que aconteceu depois, que é todo o problema que
 * `confirmarEntrega` resolve. É `null` quando o fornecedor aceitou mas não
 * devolveu id reconhecível: aceite continua a ser aceite, só deixa de ser
 * seguível.
 */
export type ResultadoEnvio =
  | { ok: true; canal: CanalEmail; mensagemId: string | null }
  | { ok: false; erro: string };

export type AnexoEmail = {
  /** Nome com que o anexo chega à caixa de correio do cliente. */
  nome: string;
  conteudo: Buffer;
};

type ParametrosEmail = {
  para: string;
  assunto: string;
  html: string;
  anexos?: AnexoEmail[];
  /**
   * Que email é este. Obrigatório de propósito: é o que garante que um caminho
   * de envio novo não pode nascer sem entrar no diário — quem o escrever tem de
   * responder à pergunta para o código compilar.
   */
  template: TemplateEmail;
  organizacaoId?: string | null;
  processoId?: string | null;
  /**
   * SHA-256 do token do link mágico, quando o email leva um. Nunca o token em
   * claro — ver a nota na coluna, em `db/schema/email.ts`.
   */
  tokenHash?: string | null;
};

/**
 * Quanto tempo se espera pelo fornecedor antes de desistir.
 *
 * Sem isto, uma saída para a Internet fechada no servidor não dava erro nenhum:
 * o `fetch` ficava pendurado, e com ele a Server Action que estava a criar o
 * processo — o utilizador ficava com o botão em "A criar…" para sempre e não
 * havia linha nenhuma no diário a dizer porquê. Um envio que demora mais de
 * quinze segundos já falhou; o que falta é dizê-lo.
 */
const TEMPO_LIMITE_MS = 15_000;

/**
 * Quando é que se volta a perguntar ao fornecedor se a mensagem chegou.
 *
 * Três tentativas, ~3 minutos ao todo. Uma entrega normal fica resolvida na
 * primeira; um `hardBounce` de um domínio que não existe também. O que sobra
 * para a terceira são os servidores que aceitam e só depois decidem — e o que
 * sobrar dessa fica em `enviado`, que é a verdade sobre ele.
 */
const ESPERAS_ENTREGA_MS = [15_000, 45_000, 120_000] as const;

/**
 * Escreve a linha do diário. Não lança, nunca. Devolve o `id` da linha, ou
 * `null` se a gravação falhou — quem o recebe usa-o para lhe voltar a mexer
 * quando o fornecedor disser o que fez à mensagem.
 *
 * Um email que saiu e não ficou registado é mau; um email que não saiu *porque*
 * o registo falhou é pior. A gravação é o último passo e o erro dela fica-se
 * pela consola: o valor desta tabela é operacional, não legal — o que a lei
 * obriga a conservar está em `evento_auditoria`, noutro caminho de escrita.
 *
 * O erro é gritado com o destinatário e o template à frente, e não só com a
 * exceção. Uma gravação falhada deixa o `/emails` a dizer "0 mensagens", que é
 * exatamente o que se vê quando o envio nem sequer foi tentado: sem esta linha
 * na consola, os dois casos são indistinguíveis de fora — e foi a confundi-los
 * que se perdeu uma investigação inteira.
 *
 * O `id` é gerado aqui e não pedido à base de dados com um `returning` (D15):
 * assim há identificador mesmo quando o INSERT rebenta, e a gravação continua a
 * ser uma só instrução.
 */
async function registar(
  p: ParametrosEmail,
  resultado: ResultadoEnvio,
): Promise<string | null> {
  const linhaId = uuidv7();
  try {
    await db()
      .insert(emailLog)
      .values({
        id: linhaId,
        organizacaoId: p.organizacaoId ?? null,
        processoId: p.processoId ?? null,
        para: p.para,
        assunto: p.assunto,
        template: p.template,
        tokenHash: p.tokenHash ?? null,
        estado: resultado.ok ? "enviado" : "erro",
        canal: resultado.ok ? resultado.canal : null,
        mensagemId: resultado.ok ? resultado.mensagemId : null,
        // O erro é truncado: a resposta de um fornecedor pode vir com um corpo
        // inteiro, e a coluna serve para diagnosticar, não para arquivar HTML.
        erro: resultado.ok ? null : resultado.erro.slice(0, 2000),
      });
    return linhaId;
  } catch (e) {
    console.error(
      `[email] FALHOU a gravação em email_log — template=${p.template} para=${p.para} ` +
        `estado=${resultado.ok ? "enviado" : "erro"}. O /emails vai mostrar menos ` +
        `mensagens do que as que foram tentadas.`,
      e,
    );
    return null;
  }
}

/**
 * Envio de email transacional (Brevo, com o Resend em recurso). Nunca deixa o
 * fluxo rebentar: sem chave configurada, fica-se pelo log; qualquer erro na
 * chamada é apanhado e devolvido, não propagado.
 *
 * Todos os caminhos de saída passam por `registar` — incluindo o da chave que
 * falta, o da exceção e o do próprio `tentarEnviar` a rebentar. É a única forma
 * de a pergunta "o cliente recebeu alguma coisa?" ter resposta quando a
 * resposta é "não".
 *
 * O `try` à volta do `tentarEnviar` não é zelo a mais. Ele lê o ambiente antes
 * de entrar no seu próprio `try` (`env()` lança quando falta uma variável), e
 * uma exceção aí saltava por cima do `registar` **e** propagava-se a quem
 * chamou — que é como um envio falhado se transformava em criação de processo
 * falhada, sem deixar rasto em lado nenhum.
 *
 * O que devolve continua a ser sobre a **aceitação** e não sobre a entrega: um
 * `ok: true` quer dizer que o fornecedor ficou com a mensagem. Quem quiser
 * saber se ela chegou à caixa olha para o estado da linha alguns minutos
 * depois — ver `confirmarEntrega`.
 */
export async function enviarEmail(p: ParametrosEmail): Promise<ResultadoEnvio> {
  let resultado: ResultadoEnvio;
  try {
    resultado = await tentarEnviar(p);
  } catch (erro) {
    resultado = {
      ok: false,
      erro: erro instanceof Error ? erro.message : String(erro),
    };
  }

  // Uma linha por tentativa, sempre, mesmo quando a gravação a seguir falha.
  // É o que permite responder a "chegou a tentar?" sem base de dados à mão —
  // a pergunta que o `/emails` a dizer "0 mensagens" não distingue de "tentou
  // e não gravou".
  if (resultado.ok) {
    console.info(
      `[email] aceite pelo ${resultado.canal} template=${p.template} para=${p.para} ` +
        `id=${resultado.mensagemId ?? "(sem id)"}`,
    );
  } else {
    console.error(
      `[email] NÃO enviado template=${p.template} para=${p.para}: ${resultado.erro}`,
    );
  }

  const linhaId = await registar(p, resultado);

  if (resultado.ok && resultado.mensagemId && linhaId) {
    // Solta e não esperada: quem criou o processo não pode ficar três minutos
    // à espera de saber se o email chegou. Ver a nota em `confirmarEntrega`.
    void confirmarEntrega({
      linhaId,
      canal: resultado.canal,
      mensagemId: resultado.mensagemId,
      para: p.para,
      template: p.template,
    }).catch((e) =>
      console.error(`[email] a confirmação de entrega rebentou para ${p.para}`, e),
    );
  } else if (resultado.ok) {
    // Sem id não há a quem perguntar. Fica dito, senão a linha em `enviado`
    // lia-se como "ainda por confirmar" quando é "nunca vai ser confirmada".
    console.warn(
      `[email] sem id do fornecedor para ${p.para} (template=${p.template}) — ` +
        "a entrega desta mensagem não vai poder ser confirmada.",
    );
  }

  return resultado;
}

/** O que se envia, sem a contabilidade do diário à volta. */
type Mensagem = Pick<ParametrosEmail, "para" | "assunto" | "html" | "anexos">;

/**
 * Escolhe o canal e, falhando ele, tenta o seguinte.
 *
 * O Brevo vem primeiro por ter mais folga no plano gratuito (300 emails/dia),
 * o Mailjet a seguir (200/dia) e o Resend por último (100/dia) — mas ser o
 * primeiro não é ser o único: uma conta suspensa, um remetente por verificar
 * ou uma quota esgotada num dos fornecedores não pode deixar o cliente sem o
 * link. Com as chaves todas configuradas, um envio só falha quando falharem
 * todos — e a mensagem de erro leva as razões de cada um, porque são
 * diferentes e resolvem-se em painéis diferentes.
 *
 * Um 429 (quota diária esgotada) põe o canal em pausa até ao fim do dia UTC:
 * voltar a bater à porta de um fornecedor que já disse que não tem quota não
 * é uma retoma, é ruído — e, pior, atrasa os canais que ainda podem aceitar.
 *
 * O que isto custa é a hipótese de um duplicado: se um canal aceitar a
 * mensagem e a resposta se perder no tempo limite, o seguinte manda a
 * segunda. Um email a dobrar é preferível a nenhum.
 */
async function tentarEnviar(p: ParametrosEmail): Promise<ResultadoEnvio> {
  const ambiente = env();
  const msg: Mensagem = {
    para: p.para,
    assunto: p.assunto,
    html: p.html,
    anexos: p.anexos,
  };

  const canais: { nome: string; enviar: () => Promise<ResultadoEnvio> }[] = [];
  if (ambiente.BREVO_API_KEY) {
    const chave = ambiente.BREVO_API_KEY;
    canais.push({ nome: "Brevo", enviar: () => tentarEnviarBrevo(msg, ambiente, chave) });
  }
  if (ambiente.MAILJET_API_KEY && ambiente.MAILJET_SECRET_KEY) {
    const chave = ambiente.MAILJET_API_KEY;
    const segredo = ambiente.MAILJET_SECRET_KEY;
    canais.push({ nome: "Mailjet", enviar: () => tentarEnviarMailjet(msg, ambiente, chave, segredo) });
  }
  if (ambiente.RESEND_API_KEY) {
    const chave = ambiente.RESEND_API_KEY;
    canais.push({ nome: "Resend", enviar: () => tentarEnviarResend(msg, ambiente, chave) });
  }
  // O SMTP próprio (postfix no servidor do cliente) é o último recurso: não
  // tem quota de terceiros, mas a entrega é menos vigiada (sem DKIM do
  // domínio), por isso só entra quando os fornecedores falharem todos.
  if (ambiente.SMTP_HOST) {
    const anfitriao = ambiente.SMTP_HOST;
    const porta = ambiente.SMTP_PORT ?? 25;
    canais.push({ nome: "SMTP próprio", enviar: () => tentarEnviarSmtp(msg, anfitriao, porta) });
  }

  if (canais.length === 0) {
    const lista = p.anexos?.length ? ` anexos=${p.anexos.map((a) => a.nome).join(",")}` : "";
    console.log(`[email] (sem chave) para=${p.para} assunto="${p.assunto}"${lista}`);
    return {
      ok: false,
      erro:
        "Nenhuma chave de email configurada (BREVO_API_KEY, MAILJET_API_KEY+MAILJET_SECRET_KEY, RESEND_API_KEY ou SMTP_HOST)",
    };
  }

  const erros: string[] = [];
  for (const canal of canais) {
    if (estaEsgotado(canal.nome)) {
      erros.push(`${canal.nome} em pausa (quota diária esgotada — volta ao fim do dia UTC)`);
      console.warn(`[email] ${canal.nome} em pausa por quota — a tentar o canal seguinte.`);
      continue;
    }
    const r = await canal.enviar();
    if (r.ok) return r;
    marcarEsgotado(canal.nome, r.erro);
    erros.push(r.erro);
    // Um canal que falhou e foi substituído não deixa linha nenhuma em
    // `email_log` — a linha é do envio, e o envio ainda pode ter corrido bem.
    // Sem este aviso, um fornecedor podia estar em baixo há semanas sem que
    // nada o dissesse.
    if (canal !== canais[canais.length - 1]) {
      console.warn(`[email] ${canal.nome} falhou (${r.erro}) — a tentar o canal seguinte.`);
    }
  }

  return { ok: false, erro: erros.join(" | ") };
}

/**
 * Canais em pausa por quota diária esgotada: nome do canal → instante (ms)
 * em que volta a ser tentado.
 *
 * Em memória de processo, de propósito: a pausa é uma decisão do momento
 * (\"este fornecedor já disse hoje que não tem quota\"), não um estado que
 * precise de sobreviver a um reinício — depois de um reinício, o 429 volta a
 * aparecer e a pausa refaz-se sozinha.
 */
const esgotadosAte = new Map<string, number>();

/** Fim do dia UTC — o instante em que as quotas diárias dos fornecedores repõem. */
function fimDoDiaUtc(): number {
  const agora = new Date();
  return Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + 1);
}

function estaEsgotado(nome: string): boolean {
  const ate = esgotadosAte.get(nome);
  return ate !== undefined && Date.now() < ate;
}

/**
 * Um 429 é o fornecedor a dizer que a quota do dia acabou. Marca o canal em
 * pausa até ao fim do dia UTC — e o `Map` é limpo sozinho: passado o fim do
 * dia, `estaEsgotado` devolve `false` e o canal volta à rotação.
 */
function marcarEsgotado(nome: string, erro: string): void {
  if (/\b429\b/i.test(erro)) {
    esgotadosAte.set(nome, fimDoDiaUtc());
    console.warn(`[email] ${nome} com quota diária esgotada (429) — em pausa até ao fim do dia UTC.`);
  }
}

/**
 * Reativa todos os canais em pausa. Exportada para os testes (o estado da
 * pausa vive no módulo e não sobrevive a um `vi.resetModules` sem o ser) e
 * para quem quiser reativar um canal à mão sem reiniciar o processo.
 */
export function limparPausasDeQuota(): void {
  esgotadosAte.clear();
}

/**
 * Lê o identificador que o fornecedor deu à mensagem.
 *
 * Nunca lança: uma resposta 200 com um corpo que não é o esperado é um envio
 * aceite que fica sem rasto, não um envio falhado. Trocar as duas coisas seria
 * mandar o segundo canal repetir uma mensagem que já saiu.
 */
async function idDaResposta(resposta: Response, campo: "id" | "messageId"): Promise<string | null> {
  try {
    const corpo: unknown = await resposta.json();
    if (typeof corpo !== "object" || corpo === null) return null;
    const registo = corpo as Record<string, unknown>;
    const valor = registo[campo];
    if (typeof valor === "string" && valor.length > 0) return valor;
    // O Brevo devolve `messageIds` (plural) quando há mais do que um
    // destinatário. Enviamos sempre um, mas a forma da resposta é dele.
    const plural = registo.messageIds;
    if (Array.isArray(plural) && typeof plural[0] === "string") return plural[0];
    return null;
  } catch {
    return null;
  }
}

/** Envio via Resend: `Authorization: Bearer`, anexos em `attachments`. */
async function tentarEnviarResend(
  { para, assunto, html, anexos }: Mensagem,
  ambiente: Ambiente,
  chave: string,
): Promise<ResultadoEnvio> {
  try {
    const resposta = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      headers: {
        Authorization: `Bearer ${chave}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: ambiente.EMAIL_REMETENTE,
        to: [para],
        subject: assunto,
        html,
        // O Resend quer o conteúdo em base64. Só se inclui a chave quando há
        // anexos: um `attachments: []` faz a API responder 422.
        ...(anexos?.length
          ? {
              attachments: anexos.map((a) => ({
                filename: a.nome,
                content: a.conteudo.toString("base64"),
              })),
            }
          : {}),
      }),
    });

    if (!resposta.ok) {
      const corpo = await resposta.text();
      // O remetente entra na mensagem porque é a causa mais provável de um 403
      // e a que não se vê na resposta: o Resend recusa qualquer envio de um
      // domínio que não esteja verificado na conta, e `POC@jmassano.pt` é um
      // valor por omissão que ninguém escreveu e por isso ninguém desconfia.
      return {
        ok: false,
        erro: `Resend devolveu ${resposta.status} (de=${ambiente.EMAIL_REMETENTE}): ${corpo}`,
      };
    }

    return { ok: true, canal: "resend", mensagemId: await idDaResposta(resposta, "id") };
  } catch (erro) {
    // O `AbortSignal.timeout` lança um `TimeoutError` cujo `message` é genérico
    // ("The operation was aborted due to timeout") e não diz a quem se estava a
    // ligar — num diário de emails isso não vale nada.
    if (erro instanceof Error && erro.name === "TimeoutError") {
      return {
        ok: false,
        erro: `A api.resend.com não respondeu em ${TEMPO_LIMITE_MS / 1000}s — verifique a saída para a Internet do servidor.`,
      };
    }
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}

/** Envio via Brevo (ex-Sendinblue): `api-key` no header, anexos em `attachment`. */
async function tentarEnviarBrevo(
  { para, assunto, html, anexos }: Mensagem,
  ambiente: Ambiente,
  chave: string,
): Promise<ResultadoEnvio> {
  try {
    const resposta = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      headers: {
        "api-key": chave,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: { email: ambiente.EMAIL_REMETENTE },
        to: [{ email: para }],
        subject: assunto,
        htmlContent: html,
        // O Brevo quer o conteúdo em base64, no campo `attachment`.
        ...(anexos?.length
          ? {
              attachment: anexos.map((a) => ({
                name: a.nome,
                content: a.conteudo.toString("base64"),
              })),
            }
          : {}),
      }),
    });

    if (!resposta.ok) {
      const corpo = await resposta.text();
      return {
        ok: false,
        erro: `Brevo devolveu ${resposta.status} (de=${ambiente.EMAIL_REMETENTE}): ${corpo}`,
      };
    }

    return { ok: true, canal: "brevo", mensagemId: await idDaResposta(resposta, "messageId") };
  } catch (erro) {
    if (erro instanceof Error && erro.name === "TimeoutError") {
      return {
        ok: false,
        erro: `A api.brevo.com não respondeu em ${TEMPO_LIMITE_MS / 1000}s — verifique a saída para a Internet do servidor.`,
      };
    }
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}

/**
 * Envio via Mailjet: autenticação Basic (chave:segredo), anexos em
 * `Attachments` (base64, com `ContentType` obrigatório — o Mailjet não infere
 * do nome, ao contrário do Resend e do Brevo).
 */
async function tentarEnviarMailjet(
  { para, assunto, html, anexos }: Mensagem,
  ambiente: Ambiente,
  chave: string,
  segredo: string,
): Promise<ResultadoEnvio> {
  try {
    const resposta = await fetch("https://api.mailjet.com/v3.1/send", {
      method: "POST",
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      headers: {
        Authorization: `Basic ${Buffer.from(`${chave}:${segredo}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        Messages: [
          {
            From: { Email: ambiente.EMAIL_REMETENTE, Name: "JMASSANO" },
            To: [{ Email: para }],
            Subject: assunto,
            HTMLPart: html,
            ...(anexos?.length
              ? {
                  Attachments: anexos.map((a) => ({
                    Filename: a.nome,
                    ContentType: a.nome.toLowerCase().endsWith(".pdf")
                      ? "application/pdf"
                      : "application/octet-stream",
                    Base64Content: a.conteudo.toString("base64"),
                  })),
                }
              : {}),
          },
        ],
      }),
    });

    if (!resposta.ok) {
      const corpo = await resposta.text();
      return {
        ok: false,
        erro: `Mailjet devolveu ${resposta.status} (de=${ambiente.EMAIL_REMETENTE}): ${corpo}`,
      };
    }

    const corpo = (await resposta.json()) as { Messages?: { To?: { MessageID?: string }[] }[] };
    const id = corpo.Messages?.[0]?.To?.[0]?.MessageID;
    return {
      ok: true,
      canal: "mailjet",
      mensagemId: typeof id === "string" && id.length > 0 ? id : null,
    };
  } catch (erro) {
    if (erro instanceof Error && erro.name === "TimeoutError") {
      return {
        ok: false,
        erro: `A api.mailjet.com não respondeu em ${TEMPO_LIMITE_MS / 1000}s — verifique a saída para a Internet do servidor.`,
      };
    }
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}

/**
 * Envio pelo SMTP próprio (postfix no servidor). Sem id de fornecedor: o
 * postfix não tem API — aceite é aceite, e a entrega em si fica sem rasto
 * (`mensagemId` `null`, e o `confirmarEntrega` salta estas linhas).
 */
async function tentarEnviarSmtp(
  { para, assunto, html, anexos }: Mensagem,
  anfitriao: string,
  porta: number,
): Promise<ResultadoEnvio> {
  const resultado = await enviarSmtp(anfitriao, porta, {
    de: env().EMAIL_REMETENTE,
    para,
    assunto,
    html,
    anexos: anexos?.map((a) => ({ nome: a.nome, conteudoBase64: a.conteudo.toString("base64") })),
  });
  if (!resultado.ok) {
    return { ok: false, erro: resultado.erro ?? "SMTP próprio recusou a mensagem sem detalhe." };
  }
  return { ok: true, canal: "smtp", mensagemId: null };
}

/* ------------------------------------------------------------------ entrega */

/**
 * O que o fornecedor sabe da mensagem **depois** de a ter aceite.
 *
 * `pendente` não é "não chegou": é "ele ainda não decidiu". Um servidor de
 * destino pode aceitar em três segundos ou em três minutos, e chamar-lhe falha
 * pelo caminho seria inventar uma avaria.
 */
export type EventoEntrega = "entregue" | "devolvido" | "queixa" | "pendente";

export type ResultadoVerificacao =
  | { ok: true; evento: EventoEntrega; motivo?: string }
  | { ok: false; erro: string };

/** Só os eventos conclusivos mudam o estado da linha. */
const ESTADO_POR_EVENTO = {
  entregue: "entregue",
  devolvido: "devolvido",
  queixa: "queixa",
} as const satisfies Record<Exclude<EventoEntrega, "pendente">, EstadoEmail>;

/**
 * Espera sem segurar o processo de pé.
 *
 * O `unref` é o que impede um `pnpm email:testar` ou um script de migração de
 * ficarem dois minutos parados à espera de um temporizador que só existe para
 * uma verificação de cortesia.
 */
function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const temporizador: unknown = setTimeout(resolve, ms);
    (temporizador as { unref?: () => void }).unref?.();
  });
}

/**
 * Pergunta ao fornecedor o que aconteceu à mensagem depois de a ter aceite.
 *
 * Exportada porque o valor dela não é só o da confirmação automática: dado um
 * `mensagem_id` do `/emails`, isto responde a "chegou?" sem abrir o painel de
 * ninguém.
 */
export async function verificarEntrega(
  canal: CanalEmail,
  mensagemId: string,
): Promise<ResultadoVerificacao> {
  let ambiente: Ambiente;
  try {
    ambiente = env();
  } catch (erro) {
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }

  if (canal === "resend") {
    if (!ambiente.RESEND_API_KEY) {
      return { ok: false, erro: "RESEND_API_KEY não está no ambiente — a entrega não se confirma." };
    }
    return verificarEntregaResend(mensagemId, ambiente.RESEND_API_KEY);
  }

  if (canal === "mailjet") {
    if (!ambiente.MAILJET_API_KEY || !ambiente.MAILJET_SECRET_KEY) {
      return {
        ok: false,
        erro: "MAILJET_API_KEY/MAILJET_SECRET_KEY não estão no ambiente — a entrega não se confirma.",
      };
    }
    return verificarEntregaMailjet(
      mensagemId,
      ambiente.MAILJET_API_KEY,
      ambiente.MAILJET_SECRET_KEY,
    );
  }

  if (!ambiente.BREVO_API_KEY) {
    return { ok: false, erro: "BREVO_API_KEY não está no ambiente — a entrega não se confirma." };
  }
  return verificarEntregaBrevo(mensagemId, ambiente.BREVO_API_KEY);
}

/**
 * Resend: `GET /emails/{id}` devolve o `last_event` da mensagem.
 *
 * Os estados que interessam são três — `delivered`, `bounced`, `complained`.
 * Tudo o resto (`queued`, `scheduled`, `sent`, `delivery_delayed`) é o
 * fornecedor a dizer que ainda não sabe, e traduz-se em `pendente` com o nome
 * cru no motivo: um evento novo do lado deles não pode passar por entrega.
 */
async function verificarEntregaResend(
  mensagemId: string,
  chave: string,
): Promise<ResultadoVerificacao> {
  try {
    const resposta = await fetch(
      `https://api.resend.com/emails/${encodeURIComponent(mensagemId)}`,
      {
        method: "GET",
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
        headers: { Authorization: `Bearer ${chave}` },
      },
    );

    if (!resposta.ok) {
      const corpo = await resposta.text();
      return {
        ok: false,
        erro: `Resend devolveu ${resposta.status} ao consultar ${mensagemId}: ${corpo}`,
      };
    }

    const corpo = (await resposta.json()) as {
      last_event?: string;
      bounce?: { message?: string; type?: string; subType?: string };
    };
    const ultimo = corpo.last_event ?? "";

    switch (ultimo) {
      case "delivered":
        return { ok: true, evento: "entregue" };
      case "bounced": {
        const detalhe =
          corpo.bounce?.message ??
          [corpo.bounce?.type, corpo.bounce?.subType].filter(Boolean).join(" / ");
        return {
          ok: true,
          evento: "devolvido",
          motivo: detalhe || "devolvido pelo servidor de destino (sem motivo indicado)",
        };
      }
      case "complained":
        return { ok: true, evento: "queixa", motivo: "o destinatário marcou a mensagem como spam" };
      default:
        return { ok: true, evento: "pendente", motivo: ultimo || "sem last_event" };
    }
  } catch (erro) {
    if (erro instanceof Error && erro.name === "TimeoutError") {
      return { ok: false, erro: `A api.resend.com não respondeu em ${TEMPO_LIMITE_MS / 1000}s.` };
    }
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}

/**
 * Brevo: `GET /v3/smtp/statistics/events?messageId=…` devolve a lista de
 * acontecimentos da mensagem.
 *
 * Ao contrário do Resend, não há um "último evento": vem uma lista, e a ordem
 * dela não é a ordem de gravidade. Uma mensagem pode ter `delivered` e, dois
 * dias depois, `spam`. Fica o mais grave dos que lá estiverem — é o que se tem
 * de agir, e é por isso que se ordena por gravidade e não por data.
 *
 * O 404 é resposta normal: o Brevo responde-o quando ainda não há evento
 * nenhum para aquele id. Tratá-lo como erro punha um aviso na consola de cada
 * vez que se perguntasse depressa demais.
 */
async function verificarEntregaBrevo(
  mensagemId: string,
  chave: string,
): Promise<ResultadoVerificacao> {
  try {
    const url = `https://api.brevo.com/v3/smtp/statistics/events?messageId=${encodeURIComponent(mensagemId)}&limit=50`;
    const resposta = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      headers: { "api-key": chave },
    });

    if (resposta.status === 404) {
      return { ok: true, evento: "pendente", motivo: "ainda sem eventos no Brevo" };
    }

    if (!resposta.ok) {
      const corpo = await resposta.text();
      return {
        ok: false,
        erro: `Brevo devolveu ${resposta.status} ao consultar ${mensagemId}: ${corpo}`,
      };
    }

    const corpo = (await resposta.json()) as { events?: { event?: string; reason?: string }[] };
    const eventos = corpo.events ?? [];
    if (eventos.length === 0) {
      return { ok: true, evento: "pendente", motivo: "ainda sem eventos no Brevo" };
    }

    let melhor: EventoEntrega = "pendente";
    let motivo: string | undefined;
    for (const e of eventos) {
      const nome = e.event ?? "";
      const evento = eventoBrevo(nome);
      if (GRAVIDADE[evento] <= GRAVIDADE[melhor]) continue;
      melhor = evento;
      motivo = evento === "entregue" ? undefined : e.reason || nome;
    }
    return { ok: true, evento: melhor, motivo };
  } catch (erro) {
    if (erro instanceof Error && erro.name === "TimeoutError") {
      return { ok: false, erro: `A api.brevo.com não respondeu em ${TEMPO_LIMITE_MS / 1000}s.` };
    }
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}

/**
 * Nomes de evento do Brevo, reduzidos aos quatro que nos dizem alguma coisa.
 *
 * O `includes("bounce")` apanha `bounces`, `hardBounces` e `softBounces` de uma
 * vez — o nome muda com o parâmetro `event` da consulta e com a versão da API,
 * e um mapa literal envelhecia em silêncio para o lado errado (um bounce lido
 * como pendente é um cliente que fica sem link e ninguém dá por isso).
 */
function eventoBrevo(nome: string): EventoEntrega {
  const n = nome.toLowerCase();
  if (n.includes("bounce") || n === "blocked" || n === "invalid" || n === "error") {
    return "devolvido";
  }
  if (n === "spam" || n === "complaint") return "queixa";
  if (n === "delivered") return "entregue";
  return "pendente";
}

const GRAVIDADE: Record<EventoEntrega, number> = {
  pendente: 0,
  entregue: 1,
  queixa: 2,
  devolvido: 3,
};

/**
 * Mailjet: `GET /v3/REST/message/{id}` devolve o `Status` da mensagem.
 *
 * O Mailjet não expõe um evento `delivered` por API (só nos webhooks): o
 * estado `sent` é ele a dizer que entregou a mensagem ao servidor de destino,
 * e `open`/`click` são provas melhores. `bounce`, `blocked` e `spam` são
 * conclusivos e têm prioridade — um `bounce` depois de `sent` tem de ser lido
 * como devolvido, e por isso é que o mapeamento é explícito e não por ordem
 * de chegada.
 */
async function verificarEntregaMailjet(
  mensagemId: string,
  chave: string,
  segredo: string,
): Promise<ResultadoVerificacao> {
  try {
    const resposta = await fetch(
      `https://api.mailjet.com/v3/REST/message/${encodeURIComponent(mensagemId)}`,
      {
        method: "GET",
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
        headers: {
          Authorization: `Basic ${Buffer.from(`${chave}:${segredo}`).toString("base64")}`,
        },
      },
    );

    if (!resposta.ok) {
      const corpo = await resposta.text();
      return {
        ok: false,
        erro: `Mailjet devolveu ${resposta.status} ao consultar ${mensagemId}: ${corpo}`,
      };
    }

    const corpo = (await resposta.json()) as { Data?: { Status?: string }[] };
    const estado = corpo.Data?.[0]?.Status ?? "";
    const nome = estado.toLowerCase();
    if (nome === "bounce" || nome === "blocked" || nome === "error") {
      return { ok: true, evento: "devolvido", motivo: estado };
    }
    if (nome === "spam") return { ok: true, evento: "queixa", motivo: "marcado como spam" };
    if (nome === "sent" || nome === "open" || nome === "click" || nome === "unsub") {
      return { ok: true, evento: "entregue" };
    }
    return { ok: true, evento: "pendente", motivo: estado || "sem Status no Mailjet" };
  } catch (erro) {
    if (erro instanceof Error && erro.name === "TimeoutError") {
      return { ok: false, erro: `A api.mailjet.com não respondeu em ${TEMPO_LIMITE_MS / 1000}s.` };
    }
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}

/**
 * Confirma a entrega e atualiza a linha do diário. Não lança e não é esperada.
 *
 * **Porquê isto e não um webhook.** O webhook do Resend é a via oficial e é a
 * que se usaria num sistema a sério, mas custa três coisas que uma POC não tem:
 * um endereço público sempre acessível e fora do `middleware` de autenticação,
 * a verificação da assinatura (`svix`) — sem a qual o endereço é um botão para
 * qualquer um marcar emails como entregues —, e configuração no painel de
 * *cada* fornecedor, que fica por fazer no dia em que se muda de conta e
 * ninguém percebe porque é que os estados pararam. E, sendo dois canais, seriam
 * dois endereços com dois formatos e dois esquemas de assinatura.
 *
 * A sondagem diferida não precisa de nada disso: corre no mesmo processo Node
 * do servidor — que é um contentor de vida longa no Coolify, não uma função
 * serverless que morre com a resposta —, usa a chave que já existe, e funciona
 * igual nos dois fornecedores. Custa três pedidos HTTP por email.
 *
 * **O que isto não cobre**, e é de propósito: um reinício do contentor a meio
 * perde as verificações por fazer, e a linha fica em `enviado`. Como `enviado`
 * quer dizer exatamente "o fornecedor aceitou, a entrega não foi confirmada",
 * isso não é uma mentira — é o que se sabe. O `pnpm email:conferir` apanha as
 * que ficaram para trás, e um bounce que chegue depois da última tentativa
 * também.
 */
export async function confirmarEntrega(p: {
  linhaId: string;
  canal: CanalEmail;
  mensagemId: string;
  para: string;
  template: TemplateEmail;
  /** Só os testes passam isto — em produção são as `ESPERAS_ENTREGA_MS`. */
  esperas?: readonly number[];
}): Promise<EventoEntrega> {
  const esperas = p.esperas ?? ESPERAS_ENTREGA_MS;
  let ultimoMotivo: string | undefined;

  for (const espera of esperas) {
    await dormir(espera);

    const r = await verificarEntrega(p.canal, p.mensagemId);
    if (!r.ok) {
      // Não muda o estado: uma consulta que falhou não diz nada sobre a
      // mensagem. Marcar a linha aqui era transformar uma falha nossa numa
      // acusação ao destinatário.
      console.warn(
        `[email] não se conseguiu confirmar a entrega para ${p.para} ` +
          `(${p.canal} ${p.mensagemId}): ${r.erro}`,
      );
      continue;
    }

    ultimoMotivo = r.motivo;
    if (r.evento === "pendente") continue;

    await marcarEntrega(p.linhaId, r.evento, r.motivo);

    if (r.evento === "entregue") {
      console.info(`[email] entregue a ${p.para} (${p.canal} ${p.mensagemId})`);
    } else {
      console.error(
        `[email] ${r.evento === "devolvido" ? "DEVOLVIDO" : "QUEIXA"} — ${p.para} ` +
          `template=${p.template} (${p.canal} ${p.mensagemId}): ${r.motivo ?? "sem motivo"}`,
      );
    }
    return r.evento;
  }

  console.warn(
    `[email] entrega por confirmar para ${p.para} (${p.canal} ${p.mensagemId}) ` +
      `depois de ${esperas.length} tentativa(s)${ultimoMotivo ? `; último estado: ${ultimoMotivo}` : ""}. ` +
      "A linha fica em «enviado» — corra `pnpm email:conferir` mais tarde.",
  );
  return "pendente";
}

/**
 * Escreve o desfecho na linha. Não lança, pela mesma razão que o `registar`:
 * o email já saiu (ou já não saiu) e nada disto o muda.
 *
 * O `erro` só é tocado quando há motivo — um `entregue` não pode apagar a razão
 * de uma tentativa anterior ter falhado.
 */
async function marcarEntrega(
  linhaId: string,
  evento: Exclude<EventoEntrega, "pendente">,
  motivo: string | undefined,
): Promise<void> {
  try {
    await db()
      .update(emailLog)
      .set({
        estado: ESTADO_POR_EVENTO[evento],
        verificadoEm: new Date(),
        ...(motivo ? { erro: motivo.slice(0, 2000) } : {}),
      })
      .where(eq(emailLog.id, linhaId));
  } catch (e) {
    console.error(
      `[email] FALHOU a atualização de email_log ${linhaId} para «${evento}». ` +
        "O /emails vai continuar a dizer «Aceite» a uma mensagem cujo desfecho já se conhece.",
      e,
    );
  }
}
