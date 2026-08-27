"use client";

import { useState } from "react";
import { Check, FileText, Maximize2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** A proposta que a sociedade anexou a **este** processo, quando existe. */
export type PropostaAnexada = {
  nome: string;
  bytes: number;
  /** A rota que a serve, autorizada pelo mesmo token do link mágico. */
  url: string;
};


/**
 * A proposta de honorários, e a porta que ela fecha.
 *
 * A proposta comercial anexada pela sociedade é obrigatória. Sem ela o cliente
 * não pode aceitar nem avançar.
 */
export function LeitorProposta({
  lido,
  aoLer,
  anexada = null,
}: {
  lido: boolean;
  aoLer: () => void;
  anexada?: PropostaAnexada | null;
}) {
  const [aberto, setAberto] = useState(false);

  if (!anexada) {
    return (
      <div
        className="border-selo/40 bg-selo/5 text-selo flex items-start gap-2 rounded-sm border p-3 text-sm"
        role="alert"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <span>A sociedade ainda não anexou a proposta deste processo. Para continuar, contacte-a.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant={lido ? "outline" : "default"} onClick={() => setAberto(true)}>
          <FileText className="size-4" />
          {lido ? "Rever a proposta de honorários" : "Abrir e ler a proposta de honorários"}
        </Button>
      </div>

      {lido ? (
        <p className="text-arquivo flex items-center gap-1.5 text-xs">
          <Check className="size-3.5" strokeWidth={2.5} />
          Documento aberto.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Para poder aceitar, abra o documento que a sociedade lhe enviou.
        </p>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        {aberto && (
          <ModalAnexada
            aoFechar={() => setAberto(false)}
            lido={lido}
            aoAbrir={aoLer}
            proposta={anexada}
          />
        )}
      </Dialog>
    </div>
  );
}

/**
 * A proposta que a sociedade anexou: um PDF, servido pela rota do token.
 */
function ModalAnexada({
  aoFechar,
  lido,
  aoAbrir,
  proposta,
}: {
  aoFechar: () => void;
  lido: boolean;
  aoAbrir: () => void;
  proposta: PropostaAnexada;
}) {
  const [abriu, setAbriu] = useState(lido);

  return (
    <DialogContent className="max-w-2xl" aria-describedby={undefined}>
      <DialogHeader className="pr-8">
        <DialogTitle>Proposta de Honorários</DialogTitle>
      </DialogHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-5">
        <p className="text-sm text-muted-foreground">
          Leia a proposta com atenção antes de a aceitar — é o documento que
          fixa os serviços e os honorários acordados.
        </p>

        <iframe
          src={proposta.url}
          title={`Proposta de honorários — ${proposta.nome}`}
          onLoad={() => {
            setAbriu(true);
            aoAbrir();
          }}
          className="border-linha h-[60vh] w-full rounded-sm border bg-white"
        />

        <Button asChild variant="outline" className="w-fit">
          <a href={proposta.url} target="_blank" rel="noopener">
            <Maximize2 className="size-3.5" />
            Abrir em janela própria
          </a>
        </Button>
      </div>

      <DialogFooter className="justify-between">
        <p
          className={cn("text-xs", abriu ? "text-arquivo" : "text-muted-foreground")}
          aria-live="polite"
        >
          {abriu ? "Documento aberto." : "Abra o documento para poder continuar."}
        </p>
        <Button type="button" onClick={aoFechar} disabled={!abriu}>
          {abriu ? "Li e compreendi" : "Abra o documento"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

