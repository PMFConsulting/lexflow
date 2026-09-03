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
  sessaoAtual,
} from "@/lib/sessao";
import { registarEvento } from "@/features/auditoria/registar";
import { DetalheProcesso } from "@/features/processos/componentes/DetalheProcesso";

export const dynamic = "force-dynamic";

/**
 * O título do separador leva a referência do processo.
 *
 * Sem isto, cada detalhe abria como "LexFlow — Processos" (o `default` do
 * layout de raiz): com meia dúzia de processos abertos em separadores, todos
 * se chamavam o mesmo, e o histórico do browser guardava-os todos com o
 * mesmo nome. A referência é o identificador por que o processo é procurado
 * em todo o lado — é ela que aqui serve.
 *
 * Um `id` que não resolve devolve o título genérico e não `notFound()`: quem
 * decide que a página não existe é a página, e uma exceção lançada daqui
 * trocava o ecrã de 404 por um erro.
 *
 * A referência **só sai depois da mesma verificação que a página faz**. Sem
 * isso, o título do separador era uma via lateral para ler a referência de um
 * processo de outra sociedade: o `generateMetadata` corre no seu próprio
 * pedido, o guard do componente não o cobre, e um `id` adivinhado devolvia
 * `Processo XX-2026-0007` a quem nunca teria a página.
 *
 * `sessaoAtual()` e não `exigirEquipaOuSuperAdmin()`: os guards redirecionam, e
 * um redirect lançado de dentro do `generateMetadata` estraga o ecrã que a
 * página ia mostrar. Aqui a falta de sessão vale o título genérico — a página,
 * essa, continua a recusar o acesso por si.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const generico = { title: "Processo" };

  const sessao = await sessaoAtual();
  if (!sessao) return generico;

  const processo = await processoPorId(id);
  if (!processo) return generico;

  const superAdmin = sessao.eu.papel === "super_admin";
  if (!superAdmin && processo.organizacaoId !== sessao.eu.organizacaoId) return generico;

  return { title: `Processo ${processo.referencia}` };
}

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
