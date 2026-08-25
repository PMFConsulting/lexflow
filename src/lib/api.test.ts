import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { limparLimites } from "./limites";
import { autorizar, corpoJson, respostaPasso } from "./api";

const CHAVE = "uma-chave-de-api-com-pelo-menos-32-caracteres";

function pedido(cabecalhos: Record<string, string> = {}, corpo?: string) {
  return new Request("https://exemplo.pt/api/onboarding/cliente/abc", {
    method: "POST",
    headers: cabecalhos,
    body: corpo,
  });
}

describe("autorizar", () => {
  beforeEach(() => {
    limparLimites();
    process.env.API_CHAVE = CHAVE;
  });

  afterEach(() => {
    delete process.env.API_CHAVE;
    limparLimites();
  });

  it("aceita a chave certa", () => {
    const r = autorizar(pedido({ authorization: `Bearer ${CHAVE}` }));
    expect(r.ok).toBe(true);
  });

  it("recusa a chave errada com 401", async () => {
    const r = autorizar(pedido({ authorization: "Bearer outra-coisa-qualquer-mesmo-longa" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.resposta.status).toBe(401);
  });

  it("recusa sem header nenhum", async () => {
    const r = autorizar(pedido());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.resposta.status).toBe(401);
  });

  it("recusa um header sem o esquema Bearer", async () => {
    const r = autorizar(pedido({ authorization: CHAVE }));
    expect(r.ok).toBe(false);
  });

  it("sem API_CHAVE a API fecha, e não abre", async () => {
    // O ponto desta regra: um recuo permissivo aqui seria a instalação que
    // esqueceu a variável a servir dados de KYC a quem os peça. 503 e não 401
    // porque o problema é do servidor e não de quem chama.
    delete process.env.API_CHAVE;
    const r = autorizar(pedido({ authorization: `Bearer ${CHAVE}` }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.resposta.status).toBe(503);
  });

  it("o identificador do chamador não é a chave", () => {
    // Ele entra em linhas de log e em chaves do limitador, e nenhum desses
    // sítios é lugar para um segredo.
    const r = autorizar(pedido({ authorization: `Bearer ${CHAVE}` }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.chamador).toBe(CHAVE.slice(0, 8));
    expect(CHAVE.startsWith(r.chamador)).toBe(true);
    expect(r.chamador.length).toBeLessThan(CHAVE.length);
  });

  it("aplica limite de ritmo ao fim de 60 pedidos", async () => {
    for (let i = 0; i < 60; i++) {
      expect(autorizar(pedido({ authorization: `Bearer ${CHAVE}` })).ok).toBe(true);
    }
    const r = autorizar(pedido({ authorization: `Bearer ${CHAVE}` }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.resposta.status).toBe(429);
    expect(r.resposta.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("corpoJson", () => {
  it("aceita um objeto", async () => {
    const r = await corpoJson(
      pedido({ "content-type": "application/json" }, JSON.stringify({ nome: "Ana" })),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dados).toEqual({ nome: "Ana" });
  });

  it("recusa JSON inválido com 400 e não com 500", async () => {
    // A diferença entre «o teu JSON tem uma vírgula a mais» e «o servidor
    // rebentou» é a diferença entre um bot que se corrige e um que abre um
    // ticket.
    const r = await corpoJson(pedido({ "content-type": "application/json" }, "{nao json"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.resposta.status).toBe(400);
  });

  it("recusa um corpo que não é objeto", async () => {
    const r = await corpoJson(pedido({ "content-type": "application/json" }, '"uma string"'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.resposta.status).toBe(400);
  });
});

describe("respostaPasso", () => {
  it("um passo gravado vem 200 com o próximo", async () => {
    const r = respostaPasso({ ok: true, proximo: 3 });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, proximo: 3 });
  });

  it("uma regra que falha vem 422, e não 400", async () => {
    // 422 e não 400: o corpo era JSON válido e chegou inteiro. Um bot que
    // distinga os dois sabe que num caso reformula e no outro pergunta à pessoa.
    const r = respostaPasso({ ok: false, erros: { nif: ["O NIF não é válido."] } });
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({
      ok: false,
      erros: { nif: ["O NIF não é válido."] },
      mensagem: null,
    });
  });
});
