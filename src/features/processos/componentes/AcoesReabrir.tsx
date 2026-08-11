"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { reabrirProcesso } from "../acoes";

/**
 * Reabre um processo rejeitado — só é montado nesse estado, e a Server
 * Action repete a guarda do lado do servidor pela mesma razão de
 * `AcoesAprovacao`: quem escreva a chamada à mão contra outro estado não a
 * contorna só por não ver o botão.
 *
 * Sem motivo a pedir, ao contrário da rejeição: reabrir não é uma decisão que
 * precise de se justificar ao cliente, é o oposto — devolver-lhe a
 * possibilidade de corrigir. O motivo da rejeição anterior continua gravado
 * e visível no processo.
 */
export function AcoesReabrir({ processoId }: { processoId: string }) {
  const router = useRouter();
  const [aReabrir, transicaoReabrir] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);

  const reabrir = () => {
    setErro(null);
    transicaoReabrir(async () => {
      const r = await reabrirProcesso(processoId);
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      setAberto(false);
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Reabertura</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Este processo foi rejeitado. Reabrir devolve-o a rascunho — o cliente recebe um novo
          link por email, pode corrigir os dados e voltar a submeter para nova apreciação.
        </p>

        {erro && (
          <p
            className="border-selo/40 bg-selo/5 text-selo flex items-start gap-2 rounded-sm border p-3 text-xs"
            role="alert"
          >
            <TriangleAlert className="mt-px size-3.5 shrink-0" />
            <span>{erro}</span>
          </p>
        )}

        <Dialog open={aberto} onOpenChange={setAberto}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline" className="w-fit" disabled={aReabrir}>
              <RotateCcw className="size-4" />
              Reabrir processo
            </Button>
          </DialogTrigger>

          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reabrir processo</DialogTitle>
              <DialogDescription>
                Esta ação reabre o processo para o cliente poder corrigir e voltar a submeter.
              </DialogDescription>
            </DialogHeader>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAberto(false)}
                disabled={aReabrir}
              >
                Cancelar
              </Button>
              <Button type="button" onClick={reabrir} disabled={aReabrir}>
                {aReabrir ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <RotateCcw className="size-4" />
                )}
                {aReabrir ? "A reabrir…" : "Confirmar reabertura"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
