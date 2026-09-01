import { Bell, Building2, FileText, LayoutDashboard, UserRound, Users } from "lucide-react";
import { PortalShell, ROTULO_DO_PAPEL, type EntradaDeMenu } from "@/components/portal-shell";
import { exigirEquipaDaSociedade, type Papel } from "@/lib/sessao";
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
 */

type Entrada = EntradaDeMenu & {
  /** Entradas só para o administrador da sociedade. */
  soSocietyAdmin?: boolean;
  /** Entradas só para o papel de gestor. */
  soGestor?: boolean;
  /** Entradas só para o papel de utilizador. */
  soUtilizador?: boolean;
};

/**
 * O trabalho sobre clientes.
 *
 * "Os meus processos" é a página de entrada do `utilizador` — sem ela, um
 * `utilizador` que abrisse `/processos` a partir da barra ficava sem forma de
 * voltar ao portal dele a não ser pelo logótipo.
 */
const NAVEGACAO: Entrada[] = [
  {
    titulo: "Os meus processos",
    href: "/meus-processos",
    icone: LayoutDashboard,
    soUtilizador: true,
  },
  { titulo: "Processos", href: "/processos", icone: FileText },
  { titulo: "A minha equipa", href: "/equipa", icone: Users, soGestor: true },
  { titulo: "Clientes", href: "/clientes", icone: Users },
  { titulo: "Notificações", href: "/notificacoes", icone: Bell },
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
  { titulo: "Administração", href: "/gestao", icone: Building2, soSocietyAdmin: true },
];

/**
 * O filtro por papel, testado diretamente contra `eu.papel` — não contra uma
 * função de capacidade emprestada para outra pergunta (ver BUG3-011 acima).
 * Função pura e exportada: testa-se sem sessão nem base de dados, só com um
 * papel à entrada.
 */
export function navegacaoDoPapel(papel: Papel): { label: string; entradas: Entrada[] }[] {
  const visivel = (item: Entrada) => {
    if (item.soSocietyAdmin && papel !== "society_admin") return false;
    if (item.soGestor && papel !== "gestor") return false;
    if (item.soUtilizador && papel !== "utilizador") return false;
    return true;
  };
  
  const trabalho = NAVEGACAO.filter(visivel);
  const sociedade = NAVEGACAO_SOCIEDADE.filter(visivel);
  
  const grupos = [];
  if (trabalho.length > 0) grupos.push({ label: "Trabalho", entradas: trabalho });
  if (sociedade.length > 0) {
    const temAdmin = sociedade.some(e => e.href === "/gestao");
    grupos.push({ label: temAdmin ? "Administração" : "A minha conta", entradas: sociedade });
  }
  
  return grupos;
}

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
    ? `/api/sociedade/logotipo?t=${org.logotipoAtualizadoEm ? new Date(org.logotipoAtualizadoEm).getTime() : Date.now()}`
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
