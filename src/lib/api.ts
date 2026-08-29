import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { consumir } from "@/lib/limites";

/**
 * Superfície HTTP dos onboardings, para um bot a poder percorrer.
 *
 * A API não tem lógica própria (D62): cada rota chama a mesma função que o
 * ecrã chama — `guardarPasso`, `guardarPassoSociedade`, `guardarPassoConvite`
 * — e só acrescenta transporte (ler JSON, autenticar, formatar a resposta).
 * Evita a segunda porta com regras próprias divergentes.
 *
 * Autenticação em duas camadas: o token do link mágico no caminho diz *qual*
 * registo; a chave `Authorization: Bearer …` diz *quem* chama. Não são
 * redundantes — um token de link vive num email reencaminhável, a chave não.
 *
 * Sem `API_CHAVE` configurada, responde 503 e não fica aberta.
 */

/** Quantos pedidos por minuto e por chamador. */
const MAX_PEDIDOS = 60;
const JANELA_MS = 60_000;

export type Falha = { erro: string; codigo: string };

export function respostaErro(codigo: string, erro: string, estado: number) {
  return NextResponse.json<Falha>({ erro, codigo }, { status: estado });
}

/**
 * Comparação em tempo constante — evita adivinhar a chave byte a byte pelo
 * tempo de resposta. O comprimento compara-se à parte porque `timingSafeEqual`
 * rebenta com buffers de tamanhos diferentes.
 */
function chavesIguais(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export type Autorizacao =
  | { ok: true; chamador: string }
  | { ok: false; resposta: NextResponse };

/**
 * Autentica o chamador e aplica o limite de ritmo.
 *
 * `chamador` são os primeiros 8 carateres da chave, não a chave — entra em
 * logs e nas chaves do limitador, sítios errados para um segredo.
 */
export function autorizar(pedido: Request): Autorizacao {
  const configurada = process.env.API_CHAVE?.trim();

  if (!configurada) {
    console.warn("[api] API_CHAVE não configurada — a API dos onboardings está fechada.");
    return {
      ok: false,
      resposta: respostaErro(
        "api_desativada",
        "A API não está configurada nesta instalação.",
        503,
      ),
    };
  }

  const cabecalho = pedido.headers.get("authorization") ?? "";
  const apresentada = cabecalho.toLowerCase().startsWith("bearer ")
    ? cabecalho.slice(7).trim()
    : "";

  if (!apresentada || !chavesIguais(apresentada, configurada)) {
    return {
      ok: false,
      resposta: respostaErro(
        "nao_autorizado",
        "Chave de API em falta ou inválida. Envie-a em Authorization: Bearer <chave>.",
        401,
      ),
    };
  }

  const chamador = apresentada.slice(0, 8);
  const veredicto = consumir(`api:${chamador}`, MAX_PEDIDOS, JANELA_MS);

  if (!veredicto.permitido) {
    return {
      ok: false,
      resposta: NextResponse.json<Falha>(
        {
          erro: `Demasiados pedidos. Aguarde ${veredicto.esperarSegundos}s.`,
          codigo: "demasiados_pedidos",
        },
        {
          status: 429,
          headers: { "Retry-After": String(veredicto.esperarSegundos) },
        },
      ),
    };
  }

  return { ok: true, chamador };
}

/**
 * Lê o corpo JSON do pedido. Corpo mal formado dá 400 com a razão, não uma
 * exceção não apanhada a chegar como 500.
 */
export async function corpoJson(pedido: Request): Promise<
  { ok: true; dados: unknown } | { ok: false; resposta: NextResponse }
> {
  try {
    const dados = await pedido.json();
    if (typeof dados !== "object" || dados === null) {
      return {
        ok: false,
        resposta: respostaErro(
          "corpo_invalido",
          "O corpo do pedido tem de ser um objeto JSON.",
          400,
        ),
      };
    }
    return { ok: true, dados };
  } catch {
    return {
      ok: false,
      resposta: respostaErro("corpo_invalido", "O corpo do pedido não é JSON válido.", 400),
    };
  }
}

/**
 * Resposta de uma gravação de passo, partilhada pelos três percursos.
 *
 * `erros` vem por campo, como o formulário o recebe — permite a um bot dizer
 * qual campo corrigir em vez de só "não foi possível guardar".
 */
export function respostaPasso(
  r:
    | { ok: true; proximo: number | null }
    | { ok: false; erros: Record<string, string[]>; mensagem?: string },
) {
  if (r.ok) return NextResponse.json({ ok: true, proximo: r.proximo });
  return NextResponse.json(
    { ok: false, erros: r.erros, mensagem: r.mensagem ?? null },
    // 422 e não 400: o JSON era válido, falhou foi a regra de negócio.
    { status: 422 },
  );
}
