import { NextResponse, type NextRequest } from "next/server";
import { consumir } from "@/lib/limites";

/**
 * Limite de ritmo no início de sessão.
 *
 * Sem MFA e sem isto, o login é um dicionário à solta: o
 * `minPasswordLength: 12` (D23) trava força bruta cega, não listas de
 * palavras-passe reutilizadas. 10 tentativas / 15 min, por IP e não por
 * conta — por email dava a qualquer um um botão para trancar a conta de
 * outra pessoa.
 *
 * Balde em memória (`lib/limites.ts`): reinício zera, várias instâncias não
 * partilham contagem. Suficiente para a POC.
 *
 * Não lê o corpo do pedido — consumir o body aqui deixava a rota de
 * autenticação sem credenciais. Conta-se todo pedido de login, não só os
 * falhados.
 */

/** Tentativas por IP dentro da janela. Generoso para não travar testes reais (POC). */
const MAX_TENTATIVAS = 200;

/** A janela, em milissegundos. */
const JANELA_MS = 15 * 60_000;

/**
 * IP de quem faz o pedido. `x-forwarded-for` vem do proxy do Coolify —
 * falsificável por quem fale direto com o contentor, por isso isto é uma
 * camada e não a defesa.
 */
function origemDoPedido(pedido: NextRequest): string {
  const encaminhado = pedido.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return encaminhado || pedido.headers.get("x-real-ip")?.trim() || "desconhecido";
}

export function middleware(pedido: NextRequest) {
  // Só o POST interessa — o Better Auth serve estas rotas por POST.
  if (pedido.method !== "POST") return NextResponse.next();

  const veredicto = consumir(`entrar:${origemDoPedido(pedido)}`, MAX_TENTATIVAS, JANELA_MS);

  if (!veredicto.permitido) {
    console.warn(
      `[entrar] limite de tentativas excedido para ${origemDoPedido(pedido)} — 429 durante ${veredicto.esperarSegundos}s`,
    );
    return NextResponse.json(
      {
        message: `Demasiadas tentativas de início de sessão. Aguarde ${Math.ceil(veredicto.esperarSegundos / 60)} minutos e tente de novo.`,
        code: "DEMASIADAS_TENTATIVAS",
      },
      {
        status: 429,
        headers: { "Retry-After": String(veredicto.esperarSegundos) },
      },
    );
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Só o início de sessão — a sessão já é exigida em cada página
   * (`exigirSessao`); um filtro largo aqui seria latência para proteger um
   * único endpoint.
   */
  matcher: ["/api/auth/sign-in/:path*"],
};
