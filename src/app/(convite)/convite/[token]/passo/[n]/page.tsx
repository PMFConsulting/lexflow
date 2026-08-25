import { notFound, redirect } from "next/navigation";
import {
  aceitacaoDoConvite,
  acessoConvitePorToken,
  documentosDoConvite,
} from "@/features/convites/dados";
import { FormularioConvite } from "@/features/convites/componentes/FormularioConvite";
import { LinkIndisponivelConvite } from "@/features/convites/componentes/LinkIndisponivelConvite";
import { exerceAdvocacia, passoConvitePorNumero } from "@/features/convites/passos";
import { termosEmVigor } from "@/lib/termos-sociedade";

/** As colunas `date` chegam do Drizzle como string; o `<input type="date">` quer o mesmo. */
const dia = (v: string | null) => (v ? String(v).slice(0, 10) : null);

export default async function PassoConvite({
  params,
}: {
  params: Promise<{ token: string; n: string }>;
}) {
  const { token: recebido, n: bruto } = await params;
  const n = Number(bruto);

  const acesso = await acessoConvitePorToken(recebido);
  if (acesso.estado !== "ok") return <LinkIndisponivelConvite acesso={acesso} />;

  const { convite, perfil, org, token } = acesso;

  // Um número de passo inventado continua a ser 404 — aqui o link está bom e o
  // que está errado é o endereço. A ordem importa: a verificação do token vem
  // primeiro, para que um convite expirado com um passo impossível diga que
  // expirou, que é o problema real.
  if (!Number.isInteger(n) || !passoConvitePorNumero(n)) notFound();

  if (convite.estado === "aceite") redirect(`/convite/${token}/concluido`);

  const [documentos, aceitacao, emVigor] = await Promise.all([
    documentosDoConvite(convite.id),
    aceitacaoDoConvite(convite.id),
    termosEmVigor(org.id),
  ]);

  /*
   * O articulado que esta pessoa vai aceitar é o **mesmo** que os clientes da
   * sociedade aceitam.
   *
   * É a segunda metade do ponto 2 da revisão: o cliente lê os T&C da sociedade
   * no passo 7, e quem trabalha na sociedade lê-os aqui. Ambos por
   * `termosEmVigor`, que é a única função que sabe qual está de pé — se fossem
   * duas, o dia em que divergissem seria o dia em que a sociedade teria dois
   * articulados em vigor sem o saber.
   */
  const termos =
    emVigor.forma === "documento"
      ? {
          forma: "documento" as const,
          versao: emVigor.versao,
          nome: emVigor.nome,
          url: `/convite/${token}/termos`,
        }
      : emVigor;

  return (
    <FormularioConvite
      token={token}
      n={n}
      termos={termos}
      dados={{
        email: convite.email,
        nome: convite.nome,
        papel: convite.papel,
        exerce: exerceAdvocacia(convite.papel),
        sociedade: org.nome,
        perfil: perfil
          ? {
              nomeCompleto: perfil.nomeCompleto,
              dataNascimento: dia(perfil.dataNascimento),
              nif: perfil.nif,
              telefone: perfil.telefone,
              docTipo: perfil.docTipo,
              docNumero: perfil.docNumero,
              docValidade: dia(perfil.docValidade),
              morada: perfil.morada,
              pais: perfil.pais,
              localidade: perfil.localidade,
              codigoPostal: perfil.codigoPostal,
              freguesia: perfil.freguesia,
              concelho: perfil.concelho,
              distrito: perfil.distrito,
              cedulaProfissional: perfil.cedulaProfissional,
              conselhoRegional: perfil.conselhoRegional,
              dataInscricaoOa: dia(perfil.dataInscricaoOa),
              cargo: perfil.cargo,
              areasPratica: perfil.areasPratica,
              informacaoRgpdEm: perfil.informacaoRgpdEm,
              sigiloProfissional: perfil.sigiloProfissional,
              comunicacoesInternas: perfil.comunicacoesInternas,
            }
          : null,
        termosAceites: Boolean(aceitacao && aceitacao.versao === emVigor.versao),
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
