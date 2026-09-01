import { describe, expect, it } from "vitest";
import { navegacaoDoPapel } from "./layout";
import type { Papel } from "@/lib/sessao";

/**
 * BUG3-011: a barra lateral do back-office misturava entradas de gestão com
 * pessoais e mostrava "Painel"/"Os meus processos" a quem não devia — o
 * filtro testava `podeVerEmails`, uma função sobre outra pergunta, em vez do
 * papel. `navegacaoDoPapel` é função pura e exportada por isso: testa-se a
 * regra sem sessão, sem cookies e sem base de dados.
 */

const titulos = (papel: Papel) => navegacaoDoPapel(papel).map((e) => e.titulo);

describe("navegacaoDoPapel", () => {
  it("society_admin: sem Painel, sem Os meus processos", () => {
    const t = titulos("society_admin");
    expect(t).not.toContain("Painel");
    expect(t).not.toContain("Os meus processos");
    expect(t).toEqual(["A minha conta", "Administração", "Processos", "Clientes", "Notificações"]);
  });

  it("gestor: vê A minha equipa, não vê Administração nem Os meus processos", () => {
    const t = titulos("gestor");
    expect(t).toContain("A minha equipa");
    expect(t).not.toContain("Administração");
    expect(t).not.toContain("Os meus processos");
    expect(t).toEqual(["A minha conta", "Processos", "A minha equipa", "Clientes", "Notificações"]);
  });

  it("utilizador: vê Os meus processos, não vê Administração nem A minha equipa", () => {
    const t = titulos("utilizador");
    expect(t).toContain("Os meus processos");
    expect(t).not.toContain("Administração");
    expect(t).not.toContain("A minha equipa");
    expect(t).toEqual([
      "A minha conta",
      "Os meus processos",
      "Processos",
      "Clientes",
      "Notificações",
    ]);
  });

  it("super_admin: nunca alcança esta barra (exigirEquipaDaSociedade bloqueia-o), mas a função não lhe entrega nenhuma entrada de gestão se for chamada", () => {
    const t = titulos("super_admin");
    expect(t).not.toContain("Administração");
    expect(t).not.toContain("A minha equipa");
    expect(t).not.toContain("Os meus processos");
  });

  it("nenhum papel vê a entrada Painel — foi removida da barra (BUG3-011)", () => {
    for (const papel of ["society_admin", "gestor", "utilizador", "super_admin"] as const) {
      expect(titulos(papel)).not.toContain("Painel");
    }
  });
});
