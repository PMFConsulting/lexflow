/**
 * In-memory sliding-window rate limiter.
 *
 * No `server-only`, nothing Node-specific — runs in `middleware` (Edge) and
 * in Server Actions (Node), and the rule can't diverge between the two.
 *
 * A `Map` in the process, not distributed: restart zeroes it, multiple
 * containers count separately. Fine for a single-container POC; the
 * alternative (a table, a write per attempt) puts Postgres on login's
 * critical path for a problem that doesn't exist yet. Swap implementation
 * here, nothing else, if that changes.
 */

type Janela = { marcas: number[] };

/** One bucket per key. Cleanup is lazy — see `podar`. */
const baldes = new Map<string, Janela>();

/**
 * Ceiling on keys held in memory before the oldest is dropped — otherwise one
 * key per IP is a memory leak behind a fake-IP generator. 10k keys is a few
 * megabytes, more distinct IPs than this POC sees in a month.
 */
const MAX_CHAVES = 10_000;

function podar(agora: number, janelaMs: number) {
  if (baldes.size <= MAX_CHAVES) return;
  for (const [chave, janela] of baldes) {
    const vivas = janela.marcas.filter((m) => agora - m < janelaMs);
    if (vivas.length === 0) baldes.delete(chave);
    else janela.marcas = vivas;
    if (baldes.size <= MAX_CHAVES) break;
  }
  // Still full after pruning (everything inside the window): clear it
  // entirely. Fail-open is deliberate — this isn't the only guard.
  if (baldes.size > MAX_CHAVES) baldes.clear();
}

export type Veredicto =
  | { permitido: true; restantes: number }
  | { permitido: false; esperarSegundos: number };

/**
 * Records an attempt and says whether it's within the limit.
 *
 * The mark is stored only when allowed — a refused burst doesn't keep
 * pushing the window forward, so the client is accepted again once old
 * marks expire, not once they stop trying.
 */
export function consumir(chave: string, maximo: number, janelaMs: number, agora = Date.now()): Veredicto {
  const janela = baldes.get(chave) ?? { marcas: [] };
  const vivas = janela.marcas.filter((m) => agora - m < janelaMs);

  if (vivas.length >= maximo) {
    janela.marcas = vivas;
    baldes.set(chave, janela);
    const maisAntiga = vivas[0];
    return {
      permitido: false,
      esperarSegundos: Math.max(1, Math.ceil((janelaMs - (agora - maisAntiga)) / 1000)),
    };
  }

  vivas.push(agora);
  janela.marcas = vivas;
  baldes.set(chave, janela);
  podar(agora, janelaMs);

  return { permitido: true, restantes: maximo - vivas.length };
}

/** Forgets a key — what is done after a successful login or a correct code. */
export function esquecer(chave: string) {
  baldes.delete(chave);
}

/** Tests only: resets the state between cases. */
export function limparLimites() {
  baldes.clear();
}

/**
 * Política de início de sessão, num só sítio.
 *
 * Dois limitadores cobrem `/api/auth/sign-in/email`: o `middleware` (Edge) e o
 * limitador interno do Better Auth. Enquanto os números viviam em ficheiros
 * diferentes, o mais apertado ganhava sem aparecer em lado nenhum — subir o do
 * `middleware` de 10 para 200 não mudou nada, porque quem recusava ao 4.º
 * pedido era a regra por omissão do Better Auth (`/sign-in*`, 3 pedidos por
 * 10 s, ativa só em produção). Daqui em diante os dois leem estas constantes.
 */

/** Tentativas de início de sessão por IP dentro da janela. Generoso para não travar testes reais (POC). */
export const LOGIN_MAX_TENTATIVAS = 200;

/** A janela do limite de início de sessão, em milissegundos. */
export const LOGIN_JANELA_MS = 15 * 60_000;
