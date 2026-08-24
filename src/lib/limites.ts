/**
 * Limitador de ritmo por janela deslizante, em memória.
 *
 * Sem `server-only` e sem nada de Node de propósito: isto corre no `middleware`
 * (runtime Edge) e nas Server Actions (runtime Node), e a mesma régua escrita
 * duas vezes divergiria à primeira alteração.
 *
 * **O que isto é, e o que não é.** Um `Map` no processo não é um limitador
 * distribuído: reiniciar o contentor zera as contagens, e dois contentores
 * contam cada um por si. A POC corre num contentor só no Coolify, e a
 * alternativa — uma tabela e uma escrita por tentativa — punha o Postgres no
 * caminho crítico do login para resolver um problema que ainda não existe.
 * Quando houver mais do que uma instância, é este ficheiro que muda de
 * implementação e mais nada.
 *
 * O que ele **resolve** é o que interessa aqui: um dicionário de palavras-passe
 * ou um milhão de códigos de seis dígitos atirados de um IP só deixam de caber
 * numa tarde. Um atacante que reinicie o contentor entre tentativas tem
 * problemas maiores para nos dar.
 */

type Janela = { marcas: number[] };

/** Um balde por chave. A limpeza é preguiçosa — ver `podar`. */
const baldes = new Map<string, Janela>();

/**
 * Quantas chaves se aceitam em memória antes de a mais antiga ser deitada fora.
 *
 * Sem teto, uma chave por IP é uma fuga de memória com um gerador de IPs
 * falsos à frente. Dez mil chaves são alguns megabytes e mais IPs distintos do
 * que esta POC vai ver num mês.
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
  // Ainda cheio depois da poda (tudo dentro da janela): esvazia-se por
  // inteiro. Perder contagens é preferível a crescer sem limite — a política
  // de "falhar aberto" é deliberada num limitador que não é o único guarda.
  if (baldes.size > MAX_CHAVES) baldes.clear();
}

export type Veredicto =
  | { permitido: true; restantes: number }
  | { permitido: false; esperarSegundos: number };

/**
 * Regista uma tentativa e diz se ela cabe no limite.
 *
 * A marca só é gravada quando a tentativa é permitida: assim uma rajada
 * recusada não empurra a janela para a frente indefinidamente, e o cliente
 * bloqueado volta a ser aceite quando as marcas antigas expirarem — e não
 * quando parar de tentar.
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

/** Esquece uma chave — o que se faz a seguir a um login ou a um código certo. */
export function esquecer(chave: string) {
  baldes.delete(chave);
}

/** Só para os testes: repõe o estado entre casos. */
export function limparLimites() {
  baldes.clear();
}
