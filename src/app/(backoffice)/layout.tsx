import { PortalShell, ROTULO_DO_PAPEL } from "@/components/portal-shell";
import { exigirEquipaDaSociedade } from "@/lib/sessao";
import { navegacaoDoPapel } from "@/lib/navegacao";
import { sociedadeDe, sociedadesPorIds } from "@/features/administracao/consultas";
import { contarNotificacoesNaoLidas } from "@/features/notificacoes/consultas";

/**
 * O portal da sociedade.
 *
 * Entram os dois papéis que trabalham dentro de uma sociedade — o
 * `society_admin` e o `utilizador` — e é `exigirEquipaDaSociedade` que o diz:
 * o `super_admin` é reencaminhado daqui para `/admin`, que é o portal dele, e
 * por isso não tem entrada nenhuma nesta barra a filtrar por ele — não há
 * papel que a alcance.
 *
 * A separação entre os dois que entram **não é** de processos: os dois veem
 * processos e clientes, e é o mesmo trabalho. O que os separa é a
 * administração — e por isso essas entradas saem da barra para o
 * `utilizador`. Sair da barra é cortesia; o que fecha os endereços é o
 * `exigirSocietyAdmin()` em cada uma dessas páginas.
 *
 * BUG3-011: "Painel" tinha `soAdmin: true` filtrado por `podeVerEmails`, que
 * responde a outra pergunta ("quem vê `/emails`?") e por coincidência dá
 * `true` só para `society_admin` — testava o papel certo pela função errada,
 * e o dia em que `podeVerEmails` mudasse de critério partia esta barra sem
 * ninguém tocar nela. "Os meus processos" não tinha filtro nenhum e aparecia
 * a todos os três papéis, incluindo ao `society_admin`, que não tem processos
 * "seus" separados dos da sociedade. Painel desapareceu da barra (o
 * `society_admin` continua a aterrar em "/" depois de entrar —
 * `portalDoPapel`; só deixa de estar fixo na barra) e "Os meus processos"
 * passou a exigir `utilizador`.
 *
 * As entradas e o filtro por papel vivem em `@/lib/navegacao`: esta barra é
 * montada por dois layouts — este e o do portal `/meus-processos` — e a lista
 * tem de ser uma só (ver o comentário nesse ficheiro).
 */

/**
 * Nada aqui é pré-renderizável: cada página depende da sessão de quem a abre.
 * Sem isto, o `next build` tentava gerar o painel em estático e batia na
 * leitura das variáveis de ambiente.
 */
export const dynamic = "force-dynamic";

export default async function LayoutBackoffice({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Guard num sítio só: todas as páginas do back-office passam por aqui, e é
  // o que impede que uma página nova nasça aberta por esquecimento.
  const { eu, outrasOrganizacoes } = await exigirEquipaDaSociedade();
  const [org, contagemNotificacoes, outrasSociedades] = await Promise.all([
    sociedadeDe(eu.organizacaoId),
    contarNotificacoesNaoLidas(eu),
    // BUG3-002: só consulta nomes quando há de facto outra sociedade — o
    // caso comum (uma conta, uma sociedade) não paga este SELECT extra.
    sociedadesPorIds(outrasOrganizacoes),
  ]);

  const grupos = navegacaoDoPapel(eu.papel);

  const logotipoUrl = org?.logotipoDados
    ? `/api/sociedade/logotipo?t=${org.logotipoAtualizadoEm ? new Date(org.logotipoAtualizadoEm).getTime() : 0}`
    : null;

  return (
    <PortalShell
      gruposDeMenu={grupos}
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
