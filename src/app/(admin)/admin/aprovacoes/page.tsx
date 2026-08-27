import { AprovacoesUtilizadores } from "@/features/plataforma/componentes/AprovacoesUtilizadores";
import { listarUtilizadoresPendentes } from "@/features/plataforma/consultas";
import { exigirSuperAdmin } from "@/lib/sessao";

export const metadata = { title: "Aprovações pendentes" };
export const dynamic = "force-dynamic";

/**
 * Página de aprovação de utilizadores para o super_admin da plataforma.
 *
 * Apresenta todas as contas criadas/propostas pelas sociedades que aguardam
 * validação antes de obterem acesso à plataforma.
 */
export default async function AprovacoesPage() {
  await exigirSuperAdmin();
  const pendentes = await listarUtilizadoresPendentes();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div>
        <h1 className="text-2xl">Aprovações</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Utilizadores propostos pelas sociedades que aguardam autorização do administrador da plataforma
          para aceder ao sistema.
        </p>
      </div>

      <AprovacoesUtilizadores pendentes={pendentes} mostrarSociedade={true} />
    </div>
  );
}
