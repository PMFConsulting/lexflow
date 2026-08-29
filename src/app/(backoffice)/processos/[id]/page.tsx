import { notFound } from "next/navigation";
import { auditoriaDoProcesso } from "@/features/auditoria/consultas";
import { emailsDoProcesso } from "@/features/emails/consultas";
import {
  documentosDoProcesso,
  processoPorId,
  propostaDoProcesso,
} from "@/features/processos/consultas";
import {
  assinaturaDoProcesso,
  seccoesDoProcesso,
} from "@/features/onboarding/dados";
import {
  exigirEquipaOuSuperAdmin,
  podeAprovarProcesso,
  podeReabrirProcesso,
  podeReenviarLinkProcesso,
  podeVerPpe,
} from "@/lib/sessao";
import { registarEvento } from "@/features/auditoria/registar";
import { DetalheProcesso } from "@/features/processos/componentes/DetalheProcesso";

export const dynamic = "force-dynamic";

export default async function Processo({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { eu } = await exigirEquipaOuSuperAdmin();
  const superAdmin = eu.papel === "super_admin";

  const processo = await processoPorId(id);
  if (
    !processo ||
    (!superAdmin && processo.organizacaoId !== eu.organizacaoId)
  ) {
    notFound();
  }

  // BUG3-001: o gestor é equipa da sociedade, não dono de processos — vê o
  // mesmo detalhe que society_admin e utilizador veem, sem o filtro por
  // responsavel_id que nunca tinha dados para comparar (ver processos/page.tsx).

  const [s, docs, eventos, emails, assinatura, proposta] = await Promise.all([
    seccoesDoProcesso(processo.id),
    documentosDoProcesso(processo.id),
    auditoriaDoProcesso(processo.id),
    emailsDoProcesso(processo.id, processo.organizacaoId),
    assinaturaDoProcesso(processo.id),
    propostaDoProcesso(processo.id),
  ]);

  const vePpe = podeVerPpe(eu.papel);
  const podeAprovar = podeAprovarProcesso(eu.papel);
  const podeReabrir = podeReabrirProcesso(eu.papel);
  const podeReenviarLink = podeReenviarLinkProcesso(eu.papel);

  await registarEvento({
    organizacaoId: processo.organizacaoId,
    processoId: processo.id,
    atorId: eu.id,
    acao: vePpe ? "processo.consultado" : "processo.consultado.sem_ppe",
    entidade: "processo_onboarding",
    entidadeId: processo.id,
    valorNovo: { papel: eu.papel },
  });

  return (
    <DetalheProcesso
      processo={processo}
      seccoes={s}
      documentos={docs}
      eventos={eventos}
      emails={emails}
      assinatura={assinatura}
      proposta={proposta}
      vePpe={vePpe}
      podeAprovar={podeAprovar}
      podeReabrir={podeReabrir}
      podeReenviarLink={podeReenviarLink}
      podeEditar={true}
      caminhoVoltar="/processos"
      textoVoltar="Processos"
      papelAtual={eu.papel}
    />
  );
}
