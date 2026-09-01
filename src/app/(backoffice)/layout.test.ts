import { describe, expect, it } from "vitest";
import { navegacaoDoPapel } from "./layout";
import type { Papel } from "@/lib/sessao";

/**
 * BUG3-011: a barra lateral do back-office misturava entradas de gestão com
 * pessoais e mostrava "Painel"/"Os meus processos" a quem não devia — o
 * filtro testava `podeVerEmails`, uma função sobre outra pergunta, em vez do
 * papel. `navegacaoDoPapel` é função pura e exportada por isso: testa-se a
 * regra sem sessão, sem cookies e sem base de dados.
 *
 * Desde o brief 3, `navegacaoDoPapel` devolve GRUPOS ({label, entradas}) para
 * separar o trabalho sobre clientes ("Trabalho") de quem trabalha
 * ("Administração" / "A minha conta"). Os testes achatam os grupos para
 * verificar os títulos e o agrupamento.
 */

const achatar = (grupos: { label: string; entradas: { titulo: string }[] }[]) =>
  grupos.flatMap((g) => g.entradas.map((e) => e.titulo));

const titulos = (papel: Papel) => achatar(navegacaoDoPapel(papel));
const grupos = (papel: Papel) => navegacaoDoPapel(papel).map((g) => g.label);

describe("navegacaoDoPapel", () => {
  it("society_admin: sem Painel, sem Os meus processos; vê Trabalho + Administração", () => {
    const t = titulos("society_admin");
    expect(t).not.toContain("Painel");
    expect(t).not.toContain("Os meus processos");
    expect(t).not.toContain("A minha equipa");
    expect(t).toEqual(["Processos", "Clientes", "Notificações", "A minha conta", "Administração"]);
    expect(grupos("society_admin")).toEqual(["Trabalho", "Administração"]);
  });

  it("gestor: vê A minha equipa, não vê Administração nem Os meus processos", () => {
    const t = titulos("gestor");
    expect(t).toContain("A minha equipa");
    expect(t).not.toContain("Administração");
    expect(t).not.toContain("Os meus processos");
    expect(t).toEqual(["Processos", "A minha equipa", "Clientes", "Notificações", "A minha conta"]);
    expect(grupos("gestor")).toEqual(["Trabalho", "A minha conta"]);
  });

  it("utilizador: vê Os meus processos, não vê Administração nem A minha equipa", () => {
    const t = titulos("utilizador");
    expect(t).toContain("Os meus processos");
    expect(t).not.toContain("Administração");
    expect(t).not.toContain("A minha equipa");
    expect(t).toEqual([
      "Os meus processos",
      "Processos",
      "Clientes",
      "Notificações",
      "A minha conta",
    ]);
    expect(grupos("utilizador")).toEqual(["Trabalho", "A minha conta"]);
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
