import { notFound, redirect } from "next/navigation";
import { processoPorToken, seccoesDoProcesso } from "@/features/onboarding/dados";
import { Formulario } from "@/features/onboarding/componentes/Formulario";
import { passoPorNumero } from "@/features/onboarding/passos";

export default async function PaginaPasso({
  params,
}: {
  params: Promise<{ token: string; n: string }>;
}) {
  const { token, n: bruto } = await params;
  const n = Number(bruto);

  if (!Number.isInteger(n) || !passoPorNumero(n)) notFound();

  const processo = await processoPorToken(token);
  if (!processo) notFound();

  if (processo.estado === "submetido" || processo.estado === "aprovado") {
    redirect(`/onboarding/${token}/submetido`);
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
