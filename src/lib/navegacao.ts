import { Bell, Building2, FileText, LayoutDashboard, UserRound, Users } from "lucide-react";
import type { EntradaDeMenu } from "@/components/portal-shell";
import type { Papel } from "@/lib/sessao";

/**
 * As entradas da barra lateral de quem trabalha dentro de uma sociedade.
 *
 * Vive aqui, e não no `layout.tsx` do back-office, porque **há dois layouts a
 * montar esta barra**: o do back-office (`/processos`, `/clientes`,
 * `/notificacoes`, `/advogado`) e o do portal (`/meus-processos`). Enquanto a
 * lista estava dentro de um deles, o outro tinha a sua própria cópia — e a
 * cópia tinha duas entradas contra cinco: um `utilizador` que aterrasse na
 * sua página de entrada ficava sem «Processos», sem «Notificações» e sem «A
 * minha conta» na barra, e recuperava-as ao navegar para qualquer outra
 * página. É exatamente o defeito que o comentário do `PortalShell` avisa —
 * a segunda cópia deixa de acompanhar a primeira e ninguém dá por isso,
 * porque cada papel só vê a sua.
 *
 * O que continua a distinguir os dois layouts é o guard, que cada um chama
 * antes de montar a barra; a lista de entradas passa a ser uma só.
 */
export type Entrada = EntradaDeMenu & {
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
export const NAVEGACAO: Entrada[] = [
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
export const NAVEGACAO_SOCIEDADE: Entrada[] = [
  { titulo: "A minha conta", href: "/advogado", icone: UserRound },
  { titulo: "Administração", href: "/gestao", icone: Building2, soSocietyAdmin: true },
];

/**
 * O filtro por papel, testado diretamente contra `eu.papel` — não contra uma
 * função de capacidade emprestada para outra pergunta (BUG3-011: "Painel"
 * filtrava por `podeVerEmails`, que responde a «quem vê /emails?» e por
 * coincidência dava o mesmo resultado). Função pura e exportada por isso:
 * testa-se sem sessão nem base de dados, só com um papel à entrada.
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
    const temAdmin = sociedade.some((e) => e.href === "/gestao");
    grupos.push({ label: temAdmin ? "Administração" : "A minha conta", entradas: sociedade });
  }

  return grupos;
}
