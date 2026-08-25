import { LinkIndisponivelBase } from "@/components/link-indisponivel";
import { motivoDoAcessoSociedade, type AcessoSociedade } from "../dados";

export function LinkIndisponivelSociedade({ acesso }: { acesso: AcessoSociedade }) {
  if (acesso.estado === "ok") return null;

  const { titulo, descricao, referencia } = motivoDoAcessoSociedade(acesso);

  return (
    <LinkIndisponivelBase
      estado={acesso.estado}
      titulo={titulo}
      descricao={descricao}
      referencia={referencia}
      rotuloReferencia="Sociedade"
      contexto="Registo da sociedade"
    />
  );
}
