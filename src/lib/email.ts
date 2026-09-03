import "server-only";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db";
import { emailLog } from "@/db/schema/email";
import type { canalEmail, estadoEmail, templateEmail } from "@/db/schema/enums";
import { organizacao } from "@/db/schema/organizacao";
import { mascararEmail } from "@/lib/redigir";
import { enviarSmtp } from "@/lib/smtp";
import { env, type Ambiente } from "@/env";

/**
 * INVENTÁRIO DE SUBCONTRATANTES — canal de email (RGPD, artigo 28.º e artigo 30.º).
 *
 * Cada um destes fornecedores recebe, no momento do envio, o endereço do
 * destinatário, o assunto, o corpo HTML e os anexos — o que inclui
 * `summary.pdf` e `dados_cliente.pdf`, com dados de identificação. São, por
 * isso, subcontratantes de tratamento e não meros fornecedores técnicos: cada
 * um precisa de contrato de subcontratação e de entrada no registo de
 * atividades de tratamento.
 *
 * Ativos neste ficheiro, pela ordem de tentativa de `tentarEnviar`:
 *
 * | Canal            | Variável de ambiente que o liga            | Onde trata      |
 * |------------------|--------------------------------------------|-----------------|
 * | Resend           | `RESEND_API_KEY`                           | EUA (Resend Inc.) |
 * | Mailjet          | `MAILJET_API_KEY` + `MAILJET_SECRET_KEY`   | UE (Sinch/França) |
 * | Brevo            | `BREVO_API_KEY`                            | UE (França)     |
 * | Twilio SendGrid  | `TWILIO_SENDGRID_API_KEY`                  | EUA (Twilio Inc.) |
 * | SMTP próprio     | `SMTP_HOST` (+ `SMTP_PORT`)                | onde o servidor estiver |
 *
 * Fora deste ficheiro, no mesmo inventário: **SFTP** para o servidor da
 * sociedade e **AWS S3** (um bucket por sociedade, D65) — ver
 * `src/lib/storage/index.ts`, que tem a outra metade desta lista.
 *
 * Duas consequências práticas, e é por elas que este comentário existe:
 * 1. Um canal **configurado** é um canal por onde os dados podem sair, mesmo
 *    que nunca tenha sido o primeiro a responder — o recuo entre canais é
 *    automático. Desligar um subcontratante é tirar-lhe a variável de
 *    ambiente, não contar com a ordem.
 * 2. Resend e SendGrid tratam fora da UE. Uma sociedade que não os tenha nas
 *    suas cláusulas de transferência internacional não deve ter essas chaves
 *    configuradas na instalação dela.
 *
 * Acrescentar um canal aqui é acrescentar um subcontratante: a linha na tabela
 * acima faz parte da mudança, não é documentação a posteriori.
 */

export type CanalEmail = (typeof canalEmail.enumValues)[number];
export type EstadoEmail = (typeof estadoEmail.enumValues)[number];
export type TemplateEmail = (typeof templateEmail.enumValues)[number];

/**
 * O que o canal devolve. Sucesso leva o canal que aceitou e o identificador da
 * mensagem — sem ele não há como perguntar depois o que aconteceu
 * (`confirmarEntrega`). `null` quando o fornecedor aceitou sem devolver um id
 * reconhecível: aceite continua aceite, só deixa de ser rastreável.
 */
export type ResultadoEnvio =
  | { ok: true; canal: CanalEmail; mensagemId: string | null }
  | { ok: false; erro: string };

export type AnexoEmail = {
  /** O nome com que o anexo chega à caixa de correio do cliente. */
  nome: string;
  conteudo: Buffer;
};

type ParametrosEmail = {
  para: string;
  assunto: string;
  html: string;
  anexos?: AnexoEmail[];
  /** Qual email é este. Obrigatório de propósito — sem responder, o código não compila (D34). */
  template: TemplateEmail;
  /**
   * A sociedade em nome de quem esta mensagem sai. É por ela que o remetente é
   * resolvido — ver `remetenteDaOrganizacao`.
   */
  organizacaoId?: string | null;
  /**
   * Força o `From`, saltando a consulta à sociedade — usado por
   * `pnpm email:testar`, um envio de diagnóstico. Não é a via normal: o
   * remetente é propriedade da sociedade, não decisão de quem chama.
   */
  remetente?: string;
  processoId?: string | null;
  /** SHA-256 do token do link mágico, quando o email o carrega. Nunca o token em claro (D4). */
  tokenHash?: string | null;
};

/**
 * Tempo de espera pelo fornecedor antes de desistir. Sem isto, uma saída de
 * rede fechada não dava erro nenhum — o fetch ficava pendurado e a Server
 * Action com ele (D42).
 */
const TEMPO_LIMITE_MS = 15_000;

/**
 * Quando se pergunta outra vez ao fornecedor se a mensagem chegou. Três
 * tentativas, ~3 minutos no total — a maioria resolve-se na primeira; o que
 * sobrar fica em `enviado`, que é a verdade sobre isso (D51).
 */
const ESPERAS_ENTREGA_MS = [15_000, 45_000, 120_000] as const;

/**
 * Grava a linha do diário. Nunca lança. Devolve o `id`, ou `null` se a
 * escrita falhar. Um email que sai e não fica registado é mau; um email que
 * não sai *por causa* do registo falhar é pior (D34) — o que a lei exige
 * manter está em `evento_auditoria`, noutro caminho de escrita.
 *
 * `id` gerado aqui e não por `returning` (D15): garante identificador mesmo
 * que o INSERT rebente.
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
        // Erro truncado: a coluna é para diagnóstico, não para arquivar HTML.
        erro: resultado.ok ? null : resultado.erro.slice(0, 2000),
      });
    return linhaId;
  } catch (e) {
    console.error(
      `[email] FAILED to write to email_log template=${p.template} para=${mascararEmail(p.para)} ` +
        `estado=${resultado.ok ? "enviado" : "erro"}`,
      e,
    );
    return null;
  }
}

/**
 * Envio transacional (vários canais, ver `tentarEnviar`). Nunca deixa o fluxo
 * rebentar: sem chave configurada para no log; qualquer erro é apanhado e
 * devolvido, não propagado (D42).
 *
 * Toda a saída passa por `registar`, incluindo a de chave em falta e a de
 * exceção — é a única forma de "o cliente recebeu alguma coisa?" ter resposta
 * quando a resposta é não.
 *
 * O que devolve é sobre aceitação, não entrega: `ok: true` só diz que o
 * fornecedor aceitou a mensagem — ver `confirmarEntrega` para o resto.
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

  // Uma linha por tentativa, sempre — mesmo que a escrita seguinte falhe.
  if (resultado.ok) {
    console.info(
      `[email] aceite por ${resultado.canal} template=${p.template} para=${mascararEmail(p.para)} ` +
        `id=${resultado.mensagemId ?? "(sem id)"}`,
    );
  } else {
    console.error(
      `[email] não enviado template=${p.template} para=${mascararEmail(p.para)}: ${resultado.erro}`,
    );
  }

  const linhaId = await registar(p, resultado);

  if (resultado.ok && resultado.mensagemId && linhaId) {
    // Disparado sem await: quem criou o processo não pode esperar três
    // minutos para saber se o email chegou.
    void confirmarEntrega({
      linhaId,
      canal: resultado.canal,
      mensagemId: resultado.mensagemId,
      para: p.para,
      template: p.template,
    }).catch((e) =>
      console.error(`[email] delivery confirmation blew up for ${mascararEmail(p.para)}`, e),
    );
  } else if (resultado.ok) {
    // Sem id não há a quem perguntar depois — dito aqui, senão a linha em
    // "enviado" lê-se como "por confirmar" quando nunca vai ser confirmada.
    console.warn(
      `[email] no provider id for ${mascararEmail(p.para)} (template=${p.template}) — ` +
        "delivery of this message will not be confirmable.",
    );
  }

  return resultado;
}

/** O que é enviado, sem a contabilidade do diário à volta. */
type Mensagem = Pick<ParametrosEmail, "para" | "assunto" | "html" | "anexos"> & {
  /** O `From` já resolvido — nenhum canal escolhe o seu. */
  de: string;
};

/**
 * O estado em que o fornecedor dá um domínio por verificado. Espelho do
 * `status` da Resend, gravado em `organizacao.dominio_estado` por
 * `features/plataforma/dominios.ts` — nenhuma outra palavra conta como
 * verificado, incluindo `pending` e `failed`.
 */
const DOMINIO_VERIFICADO = "verified";

/**
 * Em nome de quem esta mensagem sai: da sociedade quando tem remetente
 * configurado **e o domínio desse remetente está verificado**, da instalação em
 * qualquer outro caso. `organizacao.email_remetente` fica `null` até ser
 * configurado, o que torna o whitelabel aditivo.
 *
 * A verificação do domínio é a condição e não um detalhe: o remetente resolve-se
 * uma vez e segue igual para todos os canais do recuo, e a verificação de
 * domínio vive na conta da Resend — o Mailjet, o Brevo, o SendGrid e o SMTP
 * próprio não sabem nada dela. Sem esta porta, um domínio por verificar dava um
 * 403 legível na Resend (D43) e, no canal seguinte, um envio **aceite** com um
 * `From` que o destinatário não consegue autenticar: SPF e DKIM falham, a
 * mensagem cai em spam ou é recusada em silêncio, e o `email_log` diz «Aceite».
 * Sair do remetente global é menos exato e chega; sair de um domínio alheio não
 * verificado não chega de todo.
 *
 * A consulta nunca lança — uma linha ilegível não pode deixar o cliente sem
 * link, recua para o remetente global e diz porquê na consola.
 */
async function remetenteDaOrganizacao(
  organizacaoId: string | null | undefined,
  global: string,
): Promise<string> {
  if (!organizacaoId) return global;

  try {
    const [linha] = await db()
      .select({ de: organizacao.emailRemetente, estado: organizacao.dominioEstado })
      .from(organizacao)
      .where(eq(organizacao.id, organizacaoId))
      .limit(1);

    const de = linha?.de?.trim();
    if (!de) return global;

    if (linha?.estado !== DOMINIO_VERIFICADO) {
      // Dito alto: uma sociedade que configurou o endereço e nunca acabou a
      // verificação continua a receber emails enviados, só que assinados pela
      // plataforma — sem esta linha, a diferença não aparece em lado nenhum.
      console.warn(
        `[email] organisation ${organizacaoId} has sender ${mascararEmail(de)} but its domain is ` +
          `"${linha?.estado ?? "(por configurar)"}" and not "${DOMINIO_VERIFICADO}" — ` +
          `falling back to ${mascararEmail(global)}.`,
      );
      return global;
    }

    return de;
  } catch (e) {
    console.warn(
      `[email] could not read the sender of organisation ${organizacaoId} — ` +
        `falling back to ${mascararEmail(global)}.`,
      e,
    );
    return global;
  }
}

/**
 * Escolhe o canal e, falhando esse, tenta o seguinte. Resend primeiro (mais
 * fiável, quota mais curta), depois Mailjet, depois Brevo — mas ser primeiro
 * não é ser único: uma conta suspensa ou quota esgotada não pode deixar o
 * cliente sem link. Um 429 pausa o canal até ao fim do dia UTC.
 *
 * Custo aceite: se um canal aceitar e a resposta se perder no timeout, o
 * seguinte envia outra vez — um email a dobrar é preferível a nenhum.
 */
async function tentarEnviar(p: ParametrosEmail): Promise<ResultadoEnvio> {
  const ambiente = env();
  const msg: Mensagem = {
    para: p.para,
    assunto: p.assunto,
    html: p.html,
    anexos: p.anexos,
    // Resolvido uma vez só, antes dos canais, e passado a todos — deixar cada
    // um ler por si foi como o SMTP ficou preso a EMAIL_REMETENTE enquanto os
    // outros já usavam outro valor.
    de: p.remetente?.trim() || (await remetenteDaOrganizacao(p.organizacaoId, ambiente.EMAIL_REMETENTE)),
  };

  const canais: { nome: string; enviar: () => Promise<ResultadoEnvio> }[] = [];
  if (ambiente.RESEND_API_KEY) {
    const chave = ambiente.RESEND_API_KEY;
    canais.push({ nome: "Resend", enviar: () => tentarEnviarResend(msg, chave) });
  }
  if (ambiente.MAILJET_API_KEY && ambiente.MAILJET_SECRET_KEY) {
    const chave = ambiente.MAILJET_API_KEY;
    const segredo = ambiente.MAILJET_SECRET_KEY;
    canais.push({ nome: "Mailjet", enviar: () => tentarEnviarMailjet(msg, chave, segredo) });
  }
  if (ambiente.BREVO_API_KEY) {
    const chave = ambiente.BREVO_API_KEY;
    canais.push({ nome: "Brevo", enviar: () => tentarEnviarBrevo(msg, chave) });
  }
  if (ambiente.TWILIO_SENDGRID_API_KEY) {
    const chave = ambiente.TWILIO_SENDGRID_API_KEY;
    canais.push({ nome: "Twilio SendGrid", enviar: () => tentarEnviarTwilio(msg, chave) });
  }
  // SMTP próprio é o último recurso: sem quota de terceiros, mas com menos
  // garantias de entrega (sem DKIM do domínio) — só entra quando os outros falham.
  if (ambiente.SMTP_HOST) {
    const anfitriao = ambiente.SMTP_HOST;
    const porta = ambiente.SMTP_PORT ?? 25;
    canais.push({ nome: "SMTP próprio", enviar: () => tentarEnviarSmtp(msg, anfitriao, porta) });
  }

  if (canais.length === 0) {
    const lista = p.anexos?.length ? ` anexos=${p.anexos.map((a) => a.nome).join(",")}` : "";
    console.log(`[email] (no key) to=${mascararEmail(p.para)} subject="${p.assunto}"${lista}`);
    return {
      ok: false,
      erro:
        "Nenhuma chave de email configurada (RESEND_API_KEY, MAILJET_API_KEY+MAILJET_SECRET_KEY, BREVO_API_KEY, TWILIO_SENDGRID_API_KEY ou SMTP_HOST)",
    };
  }

  const erros: string[] = [];
  for (const canal of canais) {
    if (estaEsgotado(canal.nome)) {
      erros.push(`${canal.nome} em pausa (quota diária esgotada — volta ao fim do dia UTC)`);
      console.warn(`[email] ${canal.nome} paused on quota — trying the next channel.`);
      continue;
    }
    const r = await canal.enviar();
    if (r.ok) return r;
    marcarEsgotado(canal.nome, r.erro);
    erros.push(r.erro);
    // Canal falhado e substituído não deixa linha em email_log — sem este
    // aviso, um fornecedor podia estar em baixo semanas sem ninguém notar.
    if (canal !== canais[canais.length - 1]) {
      console.warn(`[email] ${canal.nome} failed (${r.erro}) — trying the next channel.`);
    }
  }

  return { ok: false, erro: erros.join(" | ") };
}

/**
 * Canais pausados por quota diária esgotada: nome → instante (ms) da próxima
 * tentativa. Em memória do processo de propósito — depois de um reinício o
 * 429 volta e a pausa reconstrói-se sozinha.
 */
const esgotadosAte = new Map<string, number>();

/** Fim do dia UTC — instante em que as quotas diárias dos fornecedores reiniciam. */
function fimDoDiaUtc(): number {
  const agora = new Date();
  return Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + 1);
}

function estaEsgotado(nome: string): boolean {
  const ate = esgotadosAte.get(nome);
  return ate !== undefined && Date.now() < ate;
}

/**
 * Um 429 é o fornecedor a dizer que a quota do dia acabou. Pausa até ao fim
 * do dia UTC — o Map limpa-se sozinho, e o canal volta à rotação.
 */
function marcarEsgotado(nome: string, erro: string): void {
  if (/\b429\b/i.test(erro)) {
    esgotadosAte.set(nome, fimDoDiaUtc());
    console.warn(`[email] ${nome} with daily quota exhausted (429) — paused until the end of the UTC day.`);
  }
}

/** Reativa todos os canais pausados — usado pelos testes e para reativar um canal à mão. */
export function limparPausasDeQuota(): void {
  esgotadosAte.clear();
}

/**
 * Lê o identificador que o fornecedor deu à mensagem. Nunca lança: um 200 com
 * corpo inesperado é um envio aceite sem rasto, não um envio falhado — trocar
 * os dois faria o canal seguinte repetir uma mensagem já enviada.
 */
async function idDaResposta(resposta: Response, campo: "id" | "messageId"): Promise<string | null> {
  try {
    const corpo: unknown = await resposta.json();
    if (typeof corpo !== "object" || corpo === null) return null;
    const registo = corpo as Record<string, unknown>;
    const valor = registo[campo];
    if (typeof valor === "string" && valor.length > 0) return valor;
    // Brevo devolve `messageIds` (plural) com mais de um destinatário; aqui é sempre um só.
    const plural = registo.messageIds;
    if (Array.isArray(plural) && typeof plural[0] === "string") return plural[0];
    return null;
  } catch {
    return null;
  }
}

/** Envio via Resend: `Authorization: Bearer`, anexos em `attachments`. */
async function tentarEnviarResend(
  { de, para, assunto, html, anexos }: Mensagem,
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
        from: de,
        to: [para],
        subject: assunto,
        html,
        // Resend quer o conteúdo em base64; `attachments: []` faz a API responder 422.
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
      // Remetente na mensagem: é a causa mais provável de um 403 e a que não
      // aparece na resposta — domínio não verificado no Resend (D43).
      return {
        ok: false,
        erro: `Resend devolveu ${resposta.status} (de=${de}): ${corpo}`,
      };
    }

    return { ok: true, canal: "resend", mensagemId: await idDaResposta(resposta, "id") };
  } catch (erro) {
    // TimeoutError tem mensagem genérica e não diz quem foi chamado — sem valor num diário de email.
    if (erro instanceof Error && erro.name === "TimeoutError") {
      return {
        ok: false,
        erro: `A api.resend.com não respondeu em ${TEMPO_LIMITE_MS / 1000}s — verifique a saída para a Internet do servidor.`,
      };
    }
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}

/** Envio via Brevo (ex-Sendinblue): `api-key` no cabeçalho, anexos em `attachment`. */
async function tentarEnviarBrevo(
  { de, para, assunto, html, anexos }: Mensagem,
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
        sender: { email: de },
        to: [{ email: para }],
        subject: assunto,
        htmlContent: html,
        // Brevo quer o conteúdo em base64, no campo `attachment`.
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
        erro: `Brevo devolveu ${resposta.status} (de=${de}): ${corpo}`,
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
 * Envio via Mailjet: autenticação Basic (key:secret), anexos em `Attachments`
 * com `ContentType` obrigatório — ao contrário de Resend/Brevo, não infere do nome.
 */
async function tentarEnviarMailjet(
  { de, para, assunto, html, anexos }: Mensagem,
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
            From: { Email: de, Name: "LexFlow" },
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
        erro: `Mailjet devolveu ${resposta.status} (de=${de}): ${corpo}`,
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

/** Envio via Twilio SendGrid: `Authorization: Bearer`, id da mensagem no cabeçalho `X-Message-Id`. */
async function tentarEnviarTwilio(
  { de, para, assunto, html, anexos }: Mensagem,
  chave: string,
): Promise<ResultadoEnvio> {
  try {
    const resposta = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      headers: {
        Authorization: `Bearer ${chave}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: para }] }],
        from: { email: de },
        subject: assunto,
        content: [{ type: "text/html", value: html }],
        ...(anexos?.length
          ? {
              attachments: anexos.map((a) => ({
                filename: a.nome,
                content: a.conteudo.toString("base64"),
                type: a.nome.toLowerCase().endsWith(".pdf")
                  ? "application/pdf"
                  : "application/octet-stream",
                disposition: "attachment",
              })),
            }
          : {}),
      }),
    });

    if (!resposta.ok) {
      const corpo = await resposta.text();
      return {
        ok: false,
        erro: `Twilio SendGrid devolveu ${resposta.status} (de=${de}): ${corpo}`,
      };
    }

    const mensagemId = resposta.headers.get("x-message-id") || resposta.headers.get("X-Message-Id");
    return {
      ok: true,
      canal: "twilio_sendgrid",
      mensagemId: mensagemId && mensagemId.length > 0 ? mensagemId : null,
    };
  } catch (erro) {
    if (erro instanceof Error && erro.name === "TimeoutError") {
      return {
        ok: false,
        erro: `A api.sendgrid.com não respondeu em ${TEMPO_LIMITE_MS / 1000}s — verifique a saída para a Internet do servidor.`,
      };
    }
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}

/**
 * Envio pelo SMTP próprio (postfix no servidor). Sem id de fornecedor —
 * postfix não tem API, aceite é aceite e a entrega fica sem rasto
 * (`mensagemId` null, `confirmarEntrega` salta estas linhas).
 */
async function tentarEnviarSmtp(
  { de, para, assunto, html, anexos }: Mensagem,
  anfitriao: string,
  porta: number,
): Promise<ResultadoEnvio> {
  const resultado = await enviarSmtp(anfitriao, porta, {
    de,
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

/* ----------------------------------------------------------------- delivery */

/**
 * O que o fornecedor sabe da mensagem depois de a ter aceite. `pendente` não
 * é "não chegou" — é "ainda não decidiu"; chamar-lhe falha seria inventar um defeito.
 */
export type EventoEntrega = "entregue" | "devolvido" | "queixa" | "pendente";

export type ResultadoVerificacao =
  | { ok: true; evento: EventoEntrega; motivo?: string }
  | { ok: false; erro: string };

/** Só eventos conclusivos mudam o estado da linha. */
const ESTADO_POR_EVENTO = {
  entregue: "entregue",
  devolvido: "devolvido",
  queixa: "queixa",
} as const satisfies Record<Exclude<EventoEntrega, "pendente">, EstadoEmail>;

/**
 * Espera sem segurar o processo. `unref` evita que um script fique parado
 * dois minutos por causa de um temporizador que só existe para uma verificação de cortesia.
 */
function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const temporizador: unknown = setTimeout(resolve, ms);
    (temporizador as { unref?: () => void }).unref?.();
  });
}

/**
 * Pergunta ao fornecedor o que aconteceu à mensagem depois de aceite.
 * Exportada porque, dado um `mensagem_id` de `/emails`, responde "chegou?"
 * sem abrir dashboard nenhum.
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

  if (canal === "twilio_sendgrid") {
    if (!ambiente.TWILIO_SENDGRID_API_KEY) {
      return {
        ok: false,
        erro: "TWILIO_SENDGRID_API_KEY não está no ambiente — a entrega não se confirma.",
      };
    }
    return verificarEntregaTwilio(mensagemId, ambiente.TWILIO_SENDGRID_API_KEY);
  }

  if (!ambiente.BREVO_API_KEY) {
    return { ok: false, erro: "BREVO_API_KEY não está no ambiente — a entrega não se confirma." };
  }
  return verificarEntregaBrevo(mensagemId, ambiente.BREVO_API_KEY);
}

/**
 * Resend: `GET /emails/{id}` devolve o `last_event` da mensagem. Três estados
 * importam — `delivered`, `bounced`, `complained`; o resto vira `pendente`
 * com o nome bruto como motivo.
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
 * Brevo: `GET /v3/smtp/statistics/events` devolve a lista de eventos, sem
 * ordem de gravidade — uma mensagem pode ter `delivered` e, dois dias depois,
 * `spam`. Vence o mais grave presente. 404 é resposta normal: ainda sem
 * evento para este id.
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
 * Nomes de evento do Brevo, reduzidos aos quatro que interessam.
 * `includes("bounce")` apanha `bounces`/`hardBounces`/`softBounces` de uma
 * vez — um mapa literal envelheceria para o lado errado (bounce lido como
 * pendente é cliente sem link e ninguém repara).
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
 * Mailjet: `GET /v3/REST/message/{id}` devolve o `Status`. Sem evento
 * `delivered` na API (só em webhooks) — `sent` só diz que entregou ao
 * servidor de destino; `bounce`/`blocked`/`spam` são conclusivos e têm prioridade.
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

/** Twilio SendGrid: `GET /v3/messages/{id}` devolve estado e eventos da mensagem. */
async function verificarEntregaTwilio(
  mensagemId: string,
  chave: string,
): Promise<ResultadoVerificacao> {
  try {
    const resposta = await fetch(
      `https://api.sendgrid.com/v3/messages/${encodeURIComponent(mensagemId)}`,
      {
        method: "GET",
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
        headers: { Authorization: `Bearer ${chave}` },
      },
    );

    if (resposta.status === 404) {
      return { ok: true, evento: "pendente", motivo: "ainda sem eventos no SendGrid" };
    }

    if (!resposta.ok) {
      const corpo = await resposta.text();
      return {
        ok: false,
        erro: `Twilio SendGrid devolveu ${resposta.status} ao consultar ${mensagemId}: ${corpo}`,
      };
    }

    const corpo = (await resposta.json()) as {
      status?: string;
      events?: { event_name?: string; reason?: string }[];
    };
    const eventos = corpo.events ?? [];

    if (eventos.length > 0) {
      let melhor: EventoEntrega = "pendente";
      let motivo: string | undefined;
      for (const e of eventos) {
        const nome = (e.event_name ?? "").toLowerCase();
        const evento = eventoSendGrid(nome);
        if (GRAVIDADE[evento] <= GRAVIDADE[melhor]) continue;
        melhor = evento;
        motivo = evento === "entregue" ? undefined : e.reason || nome;
      }
      if (melhor !== "pendente" || !corpo.status) {
        return { ok: true, evento: melhor, motivo };
      }
    }

    const estado = (corpo.status ?? "").toLowerCase();
    const evento = eventoSendGrid(estado);
    if (evento === "devolvido") {
      return { ok: true, evento: "devolvido", motivo: corpo.status || "devolvido" };
    }
    if (evento === "queixa") {
      return { ok: true, evento: "queixa", motivo: "o destinatário marcou a mensagem como spam" };
    }
    if (evento === "entregue") {
      return { ok: true, evento: "entregue" };
    }
    return { ok: true, evento: "pendente", motivo: corpo.status || "sem eventos no SendGrid" };
  } catch (erro) {
    if (erro instanceof Error && erro.name === "TimeoutError") {
      return { ok: false, erro: `A api.sendgrid.com não respondeu em ${TEMPO_LIMITE_MS / 1000}s.` };
    }
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}

function eventoSendGrid(nome: string): EventoEntrega {
  const n = nome.toLowerCase();
  if (n.includes("bounce") || n === "dropped" || n === "blocked" || n === "error" || n === "not_delivered") {
    return "devolvido";
  }
  if (n.includes("spam") || n === "complaint" || n === "spamreport") {
    return "queixa";
  }
  if (n === "delivered" || n === "open" || n === "click") {
    return "entregue";
  }
  return "pendente";
}

/**
 * Confirma entrega e atualiza a linha. Não lança e não é aguardada (D51).
 *
 * Polling em vez de webhook: um webhook custaria endereço público fora do
 * middleware, verificação de assinatura e configuração em cada dashboard —
 * o polling usa a chave que já existe e corre no próprio processo.
 *
 * O que não cobre, de propósito: um reinício a meio perde as verificações
 * pendentes e a linha fica em `enviado` — que é a verdade sobre o que se sabe.
 * `pnpm email:conferir` apanha as que ficaram por trás.
 */
export async function confirmarEntrega(p: {
  linhaId: string;
  canal: CanalEmail;
  mensagemId: string;
  para: string;
  template: TemplateEmail;
  /** Only the tests pass this — in production it is `ESPERAS_ENTREGA_MS`. */
  esperas?: readonly number[];
}): Promise<EventoEntrega> {
  const esperas = p.esperas ?? ESPERAS_ENTREGA_MS;
  let ultimoMotivo: string | undefined;

  for (const espera of esperas) {
    await dormir(espera);

    const r = await verificarEntrega(p.canal, p.mensagemId);
    if (!r.ok) {
      // Não muda o estado: uma consulta falhada nada diz sobre a mensagem —
      // marcar a linha aqui seria transformar uma falha nossa numa acusação ao destinatário.
      console.warn(
        `[email] could not confirm delivery to ${mascararEmail(p.para)} ` +
          `(${p.canal} ${p.mensagemId}): ${r.erro}`,
      );
      continue;
    }

    ultimoMotivo = r.motivo;
    if (r.evento === "pendente") continue;

    await marcarEntrega(p.linhaId, r.evento, r.motivo);

    if (r.evento === "entregue") {
      console.info(`[email] delivered to ${mascararEmail(p.para)} (${p.canal} ${p.mensagemId})`);
    } else {
      console.error(
        `[email] ${r.evento === "devolvido" ? "BOUNCED" : "COMPLAINT"} — ${mascararEmail(p.para)} ` +
          `template=${p.template} (${p.canal} ${p.mensagemId}): ${r.motivo ?? "no reason"}`,
      );
    }
    return r.evento;
  }

  console.warn(
    `[email] delivery unconfirmed for ${mascararEmail(p.para)} (${p.canal} ${p.mensagemId}) ` +
      `after ${esperas.length} attempt(s)${ultimoMotivo ? `; last state: ${ultimoMotivo}` : ""}. ` +
      "The row stays at «enviado» — run `pnpm email:conferir` later.",
  );
  return "pendente";
}

/**
 * Grava o resultado na linha. Não lança, mesma razão de `registar` — o email
 * já saiu (ou não), nada disto muda isso. `erro` só é tocado quando há motivo.
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
      `[email] FAILED to update email_log ${linhaId} to «${evento}». ` +
        "/emails vai continuar a mostrar «Aceite» sobre uma mensagem cujo resultado já se conhece.",
      e,
    );
  }
}
