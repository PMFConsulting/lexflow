"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, LoaderCircle, TriangleAlert, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { aprovarProcesso, rejeitarProcesso } from "../acoes";

/**
 * Aprovar ou rejeitar um processo em `aguardar_aprovacao`.
 *
 * Só é montado nesse estado — a página não o renderiza para um processo já
 * decidido — e as Server Actions repetem a mesma guarda do lado do servidor,
 * porque quem escreva a chamada à mão contra outro estado não pode contornar
 * a regra só por não ver o botão.
 *
 * Aprovar dispara logo; rejeitar exige o motivo primeiro, porque é o que vai
 * no email ao cliente e no processo — uma rejeição sem motivo é uma decisão
 * que ninguém, do lado dele, consegue perceber.
 */
export function AcoesAprovacao({ processoId }: { processoId: string }) {
  const router = useRouter();
  const [aAprovar, transicaoAprovar] = useTransition();
  const [aRejeitar, transicaoRejeitar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erroMotivo, setErroMotivo] = useState<string | null>(null);

  const aprovar = () => {
    setErro(null);
    transicaoAprovar(async () => {
      const r = await aprovarProcesso(processoId);
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      router.refresh();
    });
  };

  const fecharDialogo = (v: boolean) => {
    setAberto(v);
    if (!v) {
      setMotivo("");
      setErroMotivo(null);
    }
  };

  const rejeitar = () => {
    const texto = motivo.trim();
    if (!texto) {
      setErroMotivo("Indique o motivo da rejeição.");
      return;
    }
    setErroMotivo(null);
    transicaoRejeitar(async () => {
      const r = await rejeitarProcesso(processoId, texto);
      if (!r.ok) {
        setErroMotivo(r.erro);
        return;
      }
      fecharDialogo(false);
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Decisão</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Este processo está à espera de aprovação. Aprovar envia as boas-vindas ao cliente, com o
          resumo do processo, os T&C e a proposta de honorários em anexo. Rejeitar exige um
          motivo, que segue por email ao cliente.
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

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={aprovar} disabled={aAprovar || aRejeitar}>
            {aAprovar ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <CircleCheck className="size-4" />
            )}
            {aAprovar ? "A aprovar…" : "Aprovar processo"}
          </Button>

          <Dialog open={aberto} onOpenChange={fecharDialogo}>
            <DialogTrigger asChild>
              <Button type="button" variant="outline" disabled={aAprovar || aRejeitar}>
                <XCircle className="size-4" />
                Rejeitar processo
              </Button>
            </DialogTrigger>

            <DialogContent>
              <DialogHeader>
                <DialogTitle>Rejeitar processo</DialogTitle>
                <DialogDescription>
                  O motivo segue por email ao cliente e fica gravado no processo. Esta decisão não
                  se desfaz.
                </DialogDescription>
              </DialogHeader>

              <DialogBody>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="motivo-rejeicao" className="text-tinta text-sm font-medium">
                    Motivo
                  </Label>
                  <Textarea
                    id="motivo-rejeicao"
                    value={motivo}
                    onChange={(e) => {
                      setMotivo(e.target.value);
                      setErroMotivo(null);
                    }}
                    rows={4}
                    aria-invalid={Boolean(erroMotivo)}
                    aria-describedby={erroMotivo ? "motivo-rejeicao-erro" : undefined}
                  />
                  {erroMotivo && (
                    <p
                      id="motivo-rejeicao-erro"
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
                  disabled={aRejeitar}
                >
                  Cancelar
                </Button>
                <Button type="button" onClick={rejeitar} disabled={aRejeitar}>
                  {aRejeitar ? "A rejeitar…" : "Confirmar rejeição"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );
}
