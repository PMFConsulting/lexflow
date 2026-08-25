/**
 * Levar quem corrige até ao campo que está errado.
 *
 * Peças de DOM, partilhadas pelos três formulários por passos — o do cliente, o
 * da sociedade e o de cada pessoa da equipa. Estavam dentro do formulário do
 * cliente, que era o único que existia; o que as trouxe para aqui não foi
 * arrumação, foi o facto de custarem a acertar e valerem em qualquer
 * formulário: um `[name="x"]` que aterra num `input type="hidden"`, um
 * `scrollIntoView` que não sai do sítio, um resumo de erros com links mortos.
 */

/**
 * Onde saltar quando um erro cai sobre um campo.
 *
 * `[name="x"]` não chega. Só as caixas de texto levam o `name` num campo que se
 * vê: os sim/não, a escolha única, as listas e as caixas de aceitação levam-no
 * num `input type="hidden"`, que o browser não desenha. `scrollIntoView` e
 * `focus` sobre um elemento sem caixa não fazem rigorosamente nada — o resumo
 * de erros tinha links mortos e o salto automático para o primeiro erro não
 * saía do sítio, precisamente nos campos onde o vermelho é mais difícil de
 * encontrar a olho ("Indique pelo menos uma nacionalidade", "Responda sim ou
 * não").
 *
 * Encontrado o escondido, sobe-se ao contentor do campo e leva-se o foco ao
 * primeiro controlo que se possa mesmo usar. Os campos de texto vêm à frente
 * dos botões porque numa lista já preenchida o primeiro botão é o "Remover" da
 * primeira etiqueta, e não é lá que se quer deixar quem vem corrigir.
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
 * A etiqueta que o cliente lê por cima do campo — "Número de contribuinte",
 * "Nacionalidade(s)", a pergunta do sim/não.
 *
 * O resumo de erros listava só as mensagens. A maior parte nomeia-se a si
 * própria ("O NIF não é válido…"), mas as que não o fazem — "Obrigatório.",
 * "Data inválida.", "Responda sim ou não." — deixavam o cabeçalho "Falta
 * corrigir um campo" a não dizer qual, que foi o que se relatou do passo 2.
 *
 * Vem do DOM e não de um mapa de nomes para rótulos: um mapa é uma segunda
 * cópia dos textos, que envelhece à parte daquilo que está no ecrã. Aqui, se
 * não houver etiqueta nenhuma, devolve-se `null` e a linha fica como estava —
 * a mensagem sozinha é sempre melhor do que uma etiqueta errada.
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
  // Uma declaração inteira como etiqueta ("Declaro que as informações
  // prestadas são verdadeiras e assumo…") empurra a mensagem para fora da
  // vista. Corta-se, que para localizar o campo o início chega.
  return limpo.length > 60 ? `${limpo.slice(0, 59).trimEnd()}…` : limpo;
}
