import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O canal de email, do lado em que ele falha.
 *
 * O que estes testes fixam é sempre a mesma regra: **uma tentativa de envio
 * produz sempre uma linha em `email_log` e nunca propaga uma exceção a quem
 * chamou**. Enquanto assim não foi, "o cliente não recebeu nada" e "nem sequer
 * se tentou" liam-se os dois como `/emails` a dizer «0 mensagens» — e não há
 * como investigar uma diferença que o sistema não regista.
 */

const linhas: Record<string, unknown>[] = [];
/** Uma entrada por `update` ao diário — o que `confirmarEntrega` lá escreveu. */
const atualizacoes: Record<string, unknown>[] = [];
let gravacaoRebenta = false;
let atualizacaoRebenta = false;
let ambiente: Record<string, unknown> = {};
let ambienteRebenta: Error | null = null;

vi.mock("@/env", () => ({
  env: () => {
    if (ambienteRebenta) throw ambienteRebenta;
    return ambiente;
  },
}));

vi.mock("@/db/schema/email", () => ({ emailLog: "email_log" }));

vi.mock("@/db", () => ({
  db: () => ({
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
 * Importação dinâmica e não estática: as fábricas dos `vi.mock` fecham sobre as
 * variáveis declaradas acima, e uma importação estática corre antes delas.
 */
const { confirmarEntrega, enviarEmail, limparPausasDeQuota, verificarEntrega } = await import("./email");

const base = {
  para: "cliente@exemplo.pt",
  assunto: "JMASSANO | Registro",
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
  ambiente = { RESEND_API_KEY: "re_teste", EMAIL_REMETENTE: "POC@jmassano.pt" };
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  consolaAviso = vi.spyOn(console, "warn").mockImplementation(() => {});
  consolaErro = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // A pausa de quota vive no módulo e atravessa os testes — um 429 num teste
  // não pode condicionar os que vêm a seguir.
  limparPausasDeQuota();
});

/** Um `fetch` com a assinatura do verdadeiro, para o `signal` ser inspecionável. */
const espiarFetch = (impl: (url: string, opcoes?: RequestInit) => Promise<Response>) => {
  const espia = vi.fn(impl);
  vi.stubGlobal("fetch", espia);
  return espia;
};

/** Uma resposta do Resend, sem rede pelo meio. */
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
      // Aceite, não entregue. O que confirma a entrega é o `confirmarEntrega`,
      // minutos depois — e sem o `mensagem_id` não haveria a quem perguntar.
      estado: "enviado",
      erro: null,
      canal: "resend",
      mensagemId: "abc",
    });
  });

  /**
   * O envio não pode ficar à espera da entrega. Se ficasse, a criação de um
   * processo passava a demorar os minutos que o servidor de destino demorasse
   * a decidir — e o utilizador via o botão em "A criar…" durante esse tempo.
   */
  it("devolve o resultado sem esperar pela confirmação de entrega", async () => {
    const espia = espiarFetch(async () => new Response('{"id":"abc"}', { status: 200 }));

    await enviarEmail(base);

    // Um pedido só: o POST do envio. A consulta de entrega vem depois, solta.
    expect(espia).toHaveBeenCalledTimes(1);
    expect(espia.mock.calls[0]?.[1]?.method).toBe("POST");
  });

  /**
   * Um fornecedor que aceita sem devolver id deixa uma mensagem que nunca vai
   * poder ser confirmada. Fica em `enviado` para sempre — e isso tem de ser
   * dito, senão lê-se como "ainda a caminho".
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
      expect.stringContaining("não vai poder ser confirmada"),
    );
  });

  it("sem chave nenhuma devolve o motivo e grava na mesma", async () => {
    ambiente = { EMAIL_REMETENTE: "POC@jmassano.pt" };

    const r = await enviarEmail(base);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    // As duas variáveis no motivo, e não só uma: quem lê isto no `/emails` tem
    // de saber que há dois sítios possíveis onde a configurar.
    expect(r.erro).toContain("BREVO_API_KEY");
    expect(r.erro).toContain("RESEND_API_KEY");
    expect(linhas[0]).toMatchObject({ estado: "erro" });
  });

  /**
   * O Brevo tem prioridade por ter mais folga no plano gratuito, mas ser o
   * primeiro não é ser o único: uma conta suspensa ou um remetente por
   * verificar num dos fornecedores não pode deixar o cliente sem o link.
   */
  it("cai para o Resend quando o Brevo recusa", async () => {
    ambiente = {
      BREVO_API_KEY: "xkeysib-teste",
      RESEND_API_KEY: "re_teste",
      EMAIL_REMETENTE: "POC@jmassano.pt",
    };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const espia = espiarFetch(async (url) =>
      url.includes("brevo")
        ? new Response('{"message":"account suspended"}', { status: 401 })
        : new Response('{"id":"abc"}', { status: 200 }),
    );

    await expect(enviarEmail(base)).resolves.toEqual({
      ok: true,
      canal: "resend",
      mensagemId: "abc",
    });

    expect(espia.mock.calls[0]?.[0]).toContain("api.brevo.com");
    expect(espia.mock.calls[1]?.[0]).toContain("api.resend.com");
    // O canal gravado é o que **aceitou**, não o que se tentou primeiro: é a
    // ele que se vai perguntar pelo desfecho, e o id do Brevo não existe lá.
    expect(linhas[0]).toMatchObject({ estado: "enviado", canal: "resend" });
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
   * O caso que se paga mais caro em produção: a chave está lá, o envio é
   * tentado, e o Resend recusa porque o domínio do remetente não está
   * verificado na conta. Sem o remetente na mensagem, o 403 não diz o que
   * corrigir — e `POC@jmassano.pt` é um valor por omissão que ninguém escreveu
   * e de que, por isso mesmo, ninguém desconfia.
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

    // Sem `signal`, uma saída para a Internet fechada deixava a Server Action
    // que criou o processo à espera para sempre — sem link e sem erro.
    expect(espia.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  /**
   * A regressão que este ficheiro existe para impedir. O `tentarEnviar` lê o
   * ambiente *antes* do seu próprio `try`, e o `env()` lança quando falta uma
   * variável: essa exceção saltava por cima da gravação **e** propagava-se a
   * quem chamou — que é como um email falhado se transformava em criação de
   * processo falhada, sem uma linha em lado nenhum a explicá-lo.
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

    // O envio já aconteceu; falhar aqui seria trocar o essencial pelo registo.
    await expect(enviarEmail(base)).resolves.toEqual({
      ok: true,
      canal: "resend",
      mensagemId: null,
    });

    // E a consola tem de o gritar: é o único sinal que sobra de que o `/emails`
    // está a mostrar menos mensagens do que as que foram tentadas.
    expect(consolaErro).toHaveBeenCalledWith(
      expect.stringContaining("FALHOU a gravação em email_log"),
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
 * A metade nova do diário: o que aconteceu à mensagem **depois** de o
 * fornecedor a ter aceite.
 *
 * O defeito que isto existe para fechar tinha o tamanho de uma palavra: um
 * `enviado` que se lia como "chegou". Num teste de vinte empresas, uma das
 * mensagens ficou nesse estado e nunca chegou a caixa nenhuma — sem erro no
 * servidor, e indistinguível na listagem das dezanove que chegaram.
 */
describe("enviarEmail", () => {
  it("usa Basic auth e o campo Attachments no Mailjet", async () => {
    ambiente = {
      MAILJET_API_KEY: "mj_chave",
      MAILJET_SECRET_KEY: "mj_segredo",
      EMAIL_REMETENTE: "POC@jmassano.pt",
    };
    const espia = espiarFetch(async (url, opcoes) => {
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

  it("cai para o Resend quando o Mailjet recusa", async () => {
    ambiente = {
      MAILJET_API_KEY: "mj_chave",
      MAILJET_SECRET_KEY: "mj_segredo",
      RESEND_API_KEY: "re_teste",
      EMAIL_REMETENTE: "POC@jmassano.pt",
    };
    const espia = espiarFetch(async (url) => {
      if (url.includes("mailjet")) return new Response('{"error":"suspended"}', { status: 401 });
      return new Response('{"id":"re-1"}', { status: 200 });
    });

    await expect(enviarEmail(base)).resolves.toEqual({
      ok: true,
      canal: "resend",
      mensagemId: "re-1",
    });
    expect(consolaAviso).toHaveBeenCalledWith(
      expect.stringContaining("Mailjet falhou"),
    );
    expect(espia.mock.calls.some(([url]) => String(url).includes("resend"))).toBe(true);
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
      // 429 com a palavra quota — a resposta real do Resend quando o dia acabou.
      return new Response('{"statusCode":429,"message":"You have reached your daily email sending quota."}', { status: 429 });
    });

    // Primeiro envio: Mailjet 500, Resend 429 (quota esgotada) → erro com os dois motivos.
    const r1 = await enviarEmail(base);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.erro).toContain("429");
    // Segundo envio: o Resend está em pausa — nem é chamado; o Mailjet é tentado outra vez.
    const r2 = await enviarEmail(base);
    expect(r2.ok).toBe(false);

    const chamadasResend = espia.mock.calls.filter(([url]) => String(url).includes("resend"));
    expect(chamadasResend).toHaveLength(1);
    expect(consolaAviso).toHaveBeenCalledWith(
      expect.stringContaining("em pausa por quota"),
    );
  });

  it("um 500 do Mailjet não põe o canal em pausa — só o 429 o faz", async () => {
    ambiente = {
      MAILJET_API_KEY: "mj_chave",
      MAILJET_SECRET_KEY: "mj_segredo",
      RESEND_API_KEY: "re_teste",
      EMAIL_REMETENTE: "POC@jmassano.pt",
    };
    const espia = espiarFetch(async (url) => {
      if (url.includes("mailjet")) return new Response("boom", { status: 500 });
      return new Response('{"id":"re-2"}', { status: 200 });
    });

    // Primeiro envio: Mailjet 500 (não é quota), Resend aceita.
    await expect(enviarEmail(base)).resolves.toEqual({ ok: true, canal: "resend", mensagemId: "re-2" });
    // Segundo envio: o Mailjet é tentado outra vez (não está em pausa).
    await expect(enviarEmail(base)).resolves.toEqual({ ok: true, canal: "resend", mensagemId: "re-2" });

    const chamadasMailjet = espia.mock.calls.filter(([url]) => String(url).includes("mailjet"));
    expect(chamadasMailjet).toHaveLength(2);
  });
});

describe("verificarEntrega", () => {
  /** A resposta do `GET /emails/{id}` do Resend. */
  const resend = (corpo: unknown, status = 200) =>
    espiarFetch(async () => new Response(JSON.stringify(corpo), { status }));

  /** A resposta do `GET /v3/smtp/statistics/events` do Brevo. */
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
   * `sent`, `queued` e `delivery_delayed` são o fornecedor a dizer que ainda
   * não sabe. Chamar-lhes falha seria inventar uma avaria — e chamar-lhes
   * entrega seria repetir o defeito de origem com outro nome.
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
    // Um `<` ou um `@` em cru no URL não sobrevive à viagem.
    expect(url).toContain(`messageId=${encodeURIComponent("<1@brevo>")}`);
    expect((opcoes?.headers as Record<string, string>)["api-key"]).toBe("xkeysib-teste");
  });

  /**
   * O Brevo devolve uma lista, e a ordem dela não é a de gravidade: uma
   * mensagem pode ter `delivered` e, dias depois, `spam`. Ficar-se pelo
   * primeiro elemento era ler o desfecho errado nos casos em que ele importa.
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

  /** O 404 do Brevo quer dizer "ainda não há eventos", não "correu mal". */
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
});

describe("confirmarEntrega", () => {
  const alvo = {
    linhaId: "linha-1",
    canal: "resend" as const,
    mensagemId: "id-123",
    para: "cliente@exemplo.pt",
    template: "registo" as const,
    // Sem espera: o que se está a testar é a decisão, não o relógio.
    esperas: [0],
  };

  it("marca a linha como entregue", async () => {
    espiarFetch(async () => new Response('{"last_event":"delivered"}', { status: 200 }));

    await expect(confirmarEntrega(alvo)).resolves.toBe("entregue");

    expect(atualizacoes).toHaveLength(1);
    expect(atualizacoes[0]).toMatchObject({ estado: "entregue" });
    expect(atualizacoes[0]?.verificadoEm).toBeInstanceOf(Date);
    // Um `entregue` não pode apagar a razão de uma tentativa anterior: sem
    // motivo, o `erro` nem sequer entra no `set`.
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
    // E fica dito na consola: um dossier sem link é uma pessoa à espera.
    expect(consolaErro).toHaveBeenCalledWith(expect.stringContaining("DEVOLVIDO"));
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
   * A regra que impede a confirmação de piorar o diagnóstico: uma consulta que
   * falhou não diz nada sobre a mensagem. Marcar a linha aqui era transformar
   * uma avaria nossa numa acusação ao destinatário.
   */
  it("não toca na linha quando a consulta ao fornecedor falha", async () => {
    espiarFetch(async () => new Response("indisponível", { status: 500 }));

    await expect(confirmarEntrega(alvo)).resolves.toBe("pendente");

    expect(atualizacoes).toHaveLength(0);
    expect(consolaAviso).toHaveBeenCalledWith(
      expect.stringContaining("não se conseguiu confirmar a entrega"),
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
      expect.stringContaining("entrega por confirmar"),
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
   * Mesma regra do `registar`: o email já saiu, e o diário não o pode desfazer.
   * Uma exceção aqui subia por uma promessa solta — que num Node moderno
   * derruba o processo inteiro.
   */
  it("não propaga quando a atualização do diário rebenta", async () => {
    espiarFetch(async () => new Response('{"last_event":"delivered"}', { status: 200 }));
    atualizacaoRebenta = true;

    await expect(confirmarEntrega(alvo)).resolves.toBe("entregue");

    expect(consolaErro).toHaveBeenCalledWith(
      expect.stringContaining("FALHOU a atualização de email_log"),
      expect.anything(),
    );
  });
});
