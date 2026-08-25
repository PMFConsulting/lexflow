import { NextResponse } from "next/server";
import { autorizar, respostaErro } from "@/lib/api";
import {
  acessoSociedadePorToken,
  documentosDaSociedade,
  motivoDoAcessoSociedade,
  passosSociedadeGravados,
} from "@/features/sociedade/dados";
import { PASSOS_SOCIEDADE } from "@/features/sociedade/passos";

/** O estado do registo de uma sociedade: onde está e o que falta. */
export async function GET(
  pedido: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const auth = autorizar(pedido);
  if (!auth.ok) return auth.resposta;

  const acesso = await acessoSociedadePorToken((await params).token);
  if (acesso.estado !== "ok") {
    const { titulo, descricao } = motivoDoAcessoSociedade(acesso);
    return respostaErro(acesso.estado, `${titulo} ${descricao}`, 404);
  }

  const { onboarding, org } = acesso;
  const documentos = await documentosDaSociedade(org.id);
  const gravados = passosSociedadeGravados(
    org,
    onboarding,
    documentos.map((d) => d.tipo),
  );

  return NextResponse.json({
    ok: true,
    sociedade: org.nome,
    estado: onboarding.estado,
    passoAtual: onboarding.passoAtual,
    passosGravados: gravados,
    percurso: PASSOS_SOCIEDADE.map((p) => ({
      n: p.n,
      chave: p.chave,
      titulo: p.titulo,
      descricao: p.descricao,
      gravado: gravados.includes(p.n),
    })),
    documentos: documentos.map((d) => ({ tipo: d.tipo, nome: d.nome })),
    termosVersao: org.termosVersao,
  });
}
