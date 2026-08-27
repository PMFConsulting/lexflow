"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RotateCcw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { reabrirProcesso } from "../acoes";

/**
 * Botão e diálogo para reabrir um processo aprovado, arquivado ou rejeitado (Frente M).
 */
export function BotaoReabrirProcesso({ processoId }: { processoId: string }) {
  const router = useRouter();
  const [aReabrir, transicaoReabrir] = useTransition();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erroMotivo, setErroMotivo] = useState<string | null>(null);

  const fecharDialogo = (v: boolean) => {
    setAberto(v);
    if (!v) {
      setMotivo("");
      setErroMotivo(null);
    }
  };

  const reabrir = () => {
    const texto = motivo.trim();
    if (!texto) {
      setErroMotivo("Indique o motivo da reabertura.");
      return;
    }
    if (texto.length < 10) {
      setErroMotivo("O motivo deve ter pelo menos 10 caracteres.");
      return;
    }

    setErroMotivo(null);
    transicaoReabrir(async () => {
      const r = await reabrirProcesso(processoId, texto);
      if (!r.ok) {
        setErroMotivo(r.erro);
        toast.error(r.erro);
        return;
      }
      toast.success("Processo reaberto com sucesso.");
      fecharDialogo(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={aberto} onOpenChange={fecharDialogo}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" disabled={aReabrir}>
          <RotateCcw className="size-4" />
          Reabrir caso
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reabrir caso</DialogTitle>
          <DialogDescription>
            O motivo segue por email ao cliente e fica gravado no processo.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="motivo-reabertura" className="text-tinta text-sm font-medium">
              Motivo
            </Label>
            <Textarea
              id="motivo-reabertura"
              value={motivo}
              onChange={(e) => {
                setMotivo(e.target.value);
                setErroMotivo(null);
              }}
              rows={4}
              aria-invalid={Boolean(erroMotivo)}
              aria-describedby={erroMotivo ? "motivo-reabertura-erro" : undefined}
            />
            {erroMotivo && (
              <p
                id="motivo-reabertura-erro"
                className="text-selo flex items-start gap-1.5 text-xs"
                role="alert"
              >
                <TriangleAlert className="mt-px size-3 shrink-0" />
                <span>{erroMotivo}</span>
              </p>
            )}
          </div>
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => fecharDialogo(false)}
            disabled={aReabrir}
          >
            Cancelar
          </Button>
          <Button type="button" onClick={reabrir} disabled={aReabrir}>
            {aReabrir ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                A reabrir…
              </>
            ) : (
              "Confirmar reabertura"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}