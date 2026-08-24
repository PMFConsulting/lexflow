/**
 * In-memory sliding-window rate limiter.
 *
 * No `server-only` and nothing from Node on purpose: this runs in the
 * `middleware` (Edge runtime) and in Server Actions (Node runtime), and the
 * same rule written twice would diverge at the first change.
 *
 * **What this is, and what it is not.** A `Map` in the process is not a
 * distributed limiter: restarting the container zeroes the counts, and two
 * containers each count on their own. The POC runs in a single container on
 * Coolify, and the alternative — a table and a write per attempt — put Postgres
 * on the critical path of login to solve a problem that does not yet exist.
 * When there is more than one instance, this file changes implementation and
 * nothing else.
 *
 * What it **does** solve is what matters here: a password dictionary or a
 * million six-digit codes thrown from a single IP stop fitting in an afternoon.
 * An attacker who restarts the container between attempts has bigger problems
 * to hand us.
 */

type Janela = { marcas: number[] };

/** One bucket per key. Cleanup is lazy — see `podar`. */
const baldes = new Map<string, Janela>();

/**
 * How many keys are accepted in memory before the oldest is thrown away.
 *
 * With no ceiling, one key per IP is a memory leak with a fake-IP generator in
 * front of it. Ten thousand keys are a few megabytes and more distinct IPs than
 * this POC will see in a month.
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
  // Still full after pruning (everything inside the window): it is emptied
  // entirely. Losing counts is preferable to growing without limit — the
  // "fail open" policy is deliberate in a limiter that is not the only guard.
  if (baldes.size > MAX_CHAVES) baldes.clear();
}

export type Veredicto =
  | { permitido: true; restantes: number }
  | { permitido: false; esperarSegundos: number };

/**
 * Records an attempt and says whether it fits within the limit.
 *
 * The mark is only stored when the attempt is allowed: that way a refused burst
 * does not push the window forward indefinitely, and the blocked client is
 * accepted again when the old marks expire — and not when they stop trying.
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
