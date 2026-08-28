import { Bell, Building2, FolderKanban, LayoutDashboard, ShieldUser, UserCheck } from "lucide-react";
import { PortalShell, ROTULO_DO_PAPEL, type EntradaDeMenu } from "@/components/portal-shell";
import { exigirSuperAdmin } from "@/lib/sessao";
import { contarNotificacoesNaoLidas } from "@/features/notificacoes/consultas";

/**
 * O portal da plataforma.
 *
 * O único sítio da aplicação onde as consultas **não** são filtradas por
 * sociedade — é o que este portal é. Por isso o guard está no layout, cobre
 * tudo o que está por baixo, e cada Server Action que estas páginas chamam
 * repete a verificação por sua conta: um Server Action é um endereço
 * alcançável a partir do browser, e o guard de uma página não o protege.
 *
 * O dono da plataforma tem acesso transversal de leitura e edição aos
 * processos de todas as sociedades.
 */

const NAVEGACAO: EntradaDeMenu[] = [
  { titulo: "Painel", href: "/admin", icone: LayoutDashboard },
  { titulo: "Sociedades", href: "/admin/sociedades", icone: Building2 },
  { titulo: "Processos", href: "/admin/processos", icone: FolderKanban },
  { titulo: "Utilizadores", href: "/admin/utilizadores", icone: ShieldUser },
  { titulo: "Aprovações", href: "/admin/aprovacoes", icone: UserCheck },
  { titulo: "Notificações", href: "/admin/notificacoes", icone: Bell },
];

export const dynamic = "force-dynamic";

export default async function LayoutAdmin({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { eu } = await exigirSuperAdmin();
  const contagemNotificacoes = await contarNotificacoesNaoLidas(eu);

  return (
    <PortalShell
      entradas={NAVEGACAO}
      grupo="Plataforma"
      cabecalho="Administração da plataforma"
      legendaDaMarca="Plataforma"
      utilizador={{ nome: eu.nome, papel: ROTULO_DO_PAPEL[eu.papel] ?? eu.papel }}
      contagemNotificacoes={contagemNotificacoes}
      hrefNotificacoes="/admin/notificacoes"
    >
      {children}
    </PortalShell>
  );
}
