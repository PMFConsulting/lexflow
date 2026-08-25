import { redirect } from "next/navigation";
import { acessoSociedadePorToken } from "@/features/sociedade/dados";
import { LinkIndisponivelSociedade } from "@/features/sociedade/componentes/LinkIndisponivelSociedade";

/** A raiz do link retoma onde a sociedade ficou. */
export default async function EntradaSociedade({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const acesso = await acessoSociedadePorToken((await params).token);
  if (acesso.estado !== "ok") return <LinkIndisponivelSociedade acesso={acesso} />;

  redirect(`/sociedade/${acesso.token}/passo/${acesso.onboarding.passoAtual}`);
}
