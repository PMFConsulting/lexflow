import { notFound, redirect } from "next/navigation";
import { processoPorToken, seccoesDoProcesso } from "@/features/onboarding/dados";
import { Formulario } from "@/features/onboarding/componentes/Formulario";
import { passoAplicavel, passoPorNumero, proximoPasso } from "@/features/onboarding/passos";

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
  const procurador =
    (seccoes.identificacao?.extra as { representadoPorProcurador?: boolean } | null)
      ?.representadoPorProcurador ?? false;

  const ctx = { tipoCliente: processo.tipoCliente, representadoPorProcurador: procurador };

  // Um passo que não se aplica não é um erro: salta-se para o seguinte em vez
  // de mostrar 404 a quem escreveu o URL à mão ou usou o botão de voltar.
  if (!passoAplicavel(n, ctx)) {
    const seguinte = proximoPasso(n, ctx) ?? 1;
    redirect(`/onboarding/${token}/passo/${seguinte}`);
  }

  return (
    <Formulario
      token={token}
      n={n}
      seccoes={seccoes}
      tipoCliente={processo.tipoCliente}
      representadoPorProcurador={procurador}
    />
  );
}
