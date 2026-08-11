import { redirect } from "next/navigation";
import { acessoPorToken } from "@/features/onboarding/dados";
import { LinkIndisponivel } from "@/features/onboarding/componentes/LinkIndisponivel";

/** A raiz do link mágico leva ao passo onde o cliente ficou. */
export default async function Entrada({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const acesso = await acessoPorToken((await params).token);
  // Um link que não abre diz porquê. O `notFound()` que aqui estava respondia
  // "esta página não existe" a um endereço que a sociedade tinha enviado.
  if (acesso.estado !== "ok") return <LinkIndisponivel acesso={acesso} />;

  // O token **normalizado**, e não o que veio no URL: se o endereço trazia um
  // ponto final colado da frase do email, é aqui que ele sai da barra do
  // browser em vez de ser arrastado por todos os passos seguintes.
  const { processo, token } = acesso;

  if (
    processo.estado === "submetido" ||
    processo.estado === "aguardar_aprovacao" ||
    processo.estado === "aprovado"
  ) {
    redirect(`/onboarding/${token}/submetido`);
  }

  redirect(`/onboarding/${token}/passo/${processo.passoAtual}`);
}
