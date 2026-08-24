import { beforeEach, describe, expect, it } from "vitest";
import { consumir, esquecer, limparLimites } from "./limites";

/**
 * The rate limiter, which serves two places: the back-office login
 * (`middleware.ts`) and the closing code verification
 * (`features/onboarding/acoes.ts`).
 *
 * The clock is passed as a parameter on purpose — without that, a sliding
 * window test either really waits or does not test the window.
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
   * The window slides: old marks fall away on their own. This is what makes a
   * fifteen-minute block pass with nobody having to unblock anything.
   */
  it("liberta assim que as marcas saem da janela", () => {
    consumir("ip", 1, 60_000, 1_000);
    expect(consumir("ip", 1, 60_000, 30_000).permitido).toBe(false);
    expect(consumir("ip", 1, 60_000, 62_000).permitido).toBe(true);
  });

  /**
   * A refused attempt does **not** record a mark. Without this, whoever
   * hammered away without stopping pushed the window forward with every blow
   * and stayed blocked forever — which punishes the honest mistake next door
   * (same IP in an office) and does not punish the attack any further, since it
   * is not expecting to get in by repetition.
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
