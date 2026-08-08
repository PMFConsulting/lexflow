import { describe, expect, it } from "vitest";
import { passo5 } from "./schemas";

/**
 * O NIF de faturação tinha de aceitar números estrangeiros.
 *
 * O passo 2 aceita de propósito um número fiscal de outro país
 * (`nifPortugues = false`), mas o passo 5 impunha o mod-11 português a toda a
 * gente. Consequência: um cliente estrangeiro chegava ao penúltimo passo, era
 * obrigado a preencher o "NIF / NIPC" e não havia número nenhum que passasse —
 * nem sequer o dele. Ficava preso sem forma de perceber porquê.
 *
 * A regra passou a olhar para a forma do que foi escrito: nove dígitos é um
 * número português e leva o checksum inteiro (é o que apanha o dígito
 * trocado, a razão de ser da validação); qualquer outra forma é de outro país
 * e só se exige que exista.
 */

const base = {
  igualAoCliente: false,
  nome: "Maria Silva",
  morada: "Rua das Flores, 12",
  pais: "PT",
  localidade: "Porto",
  codigoPostal: "4000-001",
  freguesia: "Cedofeita",
  concelho: "Porto",
  distrito: "Porto",
  email: "maria@exemplo.pt",
  acIgualAoCliente: false,
};

const comNif = (nif: string) => passo5.safeParse({ ...base, nif });

/** O erro que caiu sobre o campo `nif`, se algum caiu. */
const erroNoNif = (r: ReturnType<typeof comNif>) =>
  r.success ? undefined : r.error.issues.find((i) => i.path[0] === "nif");

describe("NIF de faturação", () => {
  it("aceita um NIF português válido", () => {
    expect(erroNoNif(comNif("123456789"))).toBeUndefined();
    expect(erroNoNif(comNif("500000000"))).toBeUndefined();
  });

  it("recusa nove dígitos com o checksum errado — é o dígito trocado", () => {
    expect(erroNoNif(comNif("213456789"))).toBeDefined();
  });

  it("aceita um número fiscal estrangeiro, que nunca cumpriria o mod-11", () => {
    // Um VAT espanhol e um UTR britânico: formas que a regra portuguesa
    // rejeitava em bloco, e que bloqueavam o cliente no passo 5.
    expect(erroNoNif(comNif("ESX1234567L"))).toBeUndefined();
    expect(erroNoNif(comNif("1234567890"))).toBeUndefined();
  });

  it("continua a exigir que o campo seja preenchido", () => {
    expect(erroNoNif(comNif(""))).toBeDefined();
  });
});
