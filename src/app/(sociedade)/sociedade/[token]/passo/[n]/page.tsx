import { notFound, redirect } from "next/navigation";
import {
  acessoSociedadePorToken,
  documentosDaSociedade,
} from "@/features/sociedade/dados";
import { FormularioSociedade } from "@/features/sociedade/componentes/FormularioSociedade";
import { LinkIndisponivelSociedade } from "@/features/sociedade/componentes/LinkIndisponivelSociedade";
import { passoSociedadePorNumero } from "@/features/sociedade/passos";

export default async function PassoSociedade({
  params,
}: {
  params: Promise<{ token: string; n: string }>;
}) {
  const { token: recebido, n: bruto } = await params;
  const n = Number(bruto);

  const acesso = await acessoSociedadePorToken(recebido);
  if (acesso.estado !== "ok") return <LinkIndisponivelSociedade acesso={acesso} />;

  const { onboarding, org, token } = acesso;

  // Um número de passo inventado continua a ser 404, e é o que deve ser: aqui o
  // link está bom e o que está errado é o endereço. A ordem importa — a
  // verificação do token vem primeiro, para que um link expirado com um passo
  // impossível diga que expirou, que é o problema real.
  if (!Number.isInteger(n) || !passoSociedadePorNumero(n)) notFound();

  if (onboarding.estado !== "rascunho") redirect(`/sociedade/${token}/submetido`);

  const documentos = await documentosDaSociedade(org.id);

  return (
    <FormularioSociedade
      token={token}
      n={n}
      dados={{
        nome: org.nome,
        nif: org.nif,
        naturezaJuridica: org.naturezaJuridica,
        numeroOrdem: org.numeroOrdem,
        prefixoReferencia: org.prefixoReferencia,
        emailGeral: org.emailGeral,
        telefone: org.telefone,
        website: org.website,
        morada: org.morada,
        pais: org.pais,
        localidade: org.localidade,
        codigoPostal: org.codigoPostal,
        freguesia: org.freguesia,
        concelho: org.concelho,
        distrito: org.distrito,
        termosVersao: org.termosVersao,
        termosAtualizadoEm: org.termosAtualizadoEm,
        adminNome: onboarding.adminNome,
        adminEmail: onboarding.adminEmail,
        adminTelefone: onboarding.adminTelefone,
        declaracaoNome: onboarding.declaracaoNome,
        declaracaoCargo: onboarding.declaracaoCargo,
        declaracaoVinculo: onboarding.declaracaoVinculo,
      }}
      anexos={documentos.map((d) => ({
        id: d.id,
        nome: d.nome,
        tipo: d.tipo,
        bytes: d.bytes,
      }))}
    />
  );
}
