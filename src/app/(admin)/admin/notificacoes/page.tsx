import { Bell } from "lucide-react";
import { exigirSuperAdmin } from "@/lib/sessao";
import { consultarNotificacoes } from "@/features/notificacoes/consultas";
import { ListaNotificacoes } from "@/features/notificacoes/componentes/ListaNotificacoes";

export const metadata = { title: "Notificações — Plataforma" };
export const dynamic = "force-dynamic";

export default async function PaginaNotificacoesAdmin() {
  const { eu } = await exigirSuperAdmin();
  const notificacoes = await consultarNotificacoes(eu, { limite: 200 });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <div className="border-linha bg-papel-alto flex size-10 items-center justify-center rounded-sm border">
          <Bell className="text-verdete size-5" />
        </div>
        <div>
          <h1 className="text-2xl">Notificações da Plataforma</h1>
          <p className="text-tinta-suave text-xs">
            Visão transversal de eventos, criação de sociedades, utilizadores e submissões em todas as sociedades.
          </p>
        </div>
      </div>

      <ListaNotificacoes notificacoesIniciais={notificacoes} superAdmin={true} />
    </div>
  );
}
