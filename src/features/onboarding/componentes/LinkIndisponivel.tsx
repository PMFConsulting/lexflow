import { LinkIndisponivelBase } from "@/components/link-indisponivel";
import { motivoDoAcesso, type AcessoOnboarding } from "../dados";

/**
 * O ecrã de um link de cliente que não abre.
 *
 * O desenho está em `@/components/link-indisponivel`, partilhado com o registo
 * da sociedade e o de cada pessoa da equipa — os três têm links mágicos e os
 * três falham pelas mesmas razões. O que fica aqui é a tradução dos estados
 * deste percurso para o que se lê no ecrã, que vem de `motivoDoAcesso` e é a
 * mesma frase que as Server Actions devolvem.
 */
export function LinkIndisponivel({ acesso }: { acesso: AcessoOnboarding }) {
  if (acesso.estado === "ok") return null;

  const { titulo, descricao, referencia } = motivoDoAcesso(acesso);

  return (
    <LinkIndisponivelBase
      estado={acesso.estado}
      titulo={titulo}
      descricao={descricao}
      referencia={referencia}
      contexto="Onboarding de cliente"
    />
  );
}
