"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BotaoReabrirProcesso } from "./BotaoReabrirProcesso";

/**
 * Secção de ações para reabertura de processo (Frente M).
 */
export function AcoesReabertura({
  processoId,
  estado,
}: {
  processoId: string;
  estado: "arquivado" | "rejeitado";
}) {
  const descricao =
    estado === "rejeitado"
      ? "Este processo foi rejeitado. Pode reabrir o caso para permitir ao cliente corrigir ou complementar a informação submetida."
      : "Este processo foi arquivado. Pode reabrir o caso para retomar a revisão dos dados.";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Reabertura de caso</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{descricao}</p>
        <div className="flex flex-wrap gap-2">
          <BotaoReabrirProcesso processoId={processoId} />
        </div>
      </CardContent>
    </Card>
  );
}