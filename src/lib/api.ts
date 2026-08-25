import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { consumir } from "@/lib/limites";

/**
 * A superfície HTTP dos onboardings, para um bot os poder percorrer.
 *
 * A regra que governa este ficheiro inteiro: **a API não tem lógica própria**.
 * Cada rota chama exatamente a mesma função que o ecrã chama — `guardarPasso`,
 * `guardarPassoSociedade`, `guardarPassoConvite` — e o que ela acrescenta é
 * transporte: ler JSON, autenticar o chamador, dar forma à resposta. É a única
 * disciplina que impede o que sempre acontece a uma segunda porta para a mesma
 * casa: a validação apertar de um lado e não do outro, e passar a haver dois
 * conjuntos de regras com o mesmo nome.
 *
 * ## Autenticação
 *
 * Duas camadas, e as duas são precisas:
 *
 *   1. **O token do link mágico**, no caminho. É ele que diz *qual* registo se
 *      está a preencher, e é o mesmo que o cliente tem no email — não há aqui
 *      nada que o dono do link não pudesse fazer pelo browser.
 *
 *   2. **A chave da API**, no header `Authorization: Bearer …`. É ela que diz
 *      *quem* chama, e existe por uma razão que não é redundante com a
 *      primeira: um token de link vive num email, e um email é reencaminhado,
 *      colado em conversas e indexado por quem tenha acesso à caixa. Que ele
 *      abra um formulário no browser é o desenho; que abra uma porta
 *      programática, que se percorre em segundos e sem olhos humanos pelo meio,
 *      é outra coisa. A chave é o que separa as duas.
 *
 * Sem `API_CHAVE` configurada, a API responde 503 e **não** fica aberta. Um
 * fallback permissivo aqui seria a instalação que esqueceu a variável a servir
 * dados de KYC a quem os peça.
 */

/** Quantos pedidos por minuto e por chamador. */
const MAX_PEDIDOS = 60;
const JANELA_MS = 60_000;

export type Falha = { erro: string; codigo: string };

export function respostaErro(codigo: string, erro: string, estado: number) {
  return NextResponse.json<Falha>({ erro, codigo }, { status: estado });
}

/**
 * Comparação em tempo constante.
 *
 * Numa comparação normal o tempo de resposta varia com quantos carateres
 * batem certo, e é isso que permite adivinhar a chave byte a byte. O
 * comprimento é comparado antes porque `timingSafeEqual` rebenta com buffers de
 * tamanhos diferentes — e o comprimento de uma chave não é segredo.
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
 * O `chamador` que sai daqui é um identificador curto e **não** a chave: entra
 * em linhas de log e em chaves do limitador, e nenhum desses sítios é lugar para
 * um segredo. São os primeiros oito carateres, que chegam para distinguir dois
 * bots e não chegam para adivinhar nada.
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
 * Lê o corpo JSON de um pedido.
 *
 * Um corpo mal formado é 400 com a razão, e não uma exceção não apanhada que
 * chega ao chamador como 500 — a diferença entre "o teu JSON tem uma vírgula a
 * mais" e "o servidor rebentou" é a diferença entre um bot que se corrige
 * sozinho e um que abre um ticket.
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
 * A resposta de uma gravação de passo, na forma que os três percursos partilham.
 *
 * `erros` vem por campo, tal como o formulário o recebe, e é isso que permite a
 * um bot dizer à pessoa **qual** campo corrigir em vez de repetir «não foi
 * possível guardar». É a mesma lição do resumo de erros do formulário, na
 * versão sem ecrã.
 */
export function respostaPasso(
  r:
    | { ok: true; proximo: number | null }
    | { ok: false; erros: Record<string, string[]>; mensagem?: string },
) {
  if (r.ok) return NextResponse.json({ ok: true, proximo: r.proximo });
  return NextResponse.json(
    { ok: false, erros: r.erros, mensagem: r.mensagem ?? null },
    // 422 e não 400: o corpo era JSON válido e chegou inteiro. O que falhou foi
    // a regra de negócio, e um bot que distinga os dois sabe que num caso
    // reformula o pedido e no outro pergunta à pessoa.
    { status: 422 },
  );
}
