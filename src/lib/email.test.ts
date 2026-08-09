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
let gravacaoRebenta = false;
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
  }),
}));

/**
 * Importação dinâmica e não estática: as fábricas dos `vi.mock` fecham sobre as
 * variáveis declaradas acima, e uma importação estática corre antes delas.
 */
const { enviarEmail } = await import("./email");

const base = {
  para: "cliente@exemplo.pt",
  assunto: "JMASSANO | Registro",
  html: "<p>olá</p>",
  template: "registo" as const,
};

let consolaErro: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  linhas.length = 0;
  gravacaoRebenta = false;
  ambienteRebenta = null;
  ambiente = { RESEND_API_KEY: "re_teste", EMAIL_REMETENTE: "POC@jmassano.pt" };
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  consolaErro = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
  it("grava a linha de sucesso quando o Resend aceita", async () => {
    responde(200, '{"id":"abc"}');

    await expect(enviarEmail(base)).resolves.toEqual({ ok: true });

    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      para: "cliente@exemplo.pt",
      template: "registo",
      estado: "enviado",
      erro: null,
    });
  });

  it("sem RESEND_API_KEY devolve o motivo e grava na mesma", async () => {
    ambiente = { EMAIL_REMETENTE: "POC@jmassano.pt" };

    const r = await enviarEmail(base);

    expect(r).toEqual({ ok: false, erro: "RESEND_API_KEY não configurada" });
    expect(linhas[0]).toMatchObject({ estado: "erro", erro: "RESEND_API_KEY não configurada" });
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
    await expect(enviarEmail(base)).resolves.toEqual({ ok: true });

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
