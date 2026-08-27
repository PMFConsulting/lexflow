import { redirect } from "next/navigation";
import { Clock } from "lucide-react";
import { BotaoSair } from "@/features/conta/componentes/BotaoSair";
import { portalDoPapel, sessaoAtual } from "@/lib/sessao";

export const dynamic = "force-dynamic";
export const metadata = { title: "A aguardar aprovação" };

/**
 * Ecrã exibido a utilizadores cuja conta ainda não foi aprovada pelo super_admin.
 *
 * Utilizadores com `aprovado_em = null` e papel diferente de `super_admin` são
 * desviados para aqui por `exigirSessao()`.
 */
export default async function AguardaAprovacaoPage() {
  const sessao = await sessaoAtual();
  if (!sessao) redirect("/entrar");

  // Se já está aprovado ou é super_admin, segue para o portal
  if (sessao.eu.papel === "super_admin" || sessao.eu.aprovadoEm) {
    redirect(portalDoPapel(sessao.eu.papel));
  }

  return (
    <div className="border-linha bg-papel-alto flex flex-col gap-5 rounded-sm border p-6 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-latao/10 text-latao">
        <Clock className="size-6" />
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-xl">Conta a aguardar aprovação</h1>
        <p className="text-sm text-muted-foreground">
          A sua conta foi registada pelo administrador da sua sociedade e está a aguardar validação
          e aprovação por parte da administração da plataforma.
        </p>
      </div>

      <div className="border-linha/80 bg-papel flex flex-col gap-1.5 rounded-sm border p-3 text-left text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Utilizador:</span>
          <span className="font-medium">{sessao.eu.nome}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Email:</span>
          <span className="font-medium">{sessao.eu.email}</span>
        </div>
      </div>

      <p className="text-2xs text-muted-foreground">
        Assim que a conta for aprovada pelo administrador da plataforma, poderá aceder aos seus processos.
      </p>

      <div className="border-linha flex justify-center border-t pt-4">
        <BotaoSair />
      </div>
    </div>
  );
}
