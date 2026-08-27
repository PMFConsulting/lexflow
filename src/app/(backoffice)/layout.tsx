import { Building2, FileText, LayoutDashboard, Mail, Settings, UserRound, Users } from "lucide-react";
import { PortalShell, ROTULO_DO_PAPEL, type EntradaDeMenu } from "@/components/portal-shell";
import { exigirEquipaDaSociedade, podeVerEmails } from "@/lib/sessao";
import { sociedadeDe } from "@/features/administracao/consultas";

/**
 * O portal da sociedade.
 *
 * Entram os dois papéis que trabalham dentro de uma sociedade — o
 * `society_admin` e o `utilizador` — e é `exigirEquipaDaSociedade` que o diz:
 * o `super_admin` é reencaminhado daqui para `/admin`, que é o portal dele.
 *
 * A separação entre os dois que entram **não é** de processos: os dois veem
 * processos e clientes, e é o mesmo trabalho. O que os separa é a
 * administração — emails, configuração e contas —, e por isso essas entradas
 * saem da barra para o `utilizador`. Sair da barra é cortesia; o que fecha os
 * endereços é o `exigirSocietyAdmin()` em cada uma dessas páginas.
 */

type Entrada = EntradaDeMenu & {
  /** Entradas só para o administrador da sociedade. */
  soAdmin?: boolean;
  /** Entradas só para o papel de gestor. */
  soGestor?: boolean;
};

/**
 * O trabalho sobre clientes.
 *
 * As duas primeiras entradas são a mesma coisa em sítios diferentes: a página
 * de entrada de cada papel. Sem a segunda, um `utilizador` que abrisse
 * `/processos` a partir da barra ficava sem forma de voltar ao portal dele a
 * não ser pelo logótipo.
 */
const NAVEGACAO: Entrada[] = [
  { titulo: "Painel", href: "/", icone: LayoutDashboard, soAdmin: true },
  {
    titulo: "Os meus processos",
    href: "/meus-processos",
    icone: LayoutDashboard,
  },
  { titulo: "Processos", href: "/processos", icone: FileText },
  { titulo: "A minha equipa", href: "/equipa", icone: Users, soGestor: true },
  { titulo: "Clientes", href: "/clientes", icone: Users },
  { titulo: "Emails", href: "/emails", icone: Mail, soAdmin: true },
  { titulo: "Configuração", href: "/configuracao", icone: Settings },
];

/**
 * A sociedade e a pessoa — um grupo à parte, e não mais entradas na lista de
 * cima.
 *
 * São coisas de natureza diferente: acima está o trabalho sobre clientes,
 * aqui está quem trabalha. Misturá-las dava uma barra lateral em que
 * «Utilizadores» aparecia a seguir a «Clientes», e essas duas palavras já são
 * difíceis de distinguir sem as pôr lado a lado.
 *
 * «A minha conta» é o portal de cada pessoa da equipa: é onde um advogado sem
 * funções de administração vai buscar o que lhe diz respeito. «Administração»
 * é o portal de gestão da sociedade (T&C, conformidade, convites) — só para o
 * `society_admin`.
 */
const NAVEGACAO_SOCIEDADE: Entrada[] = [
  { titulo: "A minha conta", href: "/advogado", icone: UserRound },
  { titulo: "Administração", href: "/gestao", icone: Building2, soAdmin: true },
];

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
  const { eu } = await exigirEquipaDaSociedade();
  const org = await sociedadeDe(eu.organizacaoId);

  const isGestor = eu.papel === "gestor";
  const admin = podeVerEmails(eu.papel);
  const entradas = NAVEGACAO.filter((item) => {
    if (item.soAdmin && !admin) return false;
    if (item.soGestor && !isGestor) return false;
    return true;
  });
  const entradasSociedade = NAVEGACAO_SOCIEDADE.filter((item) => {
    if (item.soAdmin && !admin) return false;
    if (item.soGestor && !isGestor) return false;
    return true;
  });

  const logotipoUrl = org?.logotipoDados
    ? `/api/sociedade/logotipo?t=${org.logotipoAtualizadoEm ? new Date(org.logotipoAtualizadoEm).getTime() : Date.now()}`
    : null;

  return (
    <PortalShell
      entradas={[...entradasSociedade, ...entradas]}
      grupo="Onboarding"
      cabecalho="Onboarding de clientes"
      legendaDaMarca="Processos"
      utilizador={{ nome: eu.nome, papel: ROTULO_DO_PAPEL[eu.papel] ?? eu.papel }}
      logotipoUrl={logotipoUrl}
    >
      {children}
    </PortalShell>
  );
}
