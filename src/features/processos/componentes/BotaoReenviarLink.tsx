"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { reenviarLinkProcesso } from "../acoes";

/**
 * Botão e diálogo para reenviar ao cliente o link de acesso a um processo
 * (BUG3-005) — quando o link original expirou ou se perdeu.
 *
 * Só é montado nos estados editáveis (a página decide isso, como no botão de
 * reabertura); a Server Action repete a mesma guarda do lado do servidor.
 */
export function BotaoReenviarLink({ processoId }: { processoId: string }) {
  const router = useRouter();
  const [aReenviar, transicao] = useTransition();
  const [aberto, setAberto] = useState(false);

  const reenviar = () => {
    transicao(async () => {
      const r = await reenviarLinkProcesso(processoId);
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      toast.success("Link reenviado ao cliente.");
      setAberto(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" disabled={aReenviar}>
          <Send className="size-4" />
          Reenviar link
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reenviar link ao cliente</DialogTitle>
          <DialogDescription>
            Gera um novo link de acesso e envia-o por email ao cliente. O link anterior deixa de
            funcionar.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setAberto(false)}
            disabled={aReenviar}
          >
            Cancelar
          </Button>
          <Button type="button" onClick={reenviar} disabled={aReenviar}>
            {aReenviar ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                A reenviar…
              </>
            ) : (
              "Confirmar reenvio"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
