import { Bell } from "lucide-react";
import { exigirEquipaDaSociedade } from "@/lib/sessao";
import { consultarNotificacoes } from "@/features/notificacoes/consultas";
import { ListaNotificacoes } from "@/features/notificacoes/componentes/ListaNotificacoes";

export const metadata = { title: "Notificações" };
export const dynamic = "force-dynamic";

export default async function PaginaNotificacoesBackoffice() {
  const { eu } = await exigirEquipaDaSociedade();
  const notificacoes = await consultarNotificacoes(eu, { limite: 100 });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <div className="border-linha bg-papel-alto flex size-10 items-center justify-center rounded-sm border">
          <Bell className="text-verdete size-5" />
        </div>
        <div>
          <h1 className="text-2xl font-serif">Notificações</h1>
          <p className="text-tinta-suave text-xs">
            Avisos de submissão de processos, novos utilizadores e eventos da sociedade.
          </p>
        </div>
      </div>

      <ListaNotificacoes notificacoesIniciais={notificacoes} />
    </div>
  );
}
