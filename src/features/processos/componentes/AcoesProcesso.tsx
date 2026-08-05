"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { alterarEstadoProcesso } from "../acoes";

const ESTADOS_DECIDIVEIS = new Set(["submetido", "em_revisao"]);

/**
 * Bloco de decisão de sócio ou admin.
 *
 * Só aparece a quem tem o papel para decidir e enquanto o processo ainda não
 * foi decidido — depois de aprovado ou rejeitado, o estado passa a definitivo
 * e o `EstadoBadge` do cabeçalho já diz tudo o que há para dizer.
 */
export function AcoesProcesso({
  processoId,
  estado,
  podeAprovar,
}: {
  processoId: string;
  estado: string;
  podeAprovar: boolean;
}) {
  const router = useRouter();
  const [aDecidir, transicao] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  if (!podeAprovar || !ESTADOS_DECIDIVEIS.has(estado)) return null;

  const decidir = (novoEstado: "em_revisao" | "aprovado" | "rejeitado", rotulo: string) => {
    setErro(null);
    setFeito(null);
    transicao(async () => {
      const r = await alterarEstadoProcesso(processoId, novoEstado);
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      setFeito(`${rotulo} — registado na auditoria.`);
      router.refresh();
    });
  };

  return (
    <div className="border-linha bg-papel-alto flex flex-col gap-3 rounded-sm border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium">Decisão de sócio ou admin</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={aDecidir}
            onClick={() => decidir("em_revisao", "Marcado em revisão")}
          >
            <Eye className="size-3.5" />
            Marcar em revisão
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={aDecidir}
            onClick={() => decidir("rejeitado", "Rejeitado")}
          >
            <X className="size-3.5" />
            Rejeitar
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={aDecidir}
            onClick={() => decidir("aprovado", "Aprovado")}
          >
            <Check className="size-3.5" />
            Aprovar
          </Button>
        </div>
      </div>

      {erro && (
        <p className="text-selo text-xs" role="alert">
          {erro}
        </p>
      )}
      {feito && (
        <p className="text-arquivo text-xs" role="status">
          {feito}
        </p>
      )}
    </div>
  );
}
