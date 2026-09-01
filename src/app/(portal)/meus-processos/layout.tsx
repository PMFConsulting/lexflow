import { PortalShell, ROTULO_DO_PAPEL } from "@/components/portal-shell";
import { exigirEquipaDaSociedade, podeVerEmails, portalDoPapel } from "@/lib/sessao";
import { navegacaoDoPapel } from "@/lib/navegacao";
import { redirect } from "next/navigation";
import { sociedadeDe, sociedadesPorIds } from "@/features/administracao/consultas";
import { contarNotificacoesNaoLidas } from "@/features/notificacoes/consultas";

/**
 * O portal de quem trabalha os processos.
 *
 * O `society_admin` é reencaminhado daqui para o back-office. Não é por não
 * poder ver isto — pode ver tudo o que aqui está —, é para não haver duas
 * portas de entrada para a mesma pessoa: o portal de cada papel é um só, e é o
 * que `portalDoPapel` diz.
 *
 * A barra lateral é a **mesma** do back-office: `navegacaoDoPapel(eu.papel)`,
 * de `@/lib/navegacao`. Aqui estava uma segunda lista, com duas entradas — "Os
 * meus processos" e "Clientes" —, e o resultado era uma barra que mudava de
 * conteúdo consoante a página: o `utilizador` aterrava em `/meus-processos`
 * sem «Processos», sem «Notificações» e sem «A minha conta», e recuperava as
 * três ao navegar para qualquer uma delas. O filtro por papel continua a ser o
 * mesmo e não abre nada: um `utilizador` não vê «Administração» nem «A minha
 * equipa» aqui, exatamente como não as vê lá.
 */

export const dynamic = "force-dynamic";

export default async function LayoutPortal({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { eu, outrasOrganizacoes } = await exigirEquipaDaSociedade();
  if (podeVerEmails(eu.papel)) redirect(portalDoPapel(eu.papel));

  // A contagem acompanha a entrada "Notificações" da barra: o sino do
  // cabeçalho é montado pelo `PortalShell` em todos os portais e, sem esta
  // consulta, mostrava zero aqui e o número certo nas outras páginas.
  const [org, contagemNotificacoes, outrasSociedades] = await Promise.all([
    sociedadeDe(eu.organizacaoId),
    contarNotificacoesNaoLidas(eu),
    sociedadesPorIds(outrasOrganizacoes),
  ]);
  const logotipoUrl = org?.logotipoDados
    ? `/api/sociedade/logotipo?t=${org.logotipoAtualizadoEm ? new Date(org.logotipoAtualizadoEm).getTime() : Date.now()}`
    : null;

  return (
    <PortalShell
      gruposDeMenu={navegacaoDoPapel(eu.papel)}
      cabecalho="Onboarding de clientes"
      legendaDaMarca="Processos"
      utilizador={{ nome: eu.nome, papel: ROTULO_DO_PAPEL[eu.papel] ?? eu.papel }}
      logotipoUrl={logotipoUrl}
      contagemNotificacoes={contagemNotificacoes}
      hrefNotificacoes="/notificacoes"
      sociedadeAtiva={{ id: eu.organizacaoId, nome: org?.nome ?? eu.organizacaoId }}
      outrasSociedades={outrasSociedades}
    >
      {children}
    </PortalShell>
  );
}
