import { notFound, redirect } from "next/navigation";
import { estadoDoCodigo } from "@/features/onboarding/acoes";
import {
  acessoPorToken,
  passosGravados,
  seccoesDoProcesso,
} from "@/features/onboarding/dados";
import { Formulario } from "@/features/onboarding/componentes/Formulario";
import { LinkIndisponivel } from "@/features/onboarding/componentes/LinkIndisponivel";
import {
  passoAplicavel,
  passoPorNumero,
  passosDoProcesso,
  proximoPasso,
  ultimoPasso,
} from "@/features/onboarding/passos";

export default async function PaginaPasso({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; n: string }>;
  /**
   * Lido no servidor e passado como prop, em vez de `useSearchParams()` no
   * cliente: o hook empurra o componente para uma fronteira de Suspense e faz
   * do parâmetro uma afirmação do browser. Aqui o parâmetro é uma sugestão que
   * se confirma contra o estado do processo antes de valer alguma coisa.
   */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token: recebido, n: bruto } = await params;
  const n = Number(bruto);

  const acesso = await acessoPorToken(recebido);
  if (acesso.estado !== "ok") return <LinkIndisponivel acesso={acesso} />;

  const { processo, token } = acesso;

  // Um número de passo inventado continua a ser 404, e é o que deve ser: aqui
  // o link está bom e o que está errado é o endereço. A ordem importa — a
  // verificação do token vem primeiro para que um link expirado com um passo
  // impossível diga que expirou, que é o problema que o cliente tem de facto.
  if (!Number.isInteger(n) || !passoPorNumero(n)) notFound();

  if (
    processo.estado === "submetido" ||
    processo.estado === "aguardar_aprovacao" ||
    processo.estado === "aprovado"
  ) {
    redirect(`/onboarding/${token}/submetido`);
  }

  // O passo do Representante Legal não existe para pessoas singulares. Um link
  // guardado de quando o processo ainda era de empresa segue para a frente em
  // vez de dar 404: o cliente não fez nada de errado.
  if (!passoAplicavel(n, processo.tipoCliente)) {
    redirect(`/onboarding/${token}/passo/${proximoPasso(n, processo.tipoCliente) ?? 1}`);
  }

  const seccoes = await seccoesDoProcesso(processo.id);

  /*
   * "Vim da revisão para corrigir" é uma afirmação do URL, e um URL não é fonte
   * de verdade sobre nada.
   *
   * Confirma-se contra o processo: só se aceita o regresso ao fecho quando o
   * fecho é de facto alcançável, ou seja, quando todos os passos anteriores
   * deste percurso já estão gravados. Sem esta confirmação, escrever
   * `?regresso=fecho` no passo 1 de um processo acabado de abrir mandava o
   * cliente, ao guardar, para um ecrã de revisão de um formulário vazio — que é
   * um beco, e um beco que ele próprio não sabe que abriu.
   *
   * O último passo não se corrige a si próprio: no fecho o parâmetro não faz
   * sentido nenhum e é ignorado.
   */
  const feitos = new Set(passosGravados(seccoes, processo.tipoCliente));
  const fechoAlcancavel = passosDoProcesso(processo.tipoCliente)
    .filter((p) => p.n < ultimoPasso(processo.tipoCliente))
    .every((p) => feitos.has(p.n));

  const { regresso } = await searchParams;
  const voltarAoFecho =
    regresso === "fecho" && n !== ultimoPasso(processo.tipoCliente) && fechoAlcancavel;

  // Só o fecho precisa do estado do código; nos outros passos poupa-se a
  // consulta e passa-se o estado vazio, que é o que ele é.
  const otp =
    n === ultimoPasso(processo.tipoCliente)
      ? await estadoDoCodigo(token)
      : { verificado: false, pedido: false, para: null };

  return (
    <Formulario
      token={token}
      n={n}
      seccoes={seccoes}
      tipoCliente={processo.tipoCliente}
      referencia={processo.referencia}
      otp={otp}
      voltarAoFecho={voltarAoFecho}
    />
  );
}
