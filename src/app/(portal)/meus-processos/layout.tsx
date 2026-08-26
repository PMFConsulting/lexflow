import { FileText, Users } from "lucide-react";
import { PortalShell, ROTULO_DO_PAPEL, type EntradaDeMenu } from "@/components/portal-shell";
import { exigirEquipaDaSociedade, podeVerEmails, portalDoPapel } from "@/lib/sessao";
import { redirect } from "next/navigation";

/**
 * O portal de quem trabalha os processos.
 *
 * A barra é mais curta do que a do back-office e é essa a diferença toda: sem
 * emails, sem configuração, sem gestão de contas. O que fica é o trabalho —
 * os processos da sociedade e os clientes.
 *
 * O `society_admin` é reencaminhado daqui para o back-office. Não é por não
 * poder ver isto — pode ver tudo o que aqui está —, é para não haver duas
 * portas de entrada para a mesma pessoa: o portal de cada papel é um só, e é o
 * que `portalDoPapel` diz.
 */

const NAVEGACAO: EntradaDeMenu[] = [
  { titulo: "Os meus processos", href: "/meus-processos", icone: FileText },
  { titulo: "Clientes", href: "/clientes", icone: Users },
];

export const dynamic = "force-dynamic";

export default async function LayoutPortal({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { eu } = await exigirEquipaDaSociedade();
  if (podeVerEmails(eu.papel)) redirect(portalDoPapel(eu.papel));

  return (
    <PortalShell
      entradas={NAVEGACAO}
      grupo="Trabalho"
      cabecalho="Onboarding de clientes"
      legendaDaMarca="Processos"
      utilizador={{ nome: eu.nome, papel: ROTULO_DO_PAPEL[eu.papel] ?? eu.papel }}
    >
      {children}
    </PortalShell>
  );
}
