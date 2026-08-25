import { LinkIndisponivelBase } from "@/components/link-indisponivel";
import { motivoDoAcessoConvite, type AcessoConvite } from "../dados";

export function LinkIndisponivelConvite({ acesso }: { acesso: AcessoConvite }) {
  if (acesso.estado === "ok") return null;

  const { titulo, descricao, referencia } = motivoDoAcessoConvite(acesso);

  // Um convite cancelado é, para o ecrã, o mesmo desenho de um registo
  // arquivado: a informação foi retirada por decisão de alguém, e a saída é
  // falar com essa pessoa. O texto é que os distingue, e é ele que importa.
  const estado = acesso.estado === "cancelado" ? "arquivado" : acesso.estado;

  return (
    <LinkIndisponivelBase
      estado={estado}
      titulo={titulo}
      descricao={descricao}
      referencia={referencia}
      rotuloReferencia="Sociedade"
      contexto="Registo de utilizador"
    />
  );
}
