import { notFound } from "next/navigation";
import { auditoriaDoProcesso } from "@/features/auditoria/consultas";
import { emailsDoProcesso } from "@/features/emails/consultas";
import {
  documentosDoProcesso,
  gestorPodeVerProcesso,
  processoPorId,
  propostaDoProcesso,
} from "@/features/processos/consultas";
import {
  assinaturaDoProcesso,
  seccoesDoProcesso,
} from "@/features/onboarding/dados";
import { exigirEquipaDaSociedade, podeAprovarProcesso, podeVerPpe } from "@/lib/sessao";
import { registarEvento } from "@/features/auditoria/registar";
import { DetalheProcesso } from "@/features/processos/componentes/DetalheProcesso";

export const dynamic = "force-dynamic";

export default async function Processo({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { eu } = await exigirEquipaDaSociedade();

  const processo = await processoPorId(id);
  if (!processo || processo.organizacaoId !== eu.organizacaoId) notFound();

  if (eu.papel === "gestor") {
    const podeVer = await gestorPodeVerProcesso(processo.id, eu.id, eu.organizacaoId);
    if (!podeVer) notFound();
  }

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
      podeEditar={true}
      caminhoVoltar="/processos"
      textoVoltar="Processos"
      papelAtual={eu.papel}
    />
  );
}
