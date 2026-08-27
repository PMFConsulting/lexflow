import "server-only";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db";
import { emailLog } from "@/db/schema/email";
import type { canalEmail, estadoEmail, templateEmail } from "@/db/schema/enums";
import { organizacao } from "@/db/schema/organizacao";
import { enviarSmtp } from "@/lib/smtp";
import { env, type Ambiente } from "@/env";

export type CanalEmail = (typeof canalEmail.enumValues)[number];
export type EstadoEmail = (typeof estadoEmail.enumValues)[number];
export type TemplateEmail = (typeof templateEmail.enumValues)[number];

/**
 * What the channel returns. Success now carries the channel that accepted and
 * the identifier it gave the message — without that identifier there is no way
 * to go back and ask it what happened afterwards, which is the whole problem
 * `confirmarEntrega` solves. It is `null` when the provider accepted but
 * returned no recognisable id: accepted is still accepted, it just stops being
 * traceable.
 */
export type ResultadoEnvio =
  | { ok: true; canal: CanalEmail; mensagemId: string | null }
  | { ok: false; erro: string };

export type AnexoEmail = {
  /** The name the attachment arrives with in the client's mailbox. */
  nome: string;
  conteudo: Buffer;
};

type ParametrosEmail = {
  para: string;
  assunto: string;
  html: string;
  anexos?: AnexoEmail[];
  /**
   * Which email this is. Mandatory on purpose: it is what guarantees a new
   * sending path cannot come into being without entering the log — whoever
   * writes it has to answer the question for the code to compile.
   */
  template: TemplateEmail;
  /**
   * A sociedade em nome de quem esta mensagem sai. É por ela que o remetente é
   * resolvido — ver `remetenteDaOrganizacao`.
   */
  organizacaoId?: string | null;
  /**
   * Força o `From`, saltando a consulta à sociedade.
   *
   * Existe para quem já tem o endereço em mãos e não quer uma ida à base de
   * dados — o `pnpm email:testar`, um envio de diagnóstico. Não é a via normal:
   * o remetente de um email de uma sociedade é uma propriedade dela, não uma
   * decisão de quem chama.
   */
  remetente?: string;
  processoId?: string | null;
  /**
   * SHA-256 of the magic link token, when the email carries one. Never the
   * plaintext token — see the note on the column, in `db/schema/email.ts`.
   */
  tokenHash?: string | null;
};

/**
 * How long the provider is waited on before giving up.
 *
 * Without this, a closed outbound path to the internet on the server gave no
 * error at all: the `fetch` hung, and the Server Action creating the matter
 * with it — the user was left with the button on "A criar…" forever and there
 * was no line in the log saying why. A send taking more than fifteen seconds
 * has already failed; what is missing is saying so.
 */
const TEMPO_LIMITE_MS = 15_000;

/**
 * When the provider is asked again whether the message arrived.
 *
 * Three attempts, ~3 minutes in total. A normal delivery is resolved on the
 * first; a `hardBounce` from a domain that does not exist likewise. What is
 * left for the third are the servers that accept and only then decide — and
 * whatever is left over from that stays at `enviado`, which is the truth about
 * it.
 */
const ESPERAS_ENTREGA_MS = [15_000, 45_000, 120_000] as const;

/**
 * Writes the log row. Never throws. Returns the row `id`, or `null` if the
 * write failed — whoever receives it uses it to touch the row again when the
 * provider says what it did with the message.
 *
 * An email that went out and was not recorded is bad; an email that did not go
 * out *because* the recording failed is worse. The write is the last step and
 * its error stops at the console: the value of this table is operational, not
 * legal — what the law requires to be kept is in `evento_auditoria`, on another
 * write path.
 *
 * The error is shouted with the recipient and the template in front, and not
 * just with the exception. A failed write leaves `/emails` saying "0 mensagens",
 * which is exactly what is seen when the send was not even attempted: without
 * this console line the two cases are indistinguishable from outside — and it
 * was by confusing them that a whole investigation was lost.
 *
 * The `id` is generated here rather than asked of the database with a
 * `returning` (D15): that way there is an identifier even when the INSERT blows
 * up, and the write remains a single statement.
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
        // The error is truncated: a provider's response can come with a whole
        // body, and the column is for diagnosis, not for archiving HTML.
        erro: resultado.ok ? null : resultado.erro.slice(0, 2000),
      });
    return linhaId;
  } catch (e) {
    console.error(
      `[email] FAILED to write to email_log — template=${p.template} to=${p.para} ` +
        `state=${resultado.ok ? "enviado" : "erro"}. /emails will show fewer ` +
        `messages than were attempted.`,
      e,
    );
    return null;
  }
}

/**
 * Transactional email sending (Brevo, with Resend as a fallback). Never lets
 * the flow blow up: with no key configured, it stops at the log; any error in
 * the call is caught and returned, not propagated.
 *
 * Every exit path goes through `registar` — including the missing-key one, the
 * exception one and the one where `tentarEnviar` itself blows up. It is the
 * only way for the question "did the client receive anything?" to have an
 * answer when the answer is "no".
 *
 * The `try` around `tentarEnviar` is not excess zeal. It reads the environment
 * before entering its own `try` (`env()` throws when a variable is missing),
 * and an exception there jumped over `registar` **and** propagated to the
 * caller — which is how a failed send turned into a failed matter creation,
 * leaving no trace anywhere.
 *
 * What it returns is still about **acceptance** and not about delivery: an
 * `ok: true` means the provider took the message. Whoever wants to know whether
 * it reached the mailbox looks at the row's state a few minutes later — see
 * `confirmarEntrega`.
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

  // One line per attempt, always, even when the write that follows fails. It is
  // what allows answering "was it even attempted?" with no database at hand —
  // the question `/emails` saying "0 mensagens" does not distinguish from "it
  // was attempted and not recorded".
  if (resultado.ok) {
    console.info(
      `[email] accepted by ${resultado.canal} template=${p.template} to=${p.para} ` +
        `id=${resultado.mensagemId ?? "(no id)"}`,
    );
  } else {
    console.error(
      `[email] NOT sent template=${p.template} to=${p.para}: ${resultado.erro}`,
    );
  }

  const linhaId = await registar(p, resultado);

  if (resultado.ok && resultado.mensagemId && linhaId) {
    // Detached and not awaited: whoever created the matter cannot wait three
    // minutes to learn whether the email arrived. See the note in
    // `confirmarEntrega`.
    void confirmarEntrega({
      linhaId,
      canal: resultado.canal,
      mensagemId: resultado.mensagemId,
      para: p.para,
      template: p.template,
    }).catch((e) =>
      console.error(`[email] delivery confirmation blew up for ${p.para}`, e),
    );
  } else if (resultado.ok) {
    // With no id there is nobody to ask. It is stated, otherwise the row at
    // `enviado` would read as "still to be confirmed" when it is "never going
    // to be confirmed".
    console.warn(
      `[email] no provider id for ${p.para} (template=${p.template}) — ` +
        "delivery of this message will not be confirmable.",
    );
  }

  return resultado;
}

/** What gets sent, without the log bookkeeping around it. */
type Mensagem = Pick<ParametrosEmail, "para" | "assunto" | "html" | "anexos"> & {
  /** The resolved `From`, already decided — no channel picks its own. */
  de: string;
};

/**
 * Whose address this message goes out under.
 *
 * The rule in one line: **the firm's, when it has one; the installation's
 * otherwise**. `organizacao.email_remetente` is `null` for every firm that has
 * not configured anything, which is what makes the whitelabel additive — an
 * existing installation keeps sending from `EMAIL_REMETENTE` without a single
 * row changing.
 *
 * The lookup **never throws**, and that is the point of the `try`: this
 * function sits between the caller and the send, and a firm's row that cannot
 * be read is not a reason for the client to be left without a link. It falls
 * back to the global sender and says so in the console — the message still goes
 * out, from an address that is merely less right.
 *
 * It is also not conditional on the domain being verified. An address
 * configured against a domain Resend has not verified produces a 403 with the
 * sender in front (D43), which is a message solved on first reading; silently
 * sending from the platform's domain instead would produce a client asking why
 * a firm they never heard of wants their identification documents.
 */
async function remetenteDaOrganizacao(
  organizacaoId: string | null | undefined,
  global: string,
): Promise<string> {
  if (!organizacaoId) return global;

  try {
    const [linha] = await db()
      .select({ de: organizacao.emailRemetente })
      .from(organizacao)
      .where(eq(organizacao.id, organizacaoId))
      .limit(1);

    const de = linha?.de?.trim();
    return de ? de : global;
  } catch (e) {
    console.warn(
      `[email] could not read the sender of organisation ${organizacaoId} — ` +
        `falling back to ${global}.`,
      e,
    );
    return global;
  }
}

/**
 * Picks the channel and, failing that one, tries the next.
 *
 * Resend comes first for being the most reliable channel on delivery, even with
 * the shortest free quota (100 emails/day); Mailjet next (200/day) and Brevo
 * after (300/day) — but being first is not being the only one: a suspended
 * account, an unverified sender or an exhausted quota at one of the providers
 * cannot leave the client without the link. With every key configured, a send
 * only fails when they all fail — and the error message carries each one's
 * reason, because they are different and are fixed in different dashboards.
 *
 * A 429 (daily quota exhausted) pauses the channel until the end of the UTC
 * day: knocking again at the door of a provider that has already said it has no
 * quota is not a retry, it is noise — and, worse, it delays the channels that
 * can still accept.
 *
 * What this costs is the possibility of a duplicate: if a channel accepts the
 * message and the response is lost to the timeout, the next one sends a second.
 * A doubled email is preferable to none.
 */
async function tentarEnviar(p: ParametrosEmail): Promise<ResultadoEnvio> {
  const ambiente = env();
  const msg: Mensagem = {
    para: p.para,
    assunto: p.assunto,
    html: p.html,
    anexos: p.anexos,
    // Resolved **once**, before the channels are assembled, and handed to all
    // four. Letting each read it for itself is how the SMTP channel ended up
    // being the only one on `env().EMAIL_REMETENTE` while the other three were
    // already elsewhere — and a fallback that changes the sender halfway down
    // the chain is a difference nobody sees until a client asks who wrote to
    // them.
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
  // Our own SMTP (postfix on the client's server) is the last resort: it has no
  // third-party quota, but delivery is less closely watched (no domain DKIM),
  // so it only comes in when every provider has failed.
  if (ambiente.SMTP_HOST) {
    const anfitriao = ambiente.SMTP_HOST;
    const porta = ambiente.SMTP_PORT ?? 25;
    canais.push({ nome: "SMTP próprio", enviar: () => tentarEnviarSmtp(msg, anfitriao, porta) });
  }

  if (canais.length === 0) {
    const lista = p.anexos?.length ? ` anexos=${p.anexos.map((a) => a.nome).join(",")}` : "";
    console.log(`[email] (no key) to=${p.para} subject="${p.assunto}"${lista}`);
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
    // A channel that failed and was replaced leaves no row at all in
    // `email_log` — the row belongs to the send, and the send may still have
    // gone well. Without this warning, a provider could be down for weeks with
    // nothing saying so.
    if (canal !== canais[canais.length - 1]) {
      console.warn(`[email] ${canal.nome} failed (${r.erro}) — trying the next channel.`);
    }
  }

  return { ok: false, erro: erros.join(" | ") };
}

/**
 * Channels paused on an exhausted daily quota: channel name → instant (ms) at
 * which it is tried again.
 *
 * In process memory, on purpose: the pause is a decision of the moment (\"this
 * provider has already said today that it has no quota\"), not a state that
 * needs to survive a restart — after a restart, the 429 comes back and the
 * pause rebuilds itself.
 */
const esgotadosAte = new Map<string, number>();

/** End of the UTC day — the instant the providers' daily quotas reset. */
function fimDoDiaUtc(): number {
  const agora = new Date();
  return Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + 1);
}

function estaEsgotado(nome: string): boolean {
  const ate = esgotadosAte.get(nome);
  return ate !== undefined && Date.now() < ate;
}

/**
 * A 429 is the provider saying the day's quota is over. Pauses the channel
 * until the end of the UTC day — and the `Map` cleans itself: once the day is
 * over, `estaEsgotado` returns `false` and the channel comes back into
 * rotation.
 */
function marcarEsgotado(nome: string, erro: string): void {
  if (/\b429\b/i.test(erro)) {
    esgotadosAte.set(nome, fimDoDiaUtc());
    console.warn(`[email] ${nome} with daily quota exhausted (429) — paused until the end of the UTC day.`);
  }
}

/**
 * Reactivates every paused channel. Exported for the tests (the pause state
 * lives in the module and does not survive a `vi.resetModules` without this)
 * and for whoever wants to reactivate a channel by hand without restarting the
 * process.
 */
export function limparPausasDeQuota(): void {
  esgotadosAte.clear();
}

/**
 * Reads the identifier the provider gave the message.
 *
 * Never throws: a 200 response with a body that is not the expected one is an
 * accepted send left without a trace, not a failed send. Swapping the two would
 * be telling the second channel to repeat a message that has already gone out.
 */
async function idDaResposta(resposta: Response, campo: "id" | "messageId"): Promise<string | null> {
  try {
    const corpo: unknown = await resposta.json();
    if (typeof corpo !== "object" || corpo === null) return null;
    const registo = corpo as Record<string, unknown>;
    const valor = registo[campo];
    if (typeof valor === "string" && valor.length > 0) return valor;
    // Brevo returns `messageIds` (plural) when there is more than one
    // recipient. We always send one, but the response shape is theirs.
    const plural = registo.messageIds;
    if (Array.isArray(plural) && typeof plural[0] === "string") return plural[0];
    return null;
  } catch {
    return null;
  }
}

/** Sending via Resend: `Authorization: Bearer`, attachments in `attachments`. */
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
        // Resend wants the content in base64. The key is only included when
        // there are attachments: an `attachments: []` makes the API answer 422.
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
      // The sender goes into the message because it is the most likely cause of
      // a 403 and the one not visible in the response: Resend refuses any send
      // from a domain not verified on the account, and `POC@jmassano.pt` is a
      // default value nobody wrote and therefore nobody suspects. Since the
      // whitelabel, it is also the firm's own address — and then the 403 says,
      // in one line, that the domain was configured and never verified.
      return {
        ok: false,
        erro: `Resend devolveu ${resposta.status} (de=${de}): ${corpo}`,
      };
    }

    return { ok: true, canal: "resend", mensagemId: await idDaResposta(resposta, "id") };
  } catch (erro) {
    // `AbortSignal.timeout` throws a `TimeoutError` whose `message` is generic
    // ("The operation was aborted due to timeout") and does not say who was
    // being called — in an email log that is worth nothing.
    if (erro instanceof Error && erro.name === "TimeoutError") {
      return {
        ok: false,
        erro: `A api.resend.com não respondeu em ${TEMPO_LIMITE_MS / 1000}s — verifique a saída para a Internet do servidor.`,
      };
    }
    return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
  }
}

/** Sending via Brevo (ex-Sendinblue): `api-key` in the header, attachments in `attachment`. */
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
        // Brevo wants the content in base64, in the `attachment` field.
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
 * Sending via Mailjet: Basic authentication (key:secret), attachments in
 * `Attachments` (base64, with a mandatory `ContentType` — Mailjet does not
 * infer it from the name, unlike Resend and Brevo).
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

/**
 * Sending via Twilio SendGrid: `Authorization: Bearer`, message ID returned in
 * `X-Message-Id` header.
 */
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
 * Sending through our own SMTP (postfix on the server). No provider id: postfix
 * has no API — accepted is accepted, and delivery itself is left without a
 * trace (`mensagemId` `null`, and `confirmarEntrega` skips these rows).
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
 * What the provider knows about the message **after** having accepted it.
 *
 * `pendente` is not "it did not arrive": it is "it has not decided yet". A
 * destination server can accept in three seconds or in three minutes, and
 * calling that a failure along the way would be inventing a fault.
 */
export type EventoEntrega = "entregue" | "devolvido" | "queixa" | "pendente";

export type ResultadoVerificacao =
  | { ok: true; evento: EventoEntrega; motivo?: string }
  | { ok: false; erro: string };

/** Only conclusive events change the row's state. */
const ESTADO_POR_EVENTO = {
  entregue: "entregue",
  devolvido: "devolvido",
  queixa: "queixa",
} as const satisfies Record<Exclude<EventoEntrega, "pendente">, EstadoEmail>;

/**
 * Waits without holding the process up.
 *
 * The `unref` is what stops a `pnpm email:testar` or a migration script sitting
 * still for two minutes waiting on a timer that only exists for a courtesy
 * check.
 */
function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const temporizador: unknown = setTimeout(resolve, ms);
    (temporizador as { unref?: () => void }).unref?.();
  });
}

/**
 * Asks the provider what happened to the message after it accepted it.
 *
 * Exported because its value is not only that of the automatic confirmation:
 * given a `mensagem_id` from `/emails`, this answers "did it arrive?" without
 * opening anybody's dashboard.
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
 * Resend: `GET /emails/{id}` returns the message's `last_event`.
 *
 * The states that matter are three — `delivered`, `bounced`, `complained`.
 * Everything else (`queued`, `scheduled`, `sent`, `delivery_delayed`) is the
 * provider saying it does not know yet, and translates to `pendente` with the
 * raw name as the reason: a new event on their side cannot pass for delivery.
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
 * Brevo: `GET /v3/smtp/statistics/events?messageId=…` returns the message's
 * list of events.
 *
 * Unlike Resend, there is no "last event": a list comes back, and its order is
 * not the order of severity. A message can have `delivered` and, two days
 * later, `spam`. The most severe of those present wins — it is what has to be
 * acted on, and that is why it is ordered by severity and not by date.
 *
 * A 404 is a normal response: Brevo answers it when there is still no event at
 * all for that id. Treating it as an error put a console warning up every time
 * the question was asked too soon.
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
 * Brevo event names, reduced to the four that tell us something.
 *
 * The `includes("bounce")` catches `bounces`, `hardBounces` and `softBounces`
 * in one go — the name changes with the query's `event` parameter and with the
 * API version, and a literal map aged silently towards the wrong side (a bounce
 * read as pending is a client left without a link and nobody notices).
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
 * Mailjet: `GET /v3/REST/message/{id}` returns the message's `Status`.
 *
 * Mailjet does not expose a `delivered` event over the API (only in webhooks):
 * the `sent` state is it saying it handed the message to the destination
 * server, and `open`/`click` are better proof. `bounce`, `blocked` and `spam`
 * are conclusive and take priority — a `bounce` after a `sent` has to be read
 * as returned, and that is why the mapping is explicit and not by order of
 * arrival.
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
 * Twilio SendGrid: `GET /v3/messages/{id}` returns the message status and events.
 */
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
 * Confirms delivery and updates the log row. Does not throw and is not awaited.
 *
 * **Why this and not a webhook.** Resend's webhook is the official route and
 * the one that would be used in a serious system, but it costs three things a
 * POC does not have: a public address always reachable and outside the
 * authentication `middleware`, signature verification (`svix`) — without which
 * the address is a button for anyone to mark emails as delivered — and
 * configuration in *each* provider's dashboard, which goes undone the day the
 * account changes and nobody works out why the states stopped. And, with two
 * channels, it would be two addresses with two formats and two signature
 * schemes.
 *
 * Deferred polling needs none of that: it runs in the server's own Node process
 * — which is a long-lived container on Coolify, not a serverless function that
 * dies with the response — it uses the key that already exists, and it works
 * the same on both providers. It costs three HTTP requests per email.
 *
 * **What this does not cover**, and on purpose: a container restart partway
 * through loses the pending checks, and the row stays at `enviado`. Since
 * `enviado` means exactly "the provider accepted, delivery was not confirmed",
 * that is no lie — it is what is known. `pnpm email:conferir` picks up the ones
 * left behind, and a bounce arriving after the last attempt too.
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
      // Does not change the state: a lookup that failed says nothing about the
      // message. Marking the row here would be turning a failure of ours into
      // an accusation against the recipient.
      console.warn(
        `[email] could not confirm delivery to ${p.para} ` +
          `(${p.canal} ${p.mensagemId}): ${r.erro}`,
      );
      continue;
    }

    ultimoMotivo = r.motivo;
    if (r.evento === "pendente") continue;

    await marcarEntrega(p.linhaId, r.evento, r.motivo);

    if (r.evento === "entregue") {
      console.info(`[email] delivered to ${p.para} (${p.canal} ${p.mensagemId})`);
    } else {
      console.error(
        `[email] ${r.evento === "devolvido" ? "BOUNCED" : "COMPLAINT"} — ${p.para} ` +
          `template=${p.template} (${p.canal} ${p.mensagemId}): ${r.motivo ?? "no reason"}`,
      );
    }
    return r.evento;
  }

  console.warn(
    `[email] delivery unconfirmed for ${p.para} (${p.canal} ${p.mensagemId}) ` +
      `after ${esperas.length} attempt(s)${ultimoMotivo ? `; last state: ${ultimoMotivo}` : ""}. ` +
      "The row stays at «enviado» — run `pnpm email:conferir` later.",
  );
  return "pendente";
}

/**
 * Writes the outcome into the row. Does not throw, for the same reason as
 * `registar`: the email has already gone out (or already has not) and none of
 * this changes that.
 *
 * `erro` is only touched when there is a reason — an `entregue` cannot erase
 * the reason an earlier attempt failed.
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
        "/emails will keep saying «Aceite» about a message whose outcome is already known.",
      e,
    );
  }
}
