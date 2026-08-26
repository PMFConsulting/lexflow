import { Building2, LayoutDashboard, ShieldUser } from "lucide-react";
import { PortalShell, ROTULO_DO_PAPEL, type EntradaDeMenu } from "@/components/portal-shell";
import { exigirSuperAdmin } from "@/lib/sessao";

/**
 * O portal da plataforma.
 *
 * O único sítio da aplicação onde as consultas **não** são filtradas por
 * sociedade — é o que este portal é. Por isso o guard está no layout, cobre
 * tudo o que está por baixo, e cada Server Action que estas páginas chamam
 * repete a verificação por sua conta: um Server Action é um endereço
 * alcançável a partir do browser, e o guard de uma página não o protege.
 *
 * O que aqui não há, e é deliberado: processos, clientes, PPE. Quem é dono da
 * infraestrutura não tem razão de negócio para abrir o dossier de um cliente de
 * uma sociedade, e o `podeVerPpe` diz o mesmo do lado das capacidades.
 */

const NAVEGACAO: EntradaDeMenu[] = [
  { titulo: "Painel", href: "/admin", icone: LayoutDashboard },
  { titulo: "Sociedades", href: "/admin/sociedades", icone: Building2 },
  { titulo: "Utilizadores", href: "/admin/utilizadores", icone: ShieldUser },
];

export const dynamic = "force-dynamic";

export default async function LayoutAdmin({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { eu } = await exigirSuperAdmin();

  return (
    <PortalShell
      entradas={NAVEGACAO}
      grupo="Plataforma"
      cabecalho="Administração da plataforma"
      legendaDaMarca="Plataforma"
      utilizador={{ nome: eu.nome, papel: ROTULO_DO_PAPEL[eu.papel] ?? eu.papel }}
    >
      {children}
    </PortalShell>
  );
}
