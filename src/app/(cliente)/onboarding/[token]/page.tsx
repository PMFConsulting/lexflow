import { notFound, redirect } from "next/navigation";
import { processoPorToken } from "@/features/onboarding/dados";

/** A raiz do link mágico leva ao passo onde o cliente ficou. */
export default async function Entrada({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const processo = await processoPorToken(token);
  if (!processo) notFound();

  if (processo.estado === "submetido" || processo.estado === "aprovado") {
    redirect(`/onboarding/${token}/submetido`);
  }

  redirect(`/onboarding/${token}/passo/${processo.passoAtual}`);
}
