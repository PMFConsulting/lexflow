import { NextResponse, type NextRequest } from "next/server";
import { consumir } from "@/lib/limites";

/**
 * Limite de ritmo no início de sessão.
 *
 * O back-office tem email e palavra-passe, `disableSignUp: true` (D23) e nada
 * mais — sem MFA, que ficou fora do corte da POC. Sem limite de tentativas,
 * isso é um formulário aberto a um dicionário: o `minPasswordLength: 12` torna
 * a força bruta cega impraticável, mas não faz nada contra as listas de
 * palavras-passe reutilizadas, que é como as contas caem de facto. Dez
 * tentativas em quinze minutos não incomodam quem se engana a escrever e
 * tiram ao ataque a única coisa de que ele precisa: repetição barata.
 *
 * **Conta-se por IP e não por conta.** Contar por email era dar a qualquer um
 * um botão para trancar a conta de outra pessoa — basta martelar o endereço
 * dela até ao limite, e quem fica de fora é o dono. Contar por IP tem o defeito
 * simétrico (um escritório inteiro sai por um IP só), e é por isso que o limite
 * é generoso e a janela é curta: quinze minutos e volta ao normal, sem ninguém
 * ter de desbloquear nada.
 *
 * **O que isto não é.** O balde vive na memória do processo (`lib/limites.ts`):
 * um reinício do contentor zera-o, e duas instâncias contam cada uma por si. É
 * o mínimo viável que a POC pede, e é o ficheiro certo para mudar de
 * implementação no dia em que houver mais do que uma instância — nem o
 * middleware nem o Better Auth precisam de saber.
 *
 * Não se lê o corpo do pedido. Consumir o `body` no middleware é ficar com ele
 * para si: o pedido seguiria para a rota de autenticação sem as credenciais, e
 * o login passava a falhar sempre. O preço é contar todos os pedidos de
 * início de sessão e não só os que falham — o que, com dez por quarto de hora,
 * não afeta ninguém a usar a aplicação a sério.
 */

/** Tentativas por IP dentro da janela. */
const MAX_TENTATIVAS = 10;

/** A janela, em milissegundos. */
const JANELA_MS = 15 * 60_000;

/**
 * O IP de quem faz o pedido.
 *
 * `x-forwarded-for` é escrito pelo proxy do Coolify e é a única fonte que aqui
 * há. É falsificável por quem fale diretamente com o contentor — e é por isso
 * que este limite é uma camada e não a defesa: o que ele apanha é o ataque
 * comum, que vem pela porta da frente e não se dá ao trabalho.
 */
function origemDoPedido(pedido: NextRequest): string {
  const encaminhado = pedido.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return encaminhado || pedido.headers.get("x-real-ip")?.trim() || "desconhecido";
}

export function middleware(pedido: NextRequest) {
  // Só o POST interessa: o Better Auth serve estas rotas por POST, e um GET
  // aqui não é uma tentativa de nada.
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
   * Só o início de sessão. Não vale a pena o middleware correr sobre as páginas
   * — a sessão já é exigida em cada uma delas (`exigirSessao`) e um filtro
   * largo aqui é latência em todos os pedidos para proteger um endpoint.
   */
  matcher: ["/api/auth/sign-in/:path*"],
};
