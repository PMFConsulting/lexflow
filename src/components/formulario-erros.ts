/**
 * Levar quem corrige até ao campo errado. Peças de DOM partilhadas pelos três
 * formulários por passos (cliente, sociedade, equipa) — vieram do formulário
 * do cliente para aqui por terem custado a acertar: `[name="x"]` a aterrar
 * num `input type="hidden"`, `scrollIntoView` que não saía do sítio.
 */

/**
 * Onde saltar quando um erro cai sobre um campo.
 *
 * `[name="x"]` não chega: sim/não, escolha única, listas e caixas de
 * aceitação levam o `name` num `input type="hidden"` que o browser não
 * desenha, e `scrollIntoView`/`focus` sobre um elemento invisível não fazem
 * nada. Encontrado o escondido, sobe-se ao contentor e foca-se o primeiro
 * controlo utilizável — campos de texto antes de botões, porque numa lista
 * já preenchida o primeiro botão é um "Remover".
 */
export function alvoDoErro(campo: string) {
  const el = document.querySelector<HTMLElement>(`[name="${CSS.escape(campo)}"]`);
  if (!el) return null;

  const escondido = el instanceof HTMLInputElement && el.type === "hidden";
  if (!escondido) return { rolar: el, focar: el, rotulo: rotuloVisivel(el) };

  const caixa = el.closest<HTMLElement>("fieldset, div");
  if (!caixa) return null;

  const focar =
    caixa.querySelector<HTMLElement>(
      'select:not([disabled]), textarea:not([disabled]), input:not([type="hidden"]):not([disabled])',
    ) ?? caixa.querySelector<HTMLElement>("button:not([disabled])");

  return { rolar: caixa, focar, rotulo: rotuloVisivel(el) };
}

/**
 * A etiqueta que o cliente lê por cima do campo. Mensagens como "Obrigatório."
 * ou "Responda sim ou não." não se nomeiam a si próprias, e deixavam "Falta
 * corrigir um campo" sem dizer qual (relatado no passo 2).
 *
 * Vem do DOM, não de um mapa de nomes — um mapa envelhece à parte do ecrã.
 * Sem etiqueta, devolve `null`: a mensagem sozinha é melhor que uma errada.
 */
export function rotuloVisivel(el: HTMLElement): string | null {
  const escondido = el instanceof HTMLInputElement && el.type === "hidden";

  // Campo que se vê: a etiqueta está ligada por `htmlFor`, como o `Campo` faz.
  if (!escondido && el.id) {
    const ligada = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (ligada?.textContent) return limparRotulo(ligada.textContent);
  }

  // Sim/não, escolha única, listas e caixas de aceitação: o `name` está num
  // input escondido, e a etiqueta é a `legend` do fieldset ou o `label` que
  // lhe faz companhia dentro do mesmo contentor.
  const caixa = el.closest("fieldset, div");
  const solta = caixa?.querySelector("legend, label");
  return solta?.textContent ? limparRotulo(solta.textContent) : null;
}

/** Sem o asterisco de obrigatório nem as quebras de linha da marcação. */
export function limparRotulo(texto: string) {
  const limpo = texto.replace(/\s+/g, " ").replace(/\s*\*$/, "").trim();
  // Uma declaração inteira como etiqueta empurraria a mensagem para fora da
  // vista — o início já chega para localizar o campo.
  return limpo.length > 60 ? `${limpo.slice(0, 59).trimEnd()}…` : limpo;
}
