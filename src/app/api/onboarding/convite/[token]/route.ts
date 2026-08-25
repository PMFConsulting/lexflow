import { NextResponse } from "next/server";
import { autorizar, respostaErro } from "@/lib/api";
import {
  aceitacaoDoConvite,
  acessoConvitePorToken,
  documentosDoConvite,
  motivoDoAcessoConvite,
  passosConviteGravados,
} from "@/features/convites/dados";
import { exerceAdvocacia, PASSOS_CONVITE } from "@/features/convites/passos";
import { termosEmVigor } from "@/lib/termos-sociedade";

/** O estado do registo de uma pessoa da equipa: onde está e o que falta. */
export async function GET(
  pedido: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const auth = autorizar(pedido);
  if (!auth.ok) return auth.resposta;

  const acesso = await acessoConvitePorToken((await params).token);
  if (acesso.estado !== "ok") {
    const { titulo, descricao } = motivoDoAcessoConvite(acesso);
    return respostaErro(acesso.estado, `${titulo} ${descricao}`, 404);
  }

  const { convite, perfil, org } = acesso;
  const [documentos, aceitacao, termos] = await Promise.all([
    documentosDoConvite(convite.id),
    aceitacaoDoConvite(convite.id),
    termosEmVigor(org.id),
  ]);

  const exerce = exerceAdvocacia(convite.papel);
  const gravados = passosConviteGravados(
    perfil,
    documentos.map((d) => d.tipo),
    Boolean(aceitacao),
    exerce,
  );

  return NextResponse.json({
    ok: true,
    sociedade: org.nome,
    email: convite.email,
    papel: convite.papel,
    /**
     * O papel decide se a cédula é obrigatória, e o bot precisa de o saber
     * **antes** de perguntar: pedir a cédula a um assistente é pedir um número
     * que ele não tem, e não pedir a um advogado é um passo que nunca fecha.
     */
    exerceAdvocacia: exerce,
    estado: convite.estado,
    passoAtual: convite.passoAtual,
    passosGravados: gravados,
    percurso: PASSOS_CONVITE.map((p) => ({
      n: p.n,
      chave: p.chave,
      titulo: p.titulo,
      descricao: p.descricao,
      gravado: gravados.includes(p.n),
    })),
    documentos: documentos.map((d) => ({ tipo: d.tipo, nome: d.nome })),
    termos: { versao: termos.versao, forma: termos.forma },
  });
}
