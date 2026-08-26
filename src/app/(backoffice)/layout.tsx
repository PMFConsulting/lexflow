import { FileText, LayoutDashboard, Mail, Settings, Users, UserCog } from "lucide-react";
import { PortalShell, ROTULO_DO_PAPEL, type EntradaDeMenu } from "@/components/portal-shell";
import { exigirEquipaDaSociedade, podeVerEmails } from "@/lib/sessao";

/**
 * O portal da sociedade.
 *
 * Entram os dois papéis que trabalham dentro de uma sociedade — o
 * `society_admin` e o `utilizador` — e é `exigirEquipaDaSociedade` que o diz:
 * o `super_admin` é reencaminhado daqui para `/admin`, que é o portal dele.
 *
 * A separação entre os dois que entram **não é** de processos: os dois veem
 * processos e clientes, e é o mesmo trabalho. O que os separa é a
 * administração — emails, configuração e contas —, e por isso essas três
 * entradas saem da barra para o `utilizador`. Sair da barra é cortesia; o que
 * fecha os endereços é o `exigirSocietyAdmin()` em cada uma dessas páginas.
 */

type Entrada = EntradaDeMenu & {
  /** Entradas sem nenhum dos dois são para toda a equipa da sociedade. */
  soAdmin?: boolean;
  soUtilizador?: boolean;
};

/**
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
    soUtilizador: true,
  },
  { titulo: "Processos", href: "/processos", icone: FileText },
  { titulo: "Clientes", href: "/clientes", icone: Users },
  { titulo: "Utilizadores", href: "/utilizadores", icone: UserCog, soAdmin: true },
  { titulo: "Emails", href: "/emails", icone: Mail, soAdmin: true },
  { titulo: "Configuração", href: "/configuracao", icone: Settings, soAdmin: true },
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

  const admin = podeVerEmails(eu.papel);
  const entradas = NAVEGACAO.filter(
    (item) => (!item.soAdmin || admin) && (!item.soUtilizador || !admin),
  );

  return (
    <PortalShell
      entradas={entradas}
      grupo="Onboarding"
      cabecalho="Onboarding de clientes"
      legendaDaMarca="Processos"
      utilizador={{ nome: eu.nome, papel: ROTULO_DO_PAPEL[eu.papel] ?? eu.papel }}
    >
      {children}
    </PortalShell>
  );
}
