"use client";

import { LeitorTermos as LeitorBase, type TermosParaLer } from "@/components/leitor-termos";

/**
 * Os Termos e Condições no passo 7 do cliente.
 *
 * O leitor está em `@/components/leitor-termos`, partilhado com o registo de
 * cada pessoa da equipa — que aceita exatamente o mesmo articulado, que é o
 * ponto 2 da revisão do cliente. O que fica aqui é a ligação: qual documento
 * está em vigor (resolvido no servidor por `termosEmVigor`) e onde ele abre em
 * separador próprio.
 */
export function LeitorTermos({
  termos,
  lido,
  aoLer,
  hrefExterno = "/termos-condicoes",
}: {
  termos: TermosParaLer;
  lido: boolean;
  aoLer: () => void;
  hrefExterno?: string;
}) {
  return (
    <LeitorBase termos={termos} lido={lido} aoLer={aoLer} hrefExterno={hrefExterno} />
  );
}
