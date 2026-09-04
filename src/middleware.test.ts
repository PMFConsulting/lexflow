import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { middleware } from "./middleware";
import { limparLimites, LOGIN_MAX_TENTATIVAS } from "@/lib/limites";

/**
 * O `middleware` faz duas coisas, e cada uma delas partiu o login à sua
 * maneira:
 *
 * · **O anfitrião canónico.** `www.lex-flow.pt` servia a aplicação e o Better
 *   Auth recusava-lhe o `sign-in` com `403 INVALID_ORIGIN`, porque a origem
 *   configurada é o apex. O ecrã dizia «credenciais inválidas» a quem as
 *   tinha certas.
 *
 * · **O limite de ritmo.** Deixou de viver no `matcher` — que agora tem de
 *   ser largo para o desvio acima ver as navegações todas — e passou a
 *   escolher o caminho dentro da função. Se essa escolha se perder, todas as
 *   Server Actions da aplicação (POST, como o login) passam a gastar o balde
 *   do início de sessão, e o utilizador é atirado para fora a meio do
 *   trabalho.
 */

function pedido(
  url: string,
  { metodo = "GET", cabecalhos = {} }: { metodo?: string; cabecalhos?: Record<string, string> } = {},
) {
  return new NextRequest(url, {
    method: metodo,
    headers: { host: new URL(url).host, ...cabecalhos },
  });
}

beforeEach(() => {
  limparLimites();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("desvio de www para o anfitrião canónico", () => {
  it("um pedido ao www é reenviado para o apex com o caminho e a query intactos", () => {
    const resposta = middleware(pedido("https://www.lex-flow.pt/entrar?de=%2Fprocessos"));

    expect(resposta.status).toBe(308);
    expect(resposta.headers.get("location")).toBe("https://lex-flow.pt/entrar?de=%2Fprocessos");
  });

  it("o apex passa sem desvio nenhum", () => {
    const resposta = middleware(pedido("https://lex-flow.pt/entrar"));

    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("location")).toBeNull();
  });

  /**
   * O POST do início de sessão é o pedido que motivou tudo isto: vindo do
   * `www` tem de sair de lá antes de chegar ao Better Auth, senão volta o 403.
   */
  it("o POST do início de sessão vindo do www também é reenviado", () => {
    const resposta = middleware(
      pedido("https://www.lex-flow.pt/api/auth/sign-in/email", { metodo: "POST" }),
    );

    expect(resposta.status).toBe(308);
    expect(resposta.headers.get("location")).toBe("https://lex-flow.pt/api/auth/sign-in/email");
  });

  it("atrás do proxy, o nome que o browser usou vem no x-forwarded-host e conta", () => {
    const resposta = middleware(
      pedido("http://interno:3000/processos", {
        cabecalhos: { "x-forwarded-host": "www.lex-flow.pt" },
      }),
    );

    // O esquema do destino é `https` e não o `http` de dentro do proxy: um
    // anfitrião `www.` é sempre público.
    expect(resposta.headers.get("location")).toBe("https://lex-flow.pt/processos");
  });

  it("um anfitrião que só começa por «www» sem ser subdomínio não é tocado", () => {
    const resposta = middleware(pedido("https://wwwlex-flow.pt/entrar"));

    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("location")).toBeNull();
  });
});

describe("limite de ritmo, com o matcher largo", () => {
  const entrar = (ip: string) =>
    middleware(
      pedido("https://lex-flow.pt/api/auth/sign-in/email", {
        metodo: "POST",
        cabecalhos: { "x-forwarded-for": ip },
      }),
    );

  it("continua a recusar acima do limite, no caminho do início de sessão", () => {
    for (let i = 0; i < LOGIN_MAX_TENTATIVAS; i++) {
      expect(entrar("10.0.0.1").status).toBe(200);
    }

    const recusada = entrar("10.0.0.1");
    expect(recusada.status).toBe(429);
    expect(recusada.headers.get("Retry-After")).toBeTruthy();
  });

  /**
   * Uma Server Action é um POST na página onde está. Enquanto o `matcher` só
   * via o `sign-in` isto era impossível; agora que vê a aplicação toda, é o
   * defeito mais fácil de introduzir aqui.
   */
  it("um POST fora do início de sessão não gasta o balde", () => {
    for (let i = 0; i < LOGIN_MAX_TENTATIVAS + 50; i++) {
      const resposta = middleware(
        pedido("https://lex-flow.pt/processos", {
          metodo: "POST",
          cabecalhos: { "x-forwarded-for": "10.0.0.2" },
        }),
      );
      expect(resposta.status).toBe(200);
    }

    expect(entrar("10.0.0.2").status).toBe(200);
  });

  it("um GET no caminho do início de sessão não conta como tentativa", () => {
    for (let i = 0; i < LOGIN_MAX_TENTATIVAS + 10; i++) {
      middleware(
        pedido("https://lex-flow.pt/api/auth/sign-in/email", {
          cabecalhos: { "x-forwarded-for": "10.0.0.3" },
        }),
      );
    }

    expect(entrar("10.0.0.3").status).toBe(200);
  });
});
