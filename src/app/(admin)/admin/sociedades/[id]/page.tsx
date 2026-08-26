import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Ref } from "@/components/ref-processo";
import { EditarSociedade } from "@/features/plataforma/componentes/EditarSociedade";
import { EmailsDaSociedade } from "@/features/plataforma/componentes/EmailsDaSociedade";
import { GestaoUtilizadores } from "@/features/plataforma/componentes/GestaoUtilizadores";
import { sociedadePorId, utilizadoresDaSociedade } from "@/features/plataforma/consultas";
import { env } from "@/env";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sociedade = await sociedadePorId(id);
  return { title: sociedade?.nome ?? "Sociedade" };
}

/**
 * Uma sociedade: os dados dela e as contas que tem.
 *
 * A gestão de contas é o **mesmo componente** que o `society_admin` usa em
 * `/utilizadores`. Não é economia de código: dois ecrãs com as mesmas regras
 * escritas duas vezes divergem, e o que diverge é sempre o que tem menos olhos
 * em cima.
 */
export default async function Sociedade({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const sociedade = await sociedadePorId(id);
  if (!sociedade) notFound();

  const contas = await utilizadoresDaSociedade(id);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div>
        <Link
          href="/admin/sociedades"
          className="text-muted-foreground hover:text-tinta inline-flex items-center gap-1.5 text-xs"
        >
          <ArrowLeft className="size-3.5" /> Sociedades
        </Link>
        <h1 className="mt-2 text-2xl">{sociedade.nome}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
          <Ref>{sociedade.prefixoReferencia}</Ref>
          <span aria-hidden>·</span>
          <Ref>NIPC {sociedade.nif}</Ref>
        </p>
      </div>

      <EditarSociedade
        id={sociedade.id}
        inicial={{
          nome: sociedade.nome,
          nif: sociedade.nif,
          prefixoReferencia: sociedade.prefixoReferencia,
        }}
      />

      {/*
        O remetente global vem do ambiente e é lido **aqui**, no servidor: é o
        valor de recuo de quem não configurou nada, e mostrá-lo é o que impede a
        leitura errada de um campo vazio — que é «esta sociedade não envia
        emails». O `env()` é preguiçoso (D11) e esta página é `force-dynamic`,
        por isso a leitura não entra no build.
      */}
      <EmailsDaSociedade
        id={sociedade.id}
        inicial={{
          emailRemetente: sociedade.emailRemetente,
          dominioEmail: sociedade.dominioEmail,
          dominioResendId: sociedade.dominioResendId,
          dominioEstado: sociedade.dominioEstado,
          dominioVerificadoEm: sociedade.dominioVerificadoEm,
        }}
        remetenteGlobal={env().EMAIL_REMETENTE}
      />

      <GestaoUtilizadores organizacaoId={sociedade.id} contas={contas} />
    </div>
  );
}
