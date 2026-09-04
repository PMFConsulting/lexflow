import { NextResponse, type NextRequest } from "next/server";
import { consumir, LOGIN_JANELA_MS, LOGIN_MAX_TENTATIVAS } from "@/lib/limites";

/**
 * Duas coisas antes de a aplicação responder: o anfitrião canónico e o limite
 * de ritmo do início de sessão.
 *
 * **Limite de ritmo.** Sem MFA e sem isto, o login é um dicionário à solta: o
 * `minPasswordLength: 12` (D23) trava força bruta cega, não listas de
 * palavras-passe reutilizadas. Por IP e não por
 * conta — por email dava a qualquer um um botão para trancar a conta de
 * outra pessoa. Os números estão em `lib/limites.ts`, partilhados com a
 * configuração do Better Auth: dois limitadores com números diferentes no
 * mesmo caminho recusam sem que nenhum dos dois o explique.
 *
 * Balde em memória (`lib/limites.ts`): reinício zera, várias instâncias não
 * partilham contagem. Suficiente para a POC.
 *
 * Não lê o corpo do pedido — consumir o body aqui deixava a rota de
 * autenticação sem credenciais. Conta-se todo pedido de login, não só os
 * falhados.
 */

/** O caminho que o limite de ritmo cobre — e só ele (ver `config.matcher`). */
const CAMINHO_DE_ENTRADA = "/api/auth/sign-in";

/**
 * IP de quem faz o pedido. `x-forwarded-for` vem do proxy do Coolify —
 * falsificável por quem fale direto com o contentor, por isso isto é uma
 * camada e não a defesa.
 */
function origemDoPedido(pedido: NextRequest): string {
  const encaminhado = pedido.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return encaminhado || pedido.headers.get("x-real-ip")?.trim() || "desconhecido";
}

/**
 * Anfitrião canónico: `www.` não é um segundo endereço, é um desvio para o
 * primeiro.
 *
 * O `www.lex-flow.pt` servia a aplicação — o proxy encaminha os dois nomes
 * para o mesmo contentor — mas o `BETTER_AUTH_URL` é o apex, e o Better Auth
 * compara a origem do pedido com ele: o `POST /api/auth/sign-in/email` vindo
 * do `www` levava `403 INVALID_ORIGIN`, e o ecrã de entrada traduzia isso
 * para «credenciais inválidas». Palavra-passe certa, erro de palavra-passe
 * errada, e ninguém que aterrasse no `www` entrava — a segunda causa da
 * intermitência do login, a seguir ao limite de ritmo.
 *
 * A alternativa era acrescentar o `www` a `trustedOrigins`, e isso deixava
 * duas origens a sério: dois domínios de cookie para a mesma sessão (entrar
 * num e navegar no outro é sair) e o `lib/origem.ts`, que só aceita o
 * anfitrião configurado, a recusar montar links para quem viesse do `www`.
 * Redirecionar deixa **uma** origem — a que já está em `BETTER_AUTH_URL` — e
 * resolve o login, os cookies e os links de uma só vez.
 *
 * Fica aqui e não na configuração do proxy de propósito: assim viaja com o
 * código, é revisto com ele, e não depende de um painel cujo estado não
 * aparece em nenhum `git log`.
 */
function desvioParaOApex(pedido: NextRequest): URL | null {
  // O `host` do pedido; atrás do proxy o nome que o browser usou pode vir só
  // no `x-forwarded-host`. Aqui isso não é um risco como em `lib/origem.ts`:
  // o destino não sai do cabeçalho, tira-se-lhe o `www.` e mais nada — quem
  // forjar o cabeçalho só se redireciona a si próprio.
  const anfitriao = (pedido.headers.get("x-forwarded-host") ?? pedido.headers.get("host") ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();

  if (!anfitriao.startsWith("www.")) return null;

  // `hostname` e `port` em separado, e não `host`: atrás do proxy o pedido
  // chega a `interno:3000`, e o setter de `host` só substitui a porta quando o
  // valor novo traz uma — o desvio saía com o porto interno colado ao domínio
  // público.
  const [nome, porta] = anfitriao.slice("www.".length).split(":");

  const destino = new URL(pedido.nextUrl);
  // Um anfitrião `www.` é sempre um domínio público servido por TLS, e o
  // esquema que chega ao contentor é o `http` de dentro do proxy. Reenviar
  // para `http://` era um salto a mais e uma janela sem cifra.
  destino.protocol = "https:";
  destino.hostname = nome;
  destino.port = porta ?? "";
  return destino;
}

export function middleware(pedido: NextRequest) {
  // Antes de tudo o resto, e para todos os métodos: o que segue conta com
  // estar na origem certa.
  const apex = desvioParaOApex(pedido);
  if (apex) return NextResponse.redirect(apex, 308);

  // O `matcher` deixa passar a aplicação inteira por causa do desvio acima,
  // por isso o limite de ritmo escolhe aqui o que conta: o POST do início de
  // sessão, e não todas as Server Actions — que também são POST.
  if (pedido.method !== "POST" || !pedido.nextUrl.pathname.startsWith(CAMINHO_DE_ENTRADA)) {
    return NextResponse.next();
  }

  const veredicto = consumir(`entrar:${origemDoPedido(pedido)}`, LOGIN_MAX_TENTATIVAS, LOGIN_JANELA_MS);

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
   * O desvio de anfitrião tem de ver as navegações todas — se só cobrisse o
   * início de sessão, quem abrisse `www.lex-flow.pt` continuava a navegar no
   * anfitrião errado até tentar entrar. Ficam de fora os estáticos, que não
   * navegam: pedi-los pelo `www` resolve na mesma e um desvio aí só somava
   * saltos.
   *
   * O caminho do início de sessão está aqui dentro; quem separa as duas
   * regras é a função, não o filtro.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
