import { describe, expect, it } from "vitest";
import {
  PASSOS,
  TOTAL_PASSOS,
  passoAplicavel,
  passoAnterior,
  passosAntesDe,
  passosDoProcesso,
  proximoPasso,
  ultimoPasso,
} from "./passos";

/**
 * O passo 3 — Representante Legal — só existe para pessoas coletivas (D28).
 *
 * O que se testa aqui não é a lista de passos: é o percurso. Uma pessoa
 * singular representa-se a si própria, e a pergunta "quem representa
 * legalmente a entidade?" não tem resposta possível — era o que a reunião de
 * 07/08 apanhou. Numa empresa a pergunta é obrigatória.
 *
 * A numeração não se mexe de propósito: o passo continua a ser o 3 e o Fecho o
 * 7 mesmo para quem salta o 3. Renumerar partia os rótulos de auditoria
 * (`passo.N.gravado`), a restrição `passo_valido` e os links de "Corrigir" já
 * gravados — daí os testes que fixam os números, e não só as contagens.
 */
describe("passo 3 (Representante Legal) só para pessoa coletiva", () => {
  it("não é aplicável a um particular, e é a uma empresa", () => {
    expect(passoAplicavel(3, "particular")).toBe(false);
    expect(passoAplicavel(3, "empresa")).toBe(true);
  });

  it("é o único passo que o percurso do particular salta", () => {
    const saltados = PASSOS.filter((p) => !passoAplicavel(p.n, "particular")).map((p) => p.n);
    expect(saltados).toEqual([3]);
  });

  it("um particular percorre 6 passos e uma empresa 7", () => {
    expect(passosDoProcesso("particular").map((p) => p.n)).toEqual([1, 2, 4, 5, 6, 7]);
    expect(passosDoProcesso("empresa").map((p) => p.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(passosDoProcesso("empresa")).toHaveLength(TOTAL_PASSOS);
  });
});

describe("navegação salta o 3 sem renumerar", () => {
  it("no particular, o 2 avança para o 4 e o 4 recua para o 2", () => {
    expect(proximoPasso(2, "particular")).toBe(4);
    expect(passoAnterior(4, "particular")).toBe(2);
  });

  it("na empresa, o 2 avança para o 3 e o 4 recua para o 3", () => {
    expect(proximoPasso(2, "empresa")).toBe(3);
    expect(passoAnterior(4, "empresa")).toBe(3);
  });

  it("o Fecho é o passo 7 nos dois percursos, e não tem seguinte", () => {
    expect(ultimoPasso("particular")).toBe(7);
    expect(ultimoPasso("empresa")).toBe(7);
    expect(proximoPasso(7, "particular")).toBeNull();
    expect(proximoPasso(7, "empresa")).toBeNull();
  });

  it("o passo 1 não tem anterior", () => {
    expect(passoAnterior(1, "particular")).toBeNull();
    expect(passoAnterior(1, "empresa")).toBeNull();
  });
});

/**
 * O bug que isto fixa: as listagens só têm o `passo_atual` à mão, e um
 * `passoAtual - 1` carimbava no particular também o Representante Legal — um
 * passo que ele nunca viu, porque a numeração salta do 2 para o 4.
 */
describe("contagem de carimbos", () => {
  it("no particular, chegar ao 4 significa 2 passos para trás e não 3", () => {
    expect(passosAntesDe(4, "particular")).toBe(2);
    expect(passosAntesDe(4, "empresa")).toBe(3);
  });

  it("no fim, o particular tem 5 carimbos e a empresa 6", () => {
    expect(passosAntesDe(7, "particular")).toBe(5);
    expect(passosAntesDe(7, "empresa")).toBe(6);
  });
});

describe("o texto do passo 3", () => {
  it("fala de Cargo e não de Relação — o rótulo mudou com a análise de 07/08", () => {
    const passo3 = PASSOS.find((p) => p.n === 3);
    expect(passo3?.titulo).toBe("Representante Legal");
    expect(passo3?.descricao).not.toMatch(/Relação com o cliente/i);
  });
});
