import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The email channel, from the side where it fails.
 *
 * What these tests pin down is always the same rule: **a send attempt always
 * produces a row in `email_log` and never propagates an exception to the
 * caller**. While that was not so, "the client received nothing" and "it was
 * not even attempted" both read as `/emails` saying «0 mensagens» — and there
 * is no way to investigate a difference the system does not record.
 */

const linhas: Record<string, unknown>[] = [];
/** One entry per `update` to the log — what `confirmarEntrega` wrote there. */
const atualizacoes: Record<string, unknown>[] = [];
let gravacaoRebenta = false;
let atualizacaoRebenta = false;
let ambiente: Record<string, unknown> = {};
let ambienteRebenta: Error | null = null;
/**
 * O remetente da organização, tal como estaria na linha da `organizacao`.
 * `null` é a sociedade que não configurou nada — o estado de toda a instalação
 * antes do whitelabel.
 */
let remetenteDaOrg: string | null = null;
let leituraDaOrgRebenta = false;

vi.mock("@/env", () => ({
  env: () => {
    if (ambienteRebenta) throw ambienteRebenta;
    return ambiente;
  },
}));

vi.mock("@/db/schema/email", () => ({ emailLog: "email_log" }));

vi.mock("@/db", () => ({
  db: () => ({
    /** A leitura do remetente da sociedade, em `remetenteDaOrganizacao`. */
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            if (leituraDaOrgRebenta) throw new Error('relation "organizacao" does not exist');
            return [{ de: remetenteDaOrg }];
          },
        }),
      }),
    }),
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        if (gravacaoRebenta) throw new Error('relation "email_log" does not exist');
        linhas.push(v);
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => {
          if (atualizacaoRebenta) throw new Error('relation "email_log" does not exist');
          atualizacoes.push(v);
        },
      }),
    }),
  }),
}));

/**
 * Dynamic import and not static: the `vi.mock` factories close over the
 * variables declared above, and a static import runs before them.
 */
const { confirmarEntrega, enviarEmail, limparPausasDeQuota, verificarEntrega } = await import("./email");

const base = {
  para: "cliente@exemplo.pt",
  assunto: "LexFlow | Registro",
  html: "<p>olá</p>",
  template: "registo" as const,
};

let consolaErro: ReturnType<typeof vi.spyOn>;
let consolaAviso: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  linhas.length = 0;
  atualizacoes.length = 0;
  gravacaoRebenta = false;
  atualizacaoRebenta = false;
  ambienteRebenta = null;
  remetenteDaOrg = null;
  leituraDaOrgRebenta = false;
  ambiente = { RESEND_API_KEY: "re_teste", EMAIL_REMETENTE: "POC@jmassano.pt" };
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  consolaAviso = vi.spyOn(console, "warn").mockImplementation(() => {});
  consolaErro = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // The quota pause lives in the module and crosses tests — a 429 in one test
  // cannot condition the ones that follow.
  limparPausasDeQuota();
});

/** A `fetch` with the real signature, so the `signal` is inspectable. */
const espiarFetch = (impl: (url: string, opcoes?: RequestInit) => Promise<Response>) => {
  const espia = vi.fn(impl);
  vi.stubGlobal("fetch", espia);
  return espia;
};

/** A Resend response, with no network in between. */
const responde = (status: number, corpo = "") =>
  espiarFetch(async () => new Response(corpo, { status }));

describe("enviarEmail", () => {
  it("grava a linha de sucesso quando o Resend aceita, com o canal e o id", async () => {
    responde(200, '{"id":"abc"}');

    await expect(enviarEmail(base)).resolves.toEqual({
      ok: true,
      canal: "resend",
      mensagemId: "abc",
    });

    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      para: "cliente@exemplo.pt",
      template: "registo",
      // Accepted, not delivered. What confirms delivery is `confirmarEntrega`,
      // minutes later — and without the `mensagem_id` there would be nobody to
      // ask.
      estado: "enviado",
      erro: null,
      canal: "resend",
      mensagemId: "abc",
    });
  });

  /**
   * The send cannot wait on delivery. If it did, creating a matter would take
   * as many minutes as the destination server took to decide — and the user
   * would watch the button sit on "A criar…" for that whole time.
   */
  it("devolve o resultado sem esperar pela confirmação de entrega", async () => {
    const espia = espiarFetch(async () => new Response('{"id":"abc"}', { status: 200 }));

    await enviarEmail(base);

    // A single request: the send's POST. The delivery lookup comes later,
    // detached.
    expect(espia).toHaveBeenCalledTimes(1);
    expect(espia.mock.calls[0]?.[1]?.method).toBe("POST");
  });

  /**
   * A provider that accepts without returning an id leaves a message that will
   * never be confirmable. It stays at `enviado` forever — and that has to be
   * said, otherwise it reads as "still on its way".
   */
  it("avisa quando o fornecedor aceita sem devolver id", async () => {
    responde(200, "ok, mas não em JSON");

    await expect(enviarEmail(base)).resolves.toEqual({
      ok: true,
      canal: "resend",
      mensagemId: null,
    });

    expect(linhas[0]).toMatchObject({ estado: "enviado", mensagemId: null });
    expect(consolaAviso).toHaveBeenCalledWith(
      expect.stringContaining("will not be confirmable"),
    );
  });

  it("sem chave nenhuma devolve o motivo e grava na mesma", async () => {
    ambiente = { EMAIL_REMETENTE: "POC@jmassano.pt" };

    const r = await enviarEmail(base);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("RESEND_API_KEY");
    expect(r.erro).toContain("MAILJET_API_KEY+MAILJET_SECRET_KEY");
    expect(r.erro).toContain("BREVO_API_KEY");
    expect(r.erro).toContain("TWILIO_SENDGRID_API_KEY");
    expect(r.erro).toContain("SMTP_HOST");
    expect(linhas[0]).toMatchObject({ estado: "erro" });
  });

  /**
   * Resend takes priority for being the most reliable on delivery, but being
   * first is not being the only one: a suspended account or an unverified
   * sender at one of the providers cannot leave the client without the link.
   */
  it("cai para o Brevo quando o Resend recusa", async () => {
    ambiente = {
      BREVO_API_KEY: "xkeysib-teste",
      RESEND_API_KEY: "re_teste",
      EMAIL_REMETENTE: "POC@jmassano.pt",
    };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const espia = espiarFetch(async (url) =>
      url.includes("resend")
        ? new Response('{"message":"account suspended"}', { status: 401 })
        : new Response('{"messageId":"<1@brevo>"}', { status: 201 }),
    );

    await expect(enviarEmail(base)).resolves.toEqual({
      ok: true,
      canal: "brevo",
      mensagemId: "<1@brevo>",
    });

    expect(espia.mock.calls[0]?.[0]).toContain("api.resend.com");
    expect(espia.mock.calls[1]?.[0]).toContain("api.brevo.com");
    // The recorded channel is the one that **accepted**, not the one tried
    // first: it is the one that will be asked for the outcome, and Brevo's id
    // does not exist in Resend.
    expect(linhas[0]).toMatchObject({ estado: "enviado", canal: "brevo" });
  });

  it("com os dois canais em baixo, o erro leva as duas razões", async () => {
    ambiente = {
      BREVO_API_KEY: "xkeysib-teste",
      RESEND_API_KEY: "re_teste",
      EMAIL_REMETENTE: "POC@jmassano.pt",
    };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    espiarFetch(async (url) =>
      url.includes("brevo")
        ? new Response("sem conta", { status: 401 })
        : new Response("dominio por verificar", { status: 403 }),
    );

    const r = await enviarEmail(base);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("Brevo devolveu 401");
    expect(r.erro).toContain("Resend devolveu 403");
  });

  it("usa o header api-key e o campo attachment no Brevo", async () => {
    ambiente = { BREVO_API_KEY: "xkeysib-teste", EMAIL_REMETENTE: "POC@jmassano.pt" };
    const espia = responde(201, '{"messageId":"<1@brevo>"}');

    await expect(
      enviarEmail({ ...base, anexos: [{ nome: "resumo.pdf", conteudo: Buffer.from("pdf") }] }),
    ).resolves.toEqual({ ok: true, canal: "brevo", mensagemId: "<1@brevo>" });

    const [url, opcoes] = espia.mock.calls[0] ?? [];
    expect(url).toContain("api.brevo.com");
    expect((opcoes?.headers as Record<string, string>)["api-key"]).toBe("xkeysib-teste");
    const corpo = JSON.parse(String(opcoes?.body));
    expect(corpo.htmlContent).toBe("<p>olá</p>");
    expect(corpo.to).toEqual([{ email: "cliente@exemplo.pt" }]);
    expect(corpo.attachment).toEqual([
      { name: "resumo.pdf", content: Buffer.from("pdf").toString("base64") },
    ]);
  });

  /**
   * The case that costs most in production: the key is there, the send is
   * attempted, and Resend refuses because the sender's domain is not verified
   * on the account. Without the sender in the message, the 403 does not say
   * what to fix — and `POC@jmassano.pt` is a default value nobody wrote and,
   * for that very reason, nobody suspects.
   */
  it("põe o estado, o remetente e o corpo na mensagem de um 403", async () => {
    responde(403, '{"message":"The jmassano.pt domain is not verified"}');

    const r = await enviarEmail(base);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("403");
    expect(r.erro).toContain("POC@jmassano.pt");
    expect(r.erro).toContain("not verified");
    expect(linhas[0]).toMatchObject({ estado: "erro" });
  });

  it("nomeia a api.resend.com quando o pedido esgota o tempo", async () => {
    espiarFetch(async () => {
      const e = new Error("The operation was aborted due to timeout");
      e.name = "TimeoutError";
      throw e;
    });

    const r = await enviarEmail(base);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("api.resend.com");
    expect(linhas[0]).toMatchObject({ estado: "erro" });
  });

  it("desiste do envio ao fim de um tempo limite, em vez de ficar pendurado", async () => {
    const espia = espiarFetch(async () => new Response("", { status: 200 }));

    await enviarEmail(base);

    // Without `signal`, a closed outbound path to the internet left the Server
    // Action that created the matter waiting forever — no link and no error.
    expect(espia.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  /**
   * The regression this file exists to prevent. `tentarEnviar` reads the
   * environment *before* its own `try`, and `env()` throws when a variable is
   * missing: that exception jumped over the write **and** propagated to the
   * caller — which is how a failed email turned into a failed matter creation,
   * with not a line anywhere explaining it.
   */
  it("não propaga uma exceção do ambiente e regista-a", async () => {
    ambienteRebenta = new Error("Variáveis de ambiente em falta ou inválidas");

    const r = await enviarEmail(base);

    expect(r).toEqual({ ok: false, erro: "Variáveis de ambiente em falta ou inválidas" });
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ estado: "erro" });
  });

  it("um email sai mesmo quando o diário não o aceita", async () => {
    responde(200);
    gravacaoRebenta = true;

    // The send has already happened; failing here would be trading the
    // essential for the record.
    await expect(enviarEmail(base)).resolves.toEqual({
      ok: true,
      canal: "resend",
      mensagemId: null,
    });

    // And the console has to shout it: it is the only signal left that
    // `/emails` is showing fewer messages than were attempted.
    expect(consolaErro).toHaveBeenCalledWith(
      expect.stringContaining("FAILED to write to email_log"),
      expect.anything(),
    );
  });

  it("leva o processo, a organização e o hash do token para o diário", async () => {
    responde(200);

    await enviarEmail({
      ...base,
      organizacaoId: "org-1",
      processoId: "proc-1",
      tokenHash: "sha256-do-token",
    });

    expect(linhas[0]).toMatchObject({
      organizacaoId: "org-1",
      processoId: "proc-1",
      tokenHash: "sha256-do-token",
    });
  });

  it("trunca o erro em 2000 caracteres", async () => {
    responde(500, "x".repeat(5000));

    await enviarEmail(base);

    expect((linhas[0]?.erro as string).length).toBe(2000);
  });
});

/**
 * O remetente, agora por sociedade.
 *
 * A regra numa linha: **o da sociedade quando ela tem um, o da instalação
 * quando não tem**. O defeito que isto fecha não dá erro nenhum — dá um cliente
 * da segunda sociedade a receber um pedido de documentos de identificação
 * assinado com o domínio da primeira, e a não responder, que é o que ele deve
 * fazer.
 */
describe("remetente por sociedade", () => {
  const corpoEnviado = (espia: ReturnType<typeof espiarFetch>, parte: string) =>
    JSON.parse(
      String(
        (espia.mock.calls.find(([url]) => String(url).includes(parte)) as [string, RequestInit])[1]
          .body,
      ),
    );

  it("sem organização, usa o remetente global e não vai à base de dados", async () => {
    const espia = responde(200, '{"id":"abc"}');

    await enviarEmail(base);

    expect(corpoEnviado(espia, "resend").from).toBe("POC@jmassano.pt");
  });

  it("com a sociedade sem remetente configurado, continua a usar o global", async () => {
    remetenteDaOrg = null;
    const espia = responde(200, '{"id":"abc"}');

    await enviarEmail({ ...base, organizacaoId: "org-1" });

    expect(corpoEnviado(espia, "resend").from).toBe("POC@jmassano.pt");
  });

  it("com remetente na sociedade, o «de» é esse", async () => {
    remetenteDaOrg = "geral@andradecosta.pt";
    const espia = responde(200, '{"id":"abc"}');

    await enviarEmail({ ...base, organizacaoId: "org-1" });

    expect(corpoEnviado(espia, "resend").from).toBe("geral@andradecosta.pt");
  });

  /**
   * Um remetente gravado com espaços à volta (uma colagem) não é um remetente
   * diferente — mas `" geral@x.pt "` no header `From` é recusado por qualquer
   * fornecedor, e o erro que volta não fala de espaços.
   */
  it("corta os espaços em volta do remetente da sociedade", async () => {
    remetenteDaOrg = "  geral@andradecosta.pt  ";
    const espia = responde(200, '{"id":"abc"}');

    await enviarEmail({ ...base, organizacaoId: "org-1" });

    expect(corpoEnviado(espia, "resend").from).toBe("geral@andradecosta.pt");
  });

  it("um remetente vazio na sociedade não apaga o global", async () => {
    remetenteDaOrg = "   ";
    const espia = responde(200, '{"id":"abc"}');

    await enviarEmail({ ...base, organizacaoId: "org-1" });

    expect(corpoEnviado(espia, "resend").from).toBe("POC@jmassano.pt");
  });

  /**
   * A leitura da sociedade fica entre quem chama e o envio. Uma linha que não se
   * consegue ler não é razão para o cliente ficar sem o link: o email sai à
   * mesma, de um endereço apenas menos certo, e a consola di-lo.
   */
  it("se a leitura da sociedade rebentar, envia do global em vez de falhar", async () => {
    leituraDaOrgRebenta = true;
    const espia = responde(200, '{"id":"abc"}');

    await expect(enviarEmail({ ...base, organizacaoId: "org-1" })).resolves.toMatchObject({
      ok: true,
    });

    expect(corpoEnviado(espia, "resend").from).toBe("POC@jmassano.pt");
    expect(consolaAviso).toHaveBeenCalledWith(
      expect.stringContaining("could not read the sender"),
      expect.anything(),
    );
  });

  it("o «remetente» explícito ganha à sociedade e ao global", async () => {
    remetenteDaOrg = "geral@andradecosta.pt";
    const espia = responde(200, '{"id":"abc"}');

    await enviarEmail({ ...base, organizacaoId: "org-1", remetente: "diagnostico@lexflow.pt" });

    expect(corpoEnviado(espia, "resend").from).toBe("diagnostico@lexflow.pt");
  });

  /**
   * O remetente resolve-se **uma vez** e vai igual para os quatro canais. Sem
   * isso, um recuo para o canal seguinte trocava o endereço a meio da cadeia —
   * uma diferença que ninguém vê até um cliente perguntar quem lhe escreveu.
   */
  it("o mesmo remetente segue para o Mailjet e para o Brevo no recuo", async () => {
    remetenteDaOrg = "geral@andradecosta.pt";
    ambiente = {
      RESEND_API_KEY: "re_teste",
      MAILJET_API_KEY: "mj_chave",
      MAILJET_SECRET_KEY: "mj_segredo",
      BREVO_API_KEY: "xkeysib-teste",
      EMAIL_REMETENTE: "POC@jmassano.pt",
    };
    const espia = espiarFetch(async (url) => {
      if (url.includes("brevo")) return new Response('{"messageId":"<1@brevo>"}', { status: 201 });
      return new Response("recusado", { status: 401 });
    });

    await expect(enviarEmail({ ...base, organizacaoId: "org-1" })).resolves.toMatchObject({
      ok: true,
      canal: "brevo",
    });

    expect(corpoEnviado(espia, "resend").from).toBe("geral@andradecosta.pt");
    expect(corpoEnviado(espia, "mailjet").Messages[0].From.Email).toBe("geral@andradecosta.pt");
    expect(corpoEnviado(espia, "brevo").sender.email).toBe("geral@andradecosta.pt");
  });

  /**
   * O 403 mais caro de todos passa a ser o da sociedade que configurou o
   * endereço e nunca verificou o domínio. Sem o remetente na mensagem, a recusa
   * não diz o que corrigir — e agora ele é o da sociedade, não o valor por
   * omissão que ninguém escreveu.
   */
  it("o 403 do Resend nomeia o remetente da sociedade", async () => {
    remetenteDaOrg = "geral@andradecosta.pt";
    responde(403, '{"message":"The andradecosta.pt domain is not verified"}');

    const r = await enviarEmail({ ...base, organizacaoId: "org-1" });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("de=geral@andradecosta.pt");
    expect(r.erro).toContain("not verified");
  });
});

/**
 * The log's new half: what happened to the message **after** the provider
 * accepted it.
 *
 * The defect this exists to close was the size of one word: an `enviado` that
 * read as "it arrived". In a test with twenty companies, one of the messages
 * stayed in that state and never reached any mailbox — no server error, and
 * indistinguishable in the listing from the nineteen that arrived.
 */
describe("enviarEmail", () => {
  it("usa Basic auth e o campo Attachments no Mailjet", async () => {
    ambiente = {
      MAILJET_API_KEY: "mj_chave",
      MAILJET_SECRET_KEY: "mj_segredo",
      EMAIL_REMETENTE: "POC@jmassano.pt",
    };
    const espia = espiarFetch(async (url, _opcoes) => {
      if (url.includes("mailjet")) return new Response('{"Messages":[{"To":[{"MessageID":"mj-1"}]}]}', { status: 200 });
      return new Response("{}", { status: 500 });
    });

    await expect(enviarEmail(base)).resolves.toEqual({
      ok: true,
      canal: "mailjet",
      mensagemId: "mj-1",
    });

    const chamada = espia.mock.calls.find(([url]) => String(url).includes("mailjet"));
    expect(chamada).toBeDefined();
    const [url, opcoes] = chamada as [string, RequestInit];
    expect(url).toBe("https://api.mailjet.com/v3.1/send");
    const headers = opcoes.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("mj_chave:mj_segredo").toString("base64")}`,
    );
    const corpo = JSON.parse(opcoes.body as string);
    expect(corpo.Messages[0].From.Email).toBe("POC@jmassano.pt");
    expect(corpo.Messages[0].To[0].Email).toBe("cliente@exemplo.pt");
  });

  it("usa o ContentType e o anexo base64 no Mailjet", async () => {
    ambiente = {
      MAILJET_API_KEY: "mj_chave",
      MAILJET_SECRET_KEY: "mj_segredo",
      EMAIL_REMETENTE: "POC@jmassano.pt",
    };
    const espia = espiarFetch(async (url) => {
      if (url.includes("mailjet")) return new Response('{"Messages":[{"To":[{"MessageID":"mj-2"}]}]}', { status: 200 });
      return new Response("{}", { status: 500 });
    });

    await enviarEmail({ ...base, anexos: [{ nome: "Relatorio.pdf", conteudo: Buffer.from("PDF") }] });

    const chamada = espia.mock.calls.find(([url]) => String(url).includes("mailjet"));
    const corpo = JSON.parse((chamada as [string, RequestInit])[1].body as string);
    expect(corpo.Messages[0].Attachments).toEqual([
      {
        Filename: "Relatorio.pdf",
        ContentType: "application/pdf",
        Base64Content: Buffer.from("PDF").toString("base64"),
      },
    ]);
  });

  it("cai para o Mailjet quando o Resend recusa", async () => {
    ambiente = {
      MAILJET_API_KEY: "mj_chave",
      MAILJET_SECRET_KEY: "mj_segredo",
      RESEND_API_KEY: "re_teste",
      EMAIL_REMETENTE: "POC@jmassano.pt",
    };
    const espia = espiarFetch(async (url) => {
      if (url.includes("resend")) return new Response('{"error":"suspended"}', { status: 401 });
      return new Response('{"Messages":[{"To":[{"MessageID":"mj-3"}]}]}', { status: 200 });
    });

    await expect(enviarEmail(base)).resolves.toEqual({
      ok: true,
      canal: "mailjet",
      mensagemId: "mj-3",
    });
    expect(consolaAviso).toHaveBeenCalledWith(
      expect.stringContaining("Resend failed"),
    );
    expect(espia.mock.calls.some(([url]) => String(url).includes("mailjet"))).toBe(true);
  });

  it("um 429 do Resend põe o canal em pausa e salta-o no envio seguinte", async () => {
    ambiente = {
      MAILJET_API_KEY: "mj_chave",
      MAILJET_SECRET_KEY: "mj_segredo",
      RESEND_API_KEY: "re_teste",
      EMAIL_REMETENTE: "POC@jmassano.pt",
    };
    const espia = espiarFetch(async (url) => {
      if (url.includes("mailjet")) return new Response("boom", { status: 500 });
      // 429 with the word quota — Resend's real response when the day is over.
      return new Response('{"statusCode":429,"message":"You have reached your daily email sending quota."}', { status: 429 });
    });

    // First send: Mailjet 500, Resend 429 (quota exhausted) → error with both reasons.
    const r1 = await enviarEmail(base);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.erro).toContain("429");
    // Second send: Resend is paused — it is not even called; Mailjet is tried again.
    const r2 = await enviarEmail(base);
    expect(r2.ok).toBe(false);

    const chamadasResend = espia.mock.calls.filter(([url]) => String(url).includes("resend"));
    expect(chamadasResend).toHaveLength(1);
    expect(consolaAviso).toHaveBeenCalledWith(
      expect.stringContaining("paused on quota"),
    );
  });

  it("um 500 do Resend não põe o canal em pausa — só o 429 o faz", async () => {
    ambiente = {
      MAILJET_API_KEY: "mj_chave",
      MAILJET_SECRET_KEY: "mj_segredo",
      RESEND_API_KEY: "re_teste",
      EMAIL_REMETENTE: "POC@jmassano.pt",
    };
    const espia = espiarFetch(async (url) => {
      if (url.includes("resend")) return new Response("boom", { status: 500 });
      return new Response('{"Messages":[{"To":[{"MessageID":"mj-4"}]}]}', { status: 200 });
    });

    // First send: Resend 500 (not a quota issue), Mailjet accepts.
    await expect(enviarEmail(base)).resolves.toEqual({ ok: true, canal: "mailjet", mensagemId: "mj-4" });
    // Second send: Resend is tried again (it is not paused).
    await expect(enviarEmail(base)).resolves.toEqual({ ok: true, canal: "mailjet", mensagemId: "mj-4" });

    const chamadasResend = espia.mock.calls.filter(([url]) => String(url).includes("resend"));
    expect(chamadasResend).toHaveLength(2);
  });

  it("usa Bearer auth e lê o x-message-id dos cabeçalhos no Twilio SendGrid", async () => {
    ambiente = {
      TWILIO_SENDGRID_API_KEY: "sg_chave_teste",
      EMAIL_REMETENTE: "POC@jmassano.pt",
    };
    const espia = espiarFetch(async (url, _opcoes) => {
      if (url.includes("sendgrid")) {
        return new Response("", {
          status: 202,
          headers: { "x-message-id": "sg-msg-123" },
        });
      }
      return new Response("{}", { status: 500 });
    });

    await expect(enviarEmail(base)).resolves.toEqual({
      ok: true,
      canal: "twilio_sendgrid",
      mensagemId: "sg-msg-123",
    });

    const chamada = espia.mock.calls.find(([url]) => String(url).includes("sendgrid"));
    expect(chamada).toBeDefined();
    const [url, opcoes] = chamada as [string, RequestInit];
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    const headers = opcoes.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sg_chave_teste");
    const corpo = JSON.parse(opcoes.body as string);
    expect(corpo.from.email).toBe("POC@jmassano.pt");
    expect(corpo.personalizations).toEqual([{ to: [{ email: "cliente@exemplo.pt" }] }]);
    expect(corpo.content).toEqual([{ type: "text/html", value: "<p>olá</p>" }]);
    expect(linhas[0]).toMatchObject({
      estado: "enviado",
      canal: "twilio_sendgrid",
      mensagemId: "sg-msg-123",
    });
  });

  it("formata anexos em base64 no formato do Twilio SendGrid", async () => {
    ambiente = {
      TWILIO_SENDGRID_API_KEY: "sg_chave_teste",
      EMAIL_REMETENTE: "POC@jmassano.pt",
    };
    const espia = espiarFetch(async (url) => {
      if (url.includes("sendgrid")) {
        return new Response("", {
          status: 202,
          headers: { "X-Message-Id": "sg-msg-456" },
        });
      }
      return new Response("{}", { status: 500 });
    });

    await enviarEmail({
      ...base,
      anexos: [{ nome: "Dossier.pdf", conteudo: Buffer.from("PDF_CONTEUDO") }],
    });

    const chamada = espia.mock.calls.find(([url]) => String(url).includes("sendgrid"));
    const corpo = JSON.parse((chamada as [string, RequestInit])[1].body as string);
    expect(corpo.attachments).toEqual([
      {
        filename: "Dossier.pdf",
        content: Buffer.from("PDF_CONTEUDO").toString("base64"),
        type: "application/pdf",
        disposition: "attachment",
      },
    ]);
  });

  it("respeita a ordem da cadeia: Resend -> Mailjet -> Brevo -> Twilio SendGrid", async () => {
    ambiente = {
      RESEND_API_KEY: "re_teste",
      MAILJET_API_KEY: "mj_chave",
      MAILJET_SECRET_KEY: "mj_segredo",
      BREVO_API_KEY: "br_chave",
      TWILIO_SENDGRID_API_KEY: "sg_chave",
      EMAIL_REMETENTE: "POC@jmassano.pt",
    };
    const chamados: string[] = [];
    espiarFetch(async (url) => {
      if (url.includes("resend")) {
        chamados.push("resend");
        return new Response("erro", { status: 500 });
      }
      if (url.includes("mailjet")) {
        chamados.push("mailjet");
        return new Response("erro", { status: 500 });
      }
      if (url.includes("brevo")) {
        chamados.push("brevo");
        return new Response("erro", { status: 500 });
      }
      if (url.includes("sendgrid")) {
        chamados.push("sendgrid");
        return new Response("", { status: 202, headers: { "x-message-id": "sg-ordem" } });
      }
      return new Response("{}", { status: 500 });
    });

    await expect(enviarEmail(base)).resolves.toEqual({
      ok: true,
      canal: "twilio_sendgrid",
      mensagemId: "sg-ordem",
    });

    expect(chamados).toEqual(["resend", "mailjet", "brevo", "sendgrid"]);
  });

  it("devolve os erros acumulados se todos os canais falharem", async () => {
    ambiente = {
      RESEND_API_KEY: "re_teste",
      BREVO_API_KEY: "br_chave",
      TWILIO_SENDGRID_API_KEY: "sg_chave",
      EMAIL_REMETENTE: "POC@jmassano.pt",
    };
    espiarFetch(async (url) => {
      if (url.includes("resend")) return new Response("resend fail", { status: 500 });
      if (url.includes("brevo")) return new Response("brevo fail", { status: 500 });
      if (url.includes("sendgrid")) return new Response("sendgrid fail", { status: 500 });
      return new Response("{}", { status: 500 });
    });

    const r = await enviarEmail(base);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erro).toContain("Resend");
      expect(r.erro).toContain("Brevo");
      expect(r.erro).toContain("Twilio SendGrid");
    }
  });

  it("nomeia a api.sendgrid.com quando o Twilio SendGrid esgota o tempo", async () => {
    ambiente = {
      TWILIO_SENDGRID_API_KEY: "sg_chave",
      EMAIL_REMETENTE: "POC@jmassano.pt",
    };
    espiarFetch(async () => {
      const e = new Error("The operation was aborted due to timeout");
      e.name = "TimeoutError";
      throw e;
    });

    const r = await enviarEmail(base);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erro).toContain("api.sendgrid.com");
    }
    expect(linhas[0]).toMatchObject({ estado: "erro" });
  });

  it("um 429 do Twilio SendGrid põe o canal em pausa e salta-o no envio seguinte", async () => {
    ambiente = {
      TWILIO_SENDGRID_API_KEY: "sg_chave",
      EMAIL_REMETENTE: "POC@jmassano.pt",
    };
    const espia = espiarFetch(async () => {
      return new Response('{"errors":[{"message":"Too many requests (429)"}]}', { status: 429 });
    });

    const r1 = await enviarEmail(base);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.erro).toContain("429");

    const r2 = await enviarEmail(base);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.erro).toContain("em pausa");

    expect(espia).toHaveBeenCalledTimes(1);
    expect(consolaAviso).toHaveBeenCalledWith(
      expect.stringContaining("paused on quota"),
    );
  });

  it("quando o SendGrid aceita mas não devolve x-message-id, mensagemId fica null", async () => {
    ambiente = {
      TWILIO_SENDGRID_API_KEY: "sg_chave",
      EMAIL_REMETENTE: "POC@jmassano.pt",
    };
    espiarFetch(async () => new Response("", { status: 202 }));

    await expect(enviarEmail(base)).resolves.toEqual({
      ok: true,
      canal: "twilio_sendgrid",
      mensagemId: null,
    });

    expect(linhas[0]).toMatchObject({
      estado: "enviado",
      canal: "twilio_sendgrid",
      mensagemId: null,
    });
  });
});

describe("verificarEntrega", () => {
  /** The response of Resend's `GET /emails/{id}`. */
  const resend = (corpo: unknown, status = 200) =>
    espiarFetch(async () => new Response(JSON.stringify(corpo), { status }));

  /** The response of Brevo's `GET /v3/smtp/statistics/events`. */
  const brevo = (eventos: { event: string; reason?: string }[], status = 200) => {
    ambiente = { BREVO_API_KEY: "xkeysib-teste", EMAIL_REMETENTE: "POC@jmassano.pt" };
    return espiarFetch(
      async () => new Response(JSON.stringify({ events: eventos }), { status }),
    );
  };

  it("lê o last_event do Resend com Bearer e o id no caminho", async () => {
    const espia = resend({ last_event: "delivered" });

    await expect(verificarEntrega("resend", "id-123")).resolves.toEqual({
      ok: true,
      evento: "entregue",
    });

    const [url, opcoes] = espia.mock.calls[0] ?? [];
    expect(url).toBe("https://api.resend.com/emails/id-123");
    expect(opcoes?.method).toBe("GET");
    expect((opcoes?.headers as Record<string, string>).Authorization).toBe("Bearer re_teste");
  });

  it("traduz o bounce do Resend e leva o motivo", async () => {
    resend({
      last_event: "bounced",
      bounce: { message: "The recipient's mailbox does not exist", type: "Permanent" },
    });

    await expect(verificarEntrega("resend", "id-123")).resolves.toEqual({
      ok: true,
      evento: "devolvido",
      motivo: "The recipient's mailbox does not exist",
    });
  });

  it("um bounce sem mensagem cai no tipo, e não em silêncio", async () => {
    resend({ last_event: "bounced", bounce: { type: "Permanent", subType: "Suppressed" } });

    const r = await verificarEntrega("resend", "id-123");

    expect(r).toMatchObject({ ok: true, evento: "devolvido", motivo: "Permanent / Suppressed" });
  });

  it("trata a queixa de spam como estado próprio", async () => {
    resend({ last_event: "complained" });

    expect(await verificarEntrega("resend", "id-123")).toMatchObject({
      ok: true,
      evento: "queixa",
    });
  });

  /**
   * `sent`, `queued` and `delivery_delayed` are the provider saying it does not
   * know yet. Calling them a failure would be inventing a fault — and calling
   * them delivery would be repeating the original defect under another name.
   */
  it.each(["sent", "queued", "delivery_delayed", "coisa_nova_do_resend"])(
    "deixa «%s» em pendente, com o nome cru no motivo",
    async (evento) => {
      resend({ last_event: evento });

      expect(await verificarEntrega("resend", "id-123")).toEqual({
        ok: true,
        evento: "pendente",
        motivo: evento,
      });
    },
  );

  it("não inventa um desfecho quando a consulta falha", async () => {
    resend({ message: "not found" }, 404);

    const r = await verificarEntrega("resend", "id-123");

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("404");
    expect(r.erro).toContain("id-123");
  });

  it("sem chave no ambiente, diz que não se confirma em vez de dizer que falhou", async () => {
    ambiente = { EMAIL_REMETENTE: "POC@jmassano.pt" };

    const r = await verificarEntrega("resend", "id-123");

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("RESEND_API_KEY");
  });

  it("não propaga uma exceção do ambiente", async () => {
    ambienteRebenta = new Error("Variáveis de ambiente em falta ou inválidas");

    await expect(verificarEntrega("resend", "id-123")).resolves.toEqual({
      ok: false,
      erro: "Variáveis de ambiente em falta ou inválidas",
    });
  });

  it("consulta o Brevo por messageId, com o header api-key", async () => {
    const espia = brevo([{ event: "delivered" }]);

    await expect(verificarEntrega("brevo", "<1@brevo>")).resolves.toMatchObject({
      ok: true,
      evento: "entregue",
    });

    const [url, opcoes] = espia.mock.calls[0] ?? [];
    expect(url).toContain("api.brevo.com/v3/smtp/statistics/events");
    // A raw `<` or `@` in the URL does not survive the trip.
    expect(url).toContain(`messageId=${encodeURIComponent("<1@brevo>")}`);
    expect((opcoes?.headers as Record<string, string>)["api-key"]).toBe("xkeysib-teste");
  });

  /**
   * Brevo returns a list, and its order is not the order of severity: a message
   * can have `delivered` and, days later, `spam`. Stopping at the first element
   * meant reading the wrong outcome in exactly the cases where it matters.
   */
  it("fica com o evento mais grave da lista do Brevo, não com o primeiro", async () => {
    brevo([
      { event: "requests" },
      { event: "delivered" },
      { event: "hardBounce", reason: "unknown user" },
    ]);

    await expect(verificarEntrega("brevo", "<1@brevo>")).resolves.toEqual({
      ok: true,
      evento: "devolvido",
      motivo: "unknown user",
    });
  });

  it.each(["hardBounce", "softBounce", "bounces", "blocked", "invalid", "error"])(
    "lê «%s» do Brevo como devolvido",
    async (evento) => {
      brevo([{ event: evento }]);

      expect(await verificarEntrega("brevo", "<1@brevo>")).toMatchObject({
        ok: true,
        evento: "devolvido",
      });
    },
  );

  /** Brevo's 404 means "there are no events yet", not "something went wrong". */
  it("trata o 404 do Brevo como pendente", async () => {
    brevo([], 404);

    expect(await verificarEntrega("brevo", "<1@brevo>")).toMatchObject({
      ok: true,
      evento: "pendente",
    });
  });

  it("uma lista vazia do Brevo também é pendente", async () => {
    brevo([]);

    expect(await verificarEntrega("brevo", "<1@brevo>")).toMatchObject({
      ok: true,
      evento: "pendente",
    });
  });

  describe("Twilio SendGrid", () => {
    const sendgrid = (corpo: unknown, status = 200) => {
      ambiente = { TWILIO_SENDGRID_API_KEY: "sg_chave_teste", EMAIL_REMETENTE: "POC@jmassano.pt" };
      return espiarFetch(async () => new Response(JSON.stringify(corpo), { status }));
    };

    it("lê a confirmação de entrega do SendGrid com Bearer e mensagemId no caminho", async () => {
      const espia = sendgrid({ status: "delivered" });

      await expect(verificarEntrega("twilio_sendgrid", "sg-id-1")).resolves.toEqual({
        ok: true,
        evento: "entregue",
      });

      const [url, opcoes] = espia.mock.calls[0] ?? [];
      expect(url).toBe("https://api.sendgrid.com/v3/messages/sg-id-1");
      expect(opcoes?.method).toBe("GET");
      expect((opcoes?.headers as Record<string, string>).Authorization).toBe("Bearer sg_chave_teste");
    });

    it("lê evento delivered da lista de eventos do SendGrid", async () => {
      sendgrid({ events: [{ event_name: "processed" }, { event_name: "delivered" }] });

      await expect(verificarEntrega("twilio_sendgrid", "sg-id-1")).resolves.toEqual({
        ok: true,
        evento: "entregue",
      });
    });

    it("lê bounce e motivo do SendGrid", async () => {
      sendgrid({
        status: "bounce",
        events: [{ event_name: "bounce", reason: "550 User unknown" }],
      });

      await expect(verificarEntrega("twilio_sendgrid", "sg-id-1")).resolves.toEqual({
        ok: true,
        evento: "devolvido",
        motivo: "550 User unknown",
      });
    });

    it("lê spamreport do SendGrid como queixa", async () => {
      sendgrid({ status: "spamreport" });

      await expect(verificarEntrega("twilio_sendgrid", "sg-id-1")).resolves.toMatchObject({
        ok: true,
        evento: "queixa",
      });
    });

    it("trata 404 do SendGrid como pendente", async () => {
      ambiente = { TWILIO_SENDGRID_API_KEY: "sg_chave_teste", EMAIL_REMETENTE: "POC@jmassano.pt" };
      espiarFetch(async () => new Response("Not Found", { status: 404 }));

      await expect(verificarEntrega("twilio_sendgrid", "sg-id-1")).resolves.toMatchObject({
        ok: true,
        evento: "pendente",
      });
    });

    it("lê processing do SendGrid como pendente", async () => {
      sendgrid({ status: "processing" });

      await expect(verificarEntrega("twilio_sendgrid", "sg-id-1")).resolves.toMatchObject({
        ok: true,
        evento: "pendente",
      });
    });

    it("sem TWILIO_SENDGRID_API_KEY no ambiente, avisa que a entrega não se confirma", async () => {
      ambiente = { EMAIL_REMETENTE: "POC@jmassano.pt" };

      const r = await verificarEntrega("twilio_sendgrid", "sg-id-1");

      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.erro).toContain("TWILIO_SENDGRID_API_KEY");
      }
    });

    it("nomeia a api.sendgrid.com no timeout ao verificar entrega", async () => {
      ambiente = { TWILIO_SENDGRID_API_KEY: "sg_chave_teste", EMAIL_REMETENTE: "POC@jmassano.pt" };
      espiarFetch(async () => {
        const e = new Error("The operation was aborted due to timeout");
        e.name = "TimeoutError";
        throw e;
      });

      const r = await verificarEntrega("twilio_sendgrid", "sg-id-1");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.erro).toContain("api.sendgrid.com");
      }
    });
  });
});

describe("confirmarEntrega", () => {
  const alvo = {
    linhaId: "linha-1",
    canal: "resend" as const,
    mensagemId: "id-123",
    para: "cliente@exemplo.pt",
    template: "registo" as const,
    // No waiting: what is being tested is the decision, not the clock.
    esperas: [0],
  };

  it("marca a linha como entregue", async () => {
    espiarFetch(async () => new Response('{"last_event":"delivered"}', { status: 200 }));

    await expect(confirmarEntrega(alvo)).resolves.toBe("entregue");

    expect(atualizacoes).toHaveLength(1);
    expect(atualizacoes[0]).toMatchObject({ estado: "entregue" });
    expect(atualizacoes[0]?.verificadoEm).toBeInstanceOf(Date);
    // An `entregue` cannot erase the reason of an earlier attempt: with no
    // reason, `erro` does not even enter the `set`.
    expect(atualizacoes[0]).not.toHaveProperty("erro");
  });

  it("marca o bounce e guarda o motivo no campo erro", async () => {
    espiarFetch(
      async () =>
        new Response(
          JSON.stringify({ last_event: "bounced", bounce: { message: "mailbox not found" } }),
          { status: 200 },
        ),
    );

    await expect(confirmarEntrega(alvo)).resolves.toBe("devolvido");

    expect(atualizacoes[0]).toMatchObject({
      estado: "devolvido",
      erro: "mailbox not found",
    });
    // And it is stated in the console: a case file without a link is a person
    // waiting.
    expect(consolaErro).toHaveBeenCalledWith(expect.stringContaining("BOUNCED"));
  });

  it("trunca o motivo em 2000 caracteres, como o erro do envio", async () => {
    espiarFetch(
      async () =>
        new Response(
          JSON.stringify({ last_event: "bounced", bounce: { message: "x".repeat(5000) } }),
          { status: 200 },
        ),
    );

    await confirmarEntrega(alvo);

    expect((atualizacoes[0]?.erro as string).length).toBe(2000);
  });

  /**
   * The rule that stops the confirmation from making the diagnosis worse: a
   * lookup that failed says nothing about the message. Marking the row here
   * would be turning a fault of ours into an accusation against the recipient.
   */
  it("não toca na linha quando a consulta ao fornecedor falha", async () => {
    espiarFetch(async () => new Response("indisponível", { status: 500 }));

    await expect(confirmarEntrega(alvo)).resolves.toBe("pendente");

    expect(atualizacoes).toHaveLength(0);
    expect(consolaAviso).toHaveBeenCalledWith(
      expect.stringContaining("could not confirm delivery"),
    );
  });

  it("desiste ao fim das tentativas e deixa a linha em enviado", async () => {
    const espia = espiarFetch(
      async () => new Response('{"last_event":"queued"}', { status: 200 }),
    );

    await expect(confirmarEntrega({ ...alvo, esperas: [0, 0, 0] })).resolves.toBe("pendente");

    expect(espia).toHaveBeenCalledTimes(3);
    expect(atualizacoes).toHaveLength(0);
    expect(consolaAviso).toHaveBeenCalledWith(
      expect.stringContaining("delivery unconfirmed"),
    );
  });

  it("para na primeira resposta conclusiva, sem gastar as restantes", async () => {
    const espia = espiarFetch(
      async () => new Response('{"last_event":"delivered"}', { status: 200 }),
    );

    await confirmarEntrega({ ...alvo, esperas: [0, 0, 0] });

    expect(espia).toHaveBeenCalledTimes(1);
  });

  /**
   * Same rule as `registar`: the email has already gone out, and the log cannot
   * undo it. An exception here surfaced through a detached promise — which in a
   * modern Node brings the whole process down.
   */
  it("não propaga quando a atualização do diário rebenta", async () => {
    espiarFetch(async () => new Response('{"last_event":"delivered"}', { status: 200 }));
    atualizacaoRebenta = true;

    await expect(confirmarEntrega(alvo)).resolves.toBe("entregue");

    expect(consolaErro).toHaveBeenCalledWith(
      expect.stringContaining("FAILED to update email_log"),
      expect.anything(),
    );
  });
});
