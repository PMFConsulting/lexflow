import { notFound, redirect } from "next/navigation";
import { acessoPorToken, seccoesDoProcesso } from "@/features/onboarding/dados";
import { Formulario } from "@/features/onboarding/componentes/Formulario";
import { LinkIndisponivel } from "@/features/onboarding/componentes/LinkIndisponivel";
import {
  passoAplicavel,
  passoPorNumero,
  proximoPasso,
} from "@/features/onboarding/passos";

export default async function PaginaPasso({
  params,
}: {
  params: Promise<{ token: string; n: string }>;
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

  return (
    <Formulario
      token={token}
      n={n}
      seccoes={seccoes}
      tipoCliente={processo.tipoCliente}
      referencia={processo.referencia}
    />
  );
}
