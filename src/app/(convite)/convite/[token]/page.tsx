import { redirect } from "next/navigation";
import { acessoConvitePorToken } from "@/features/convites/dados";
import { LinkIndisponivelConvite } from "@/features/convites/componentes/LinkIndisponivelConvite";

/** A raiz do link retoma onde a pessoa ficou. */
export default async function EntradaConvite({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const acesso = await acessoConvitePorToken((await params).token);
  if (acesso.estado !== "ok") return <LinkIndisponivelConvite acesso={acesso} />;

  redirect(`/convite/${acesso.token}/passo/${acesso.convite.passoAtual}`);
}
