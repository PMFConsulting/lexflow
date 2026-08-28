"use client";

import { useState, useTransition } from "react";
import { Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { alterarPreferenciaNotificacaoSubmissoes } from "../acoes";

export function PreferenciaNotificacaoEmail({
  ativadoInicial,
}: {
  ativadoInicial: boolean;
}) {
  const [ativado, setAtivado] = useState(ativadoInicial);
  const [pendente, startTransition] = useTransition();
  const [mensagemSucesso, setMensagemSucesso] = useState<string | null>(null);

  const aoAlternar = (novoValor: boolean) => {
    setAtivado(novoValor);
    setMensagemSucesso(null);
    startTransition(async () => {
      const res = await alterarPreferenciaNotificacaoSubmissoes(novoValor);
      if (res.ok) {
        setMensagemSucesso(
          novoValor
            ? "Preferência atualizada: receberá um email por cada novo processo submetido."
            : "Preferência atualizada: emails de novas submissões desativados (0 emails; notificações no backoffice).",
        );
      }
    });
  };

  return (
    <div className="border-linha bg-papel-alto rounded-sm border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Mail className="text-tinta-suave size-4" />
            <h3 className="text-sm font-semibold">Avisos por Email de Novos Processos</h3>
          </div>
          <p className="text-tinta-suave mt-1 text-xs">
            Por omissão, os avisos de novos processos são apresentados internamente no back-office
            (ícone de sino), sem custos de envio de email. Se desejar, pode ativar o envio de email
            para o endereço geral da sociedade a cada nova submissão.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant={ativado ? "default" : "outline"}
            size="sm"
            disabled={pendente}
            onClick={() => aoAlternar(!ativado)}
            className="text-xs"
          >
            {ativado ? "Ativado (Envia Email)" : "Desativado (Só In-App)"}
          </Button>
        </div>
      </div>

      {mensagemSucesso && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
          <ShieldCheck className="size-3.5" />
          <span>{mensagemSucesso}</span>
        </div>
      )}
    </div>
  );
}
