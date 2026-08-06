"use client";

import { useTransition } from "react";
import { Plug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { testarLigacao } from "../acoes";

export function BotaoTestarLigacao({ ativo }: { ativo: boolean }) {
  const [aTestar, transicao] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={!ativo || aTestar}
      onClick={() =>
        transicao(async () => {
          const r = await testarLigacao();
          if (r.ok) toast.success(r.detalhe);
          else toast.error(r.detalhe);
        })
      }
    >
      <Plug className="size-3.5" />
      {aTestar ? "A testar…" : "Testar ligação"}
    </Button>
  );
}
