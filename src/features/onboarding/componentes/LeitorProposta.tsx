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
import { formatarDataCurta } from "@/lib/datas";
import { cn } from "@/lib/utils";

/** A proposta que a sociedade anexou a **este** processo, quando existe. */
export type PropostaAnexada = {
  nome: string;
  bytes: number;
  /** A rota que a serve, autorizada pelo mesmo token do link mágico. */
  url: string;
  criadoEm?: Date | string | null;
};

const kb = (b: number) =>
  b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

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
    <div className="border-linha bg-papel-alto flex flex-col gap-4 rounded-sm border p-4">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-sm border",
            lido
              ? "border-arquivo/30 bg-arquivo/10 text-arquivo"
              : "border-marca/30 bg-marca/10 text-marca",
          )}
        >
          <FileText className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-2xs font-mono tracking-[0.14em] text-muted-foreground uppercase">
            Proposta de Honorários
          </p>
          <p className="mt-0.5 truncate text-sm font-medium">{anexada.nome}</p>
          <p className="text-xs text-muted-foreground">
            PDF · {kb(anexada.bytes)}
            {anexada.criadoEm && ` · anexada em ${formatarDataCurta(anexada.criadoEm)}`}
          </p>
        </div>
        {lido && (
          <span className="text-arquivo flex shrink-0 items-center gap-1 text-xs font-medium">
            <Check className="size-3.5" strokeWidth={2.5} />
            Aberta
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant={lido ? "outline" : "default"} onClick={() => setAberto(true)}>
          <FileText className="size-4" />
          {lido ? "Rever proposta" : "Ver proposta"}
        </Button>
        {!lido && (
          <p className="text-xs text-muted-foreground">
            Para poder aceitar, abra o documento que a sociedade lhe enviou.
          </p>
        )}
      </div>

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

  const marcarAberta = () => {
    setAbriu(true);
    aoAbrir();
  };

  return (
    <DialogContent className="max-w-2xl" aria-describedby={undefined}>
      <DialogHeader className="pr-8">
        <DialogTitle className="flex items-center gap-2">
          <FileText className="text-marca size-4.5" />
          Proposta de Honorários
        </DialogTitle>
        <p className="text-2xs font-mono tracking-[0.14em] text-muted-foreground uppercase">
          {proposta.nome} · {kb(proposta.bytes)}
        </p>
      </DialogHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-5">
        <p className="text-sm text-muted-foreground">
          Leia a proposta com atenção antes de a aceitar — é o documento que
          fixa os serviços e os honorários acordados.
        </p>

        <iframe
          src={proposta.url}
          title={`Proposta de honorários — ${proposta.nome}`}
          onLoad={marcarAberta}
          className="border-linha h-[60vh] w-full rounded-sm border bg-white"
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="outline" className="w-fit" onClick={marcarAberta}>
            <a href={proposta.url} target="_blank" rel="noopener">
              <Maximize2 className="size-3.5" />
              Abrir em janela própria
            </a>
          </Button>
          {!abriu && (
            <button
              type="button"
              onClick={marcarAberta}
              className="text-marca text-xs font-medium underline underline-offset-2"
            >
              Confirmei que li a proposta noutra janela
            </button>
          )}
        </div>
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
