import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * O convite não passa pela aprovação da plataforma.
 *
 * A `0021` tornou `utilizador.aprovado_em` a condição para passar dos guards, e
 * a coluna é anulável: **quem escreve uma linha e não a preenche cria uma conta
 * que nunca entra**. Para as contas propostas por uma sociedade isso é a
 * funcionalidade; para o convite é um defeito, e dos silenciosos — a pessoa
 * percorre seis passos, escolhe a palavra-passe no último, e o primeiro ecrã
 * que vê a seguir é `/aguarda-aprovacao`, à espera de uma decisão que ninguém
 * lhe disse que precisava. Vale sobretudo para o **primeiro administrador de
 * uma sociedade nova**, que entra exatamente por aqui: a sociedade ficava
 * registada e sem uma única pessoa capaz de lá entrar.
 *
 * O teste é sobre o texto do ficheiro e não sobre o comportamento, e é uma
 * escolha: `concluirConvite` escreve em cinco tabelas dentro de uma transação
 * depois de validar os seis passos, e o arnês de simulação necessário para lá
 * chegar seria maior — e mais frágil — do que a invariante que ele guarda. O
 * que se quer impedir é uma linha desaparecer numa reescrita, e para isso isto
 * chega.
 */

const fonte = readFileSync(fileURLToPath(new URL("./acoes.ts", import.meta.url)), "utf8");

describe("a conta criada pelo convite nasce aprovada", () => {
  /**
   * Dois caminhos, e os dois contam: a linha nova, e a que já existia na
   * sociedade (uma conta criada por um administrador e entretanto apagada volta
   * por aqui — sem a coluna, trazia o `null` consigo).
   */
  it("as duas escritas em `utilizador` preenchem `aprovadoEm`", () => {
    const escritas = [
      ...fonte.matchAll(/\.(?:insert|update)\(utilizador\)\s*\.(?:values|set)\(\{([\s\S]*?)\}\)/g),
    ];

    expect(escritas.length).toBeGreaterThanOrEqual(2);

    for (const [, corpo] of escritas) {
      expect(corpo).toMatch(/aprovadoEm:/);
    }
  });
});
