import { NextResponse } from "next/server";
import { autorizar, respostaErro } from "@/lib/api";
import {
  acessoPorToken,
  motivoDoAcesso,
  passosGravados,
  seccoesDoProcesso,
} from "@/features/onboarding/dados";
import { passosDoProcesso } from "@/features/onboarding/passos";

/**
 * O estado de um registo de cliente.
 *
 * É a primeira chamada que um bot faz: onde está a pessoa, o que já ficou
 * gravado, quais são os passos deste percurso. Sem isto, a única forma de
 * saber onde retomar era tentar gravar e ler o erro.
 *
 * **Não devolve os dados preenchidos.** Um registo de KYC tem morada, NIF,
 * documento de identificação e declaração de PPE lá dentro, e uma API de estado
 * não é sítio para os despejar — o que o bot precisa de saber é o que falta, e
 * é isso que sai daqui. Quem tem de ver os dados vê-os no dossier.
 */
export async function GET(
  pedido: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const auth = autorizar(pedido);
  if (!auth.ok) return auth.resposta;

  const acesso = await acessoPorToken((await params).token);
  if (acesso.estado !== "ok") {
    const { titulo, descricao } = motivoDoAcesso(acesso);
    return respostaErro(acesso.estado, `${titulo} ${descricao}`, 404);
  }

  const { processo } = acesso;
  const seccoes = await seccoesDoProcesso(processo.id);
  const percurso = passosDoProcesso(processo.tipoCliente);
  const gravados = passosGravados(seccoes, processo.tipoCliente);

  return NextResponse.json({
    ok: true,
    referencia: processo.referencia,
    tipoCliente: processo.tipoCliente,
    estado: processo.estado,
    passoAtual: processo.passoAtual,
    passosGravados: gravados,
    percurso: percurso.map((p) => ({
      n: p.n,
      chave: p.chave,
      titulo: p.titulo,
      descricao: p.descricao,
      gravado: gravados.includes(p.n),
    })),
    // Só os tipos e não os ficheiros: o bot precisa de saber o que falta
    // anexar, não de receber megabytes de base64.
    documentos: seccoes.documentos.map((d) => ({ tipo: d.tipo, nome: d.nome })),
  });
}
