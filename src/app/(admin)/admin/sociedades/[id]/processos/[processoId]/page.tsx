import { notFound } from "next/navigation";
import { auditoriaDoProcesso } from "@/features/auditoria/consultas";
import { registarEvento } from "@/features/auditoria/registar";
import {
  assinaturaDoProcesso,
  seccoesDoProcesso,
} from "@/features/onboarding/dados";
import { emailsDoProcesso } from "@/features/emails/consultas";
import { DetalheProcesso } from "@/features/processos/componentes/DetalheProcesso";
import {
  documentosDoProcesso,
  processoPorId,
  propostaDoProcesso,
} from "@/features/processos/consultas";
import { sociedadePorId } from "@/features/plataforma/consultas";
import { exigirSuperAdmin, podeAprovarProcesso, podeVerPpe } from "@/lib/sessao";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; processoId: string }>;
}) {
  const { processoId } = await params;
  const processo = await processoPorId(processoId);
  return { title: processo ? `Processo ${processo.referencia}` : "Processo" };
}

export default async function DetalheProcessoSociedadeAdmin({
  params,
}: {
  params: Promise<{ id: string; processoId: string }>;
}) {
  const { id, processoId } = await params;
  const { eu } = await exigirSuperAdmin();

  const sociedade = await sociedadePorId(id);
  if (!sociedade) notFound();

  const processo = await processoPorId(processoId);
  if (!processo || processo.organizacaoId !== id) notFound();

  const [s, docs, eventos, emails, assinatura, proposta] = await Promise.all([
    seccoesDoProcesso(processo.id),
    documentosDoProcesso(processo.id),
    auditoriaDoProcesso(processo.id),
    // A sociedade vem do processo já confirmado contra o `id` do URL, três
    // linhas acima — não de quem lê, que aqui é o `super_admin` e não pertence
    // a nenhuma.
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
      caminhoVoltar={`/admin/sociedades/${id}`}
      textoVoltar={sociedade.nome}
      papelAtual={eu.papel}
    />
  );
}
