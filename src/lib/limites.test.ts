import { beforeEach, describe, expect, it } from "vitest";
import { consumir, esquecer, limparLimites } from "./limites";

/**
 * O limitador de ritmo, que serve dois sítios: o início de sessão do
 * back-office (`middleware.ts`) e a verificação do código do fecho
 * (`features/onboarding/acoes.ts`).
 *
 * O relógio entra por parâmetro de propósito — sem isso, um teste de janela
 * deslizante ou espera de verdade ou não testa a janela.
 */

beforeEach(() => {
  limparLimites();
});

describe("consumir", () => {
  it("deixa passar até ao limite e recusa a seguir", () => {
    for (let i = 0; i < 3; i += 1) {
      expect(consumir("ip", 3, 60_000, 1_000).permitido).toBe(true);
    }

    const quarta = consumir("ip", 3, 60_000, 1_000);
    expect(quarta.permitido).toBe(false);
    if (quarta.permitido) return;
    expect(quarta.esperarSegundos).toBe(60);
  });

  it("conta as chaves em separado", () => {
    consumir("a", 1, 60_000, 1_000);

    expect(consumir("b", 1, 60_000, 1_000).permitido).toBe(true);
    expect(consumir("a", 1, 60_000, 1_000).permitido).toBe(false);
  });

  /**
   * A janela desliza: as marcas antigas caem sozinhas. É isto que faz um
   * bloqueio de quinze minutos passar sem ninguém ter de desbloquear nada.
   */
  it("liberta assim que as marcas saem da janela", () => {
    consumir("ip", 1, 60_000, 1_000);
    expect(consumir("ip", 1, 60_000, 30_000).permitido).toBe(false);
    expect(consumir("ip", 1, 60_000, 62_000).permitido).toBe(true);
  });

  /**
   * Uma tentativa recusada **não** grava marca. Sem isto, quem martelasse sem
   * parar empurrava a janela para a frente a cada golpe e ficava bloqueado para
   * sempre — o que castiga o engano honesto ao lado (mesmo IP num escritório) e
   * não castiga mais o ataque, que não está à espera de entrar por repetição.
   */
  it("uma recusa não prolonga o bloqueio", () => {
    consumir("ip", 1, 60_000, 1_000);
    consumir("ip", 1, 60_000, 50_000); // recusada
    expect(consumir("ip", 1, 60_000, 62_000).permitido).toBe(true);
  });

  it("o que resta é contado até ao limite", () => {
    const primeira = consumir("ip", 2, 60_000, 1_000);
    expect(primeira.permitido && primeira.restantes).toBe(1);

    const segunda = consumir("ip", 2, 60_000, 1_000);
    expect(segunda.permitido && segunda.restantes).toBe(0);
  });

  it("esquecer uma chave repõe-lhe o orçamento", () => {
    consumir("ip", 1, 60_000, 1_000);
    esquecer("ip");
    expect(consumir("ip", 1, 60_000, 1_000).permitido).toBe(true);
  });
});
