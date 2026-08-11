"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, FileText, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * A proposta de honorários, e a porta que ela fecha.
 *
 * Mesmo padrão do `LeitorTermos`: a caixa "Aceito a proposta" só se destranca
 * depois de o documento ser aberto e percorrido até ao fim — a proposta é o
 * documento que fixa o que o cliente vai pagar, e uma aceitação sem o ter visto
 * não prova nada.
 *
 * O que se lê dentro do modal é `/custos.html` — a versão HTML do mesmo
 * conteúdo, injetada num `<div>` nosso com scroll natural, exatamente como o
 * `LeitorTermos` já fazia com os T&C. Um `<iframe>` de PDF não serve para
 * isto: o visualizador nativo do browser corre no seu próprio contexto e o
 * documento oficial (`/custos.pdf`) é um slide deck em paisagem — ilegível à
 * largura do modal. O PDF oficial continua acessível, mas como opção
 * secundária: quem quiser o ficheiro tal e qual pode abri-lo à parte.
 */
export function LeitorProposta({
  lido,
  aoLer,
}: {
  lido: boolean;
  aoLer: () => void;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant={lido ? "outline" : "default"} onClick={() => setAberto(true)}>
          <FileText className="size-4" />
          {lido ? "Rever a proposta de honorários" : "Abrir e ler a proposta de honorários"}
        </Button>

        <a
          href="/custos.pdf"
          target="_blank"
          rel="noopener"
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-tinta"
        >
          Abrir o PDF oficial em separador próprio
          <ExternalLink className="ml-1 inline size-3" />
        </a>
      </div>

      {lido ? (
        <p className="text-arquivo flex items-center gap-1.5 text-xs">
          <Check className="size-3.5" strokeWidth={2.5} />
          Documento lido até ao fim.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Para poder aceitar, abra o documento e percorra-o até ao fim.
        </p>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        {aberto && (
          <Modal
            aoFechar={() => setAberto(false)}
            lido={lido}
            aoChegarAoFim={aoLer}
          />
        )}
      </Dialog>
    </div>
  );
}

/** O que há para mostrar dentro do leitor, enquanto o HTML não chega ou se a busca falhar. */
type EstadoDocumento =
  | { tipo: "a-carregar" }
  | { tipo: "erro" }
  | { tipo: "pronto"; css: string; html: string };

function Modal({
  aoFechar,
  lido,
  aoChegarAoFim,
}: {
  aoFechar: () => void;
  lido: boolean;
  aoChegarAoFim: () => void;
}) {
  const corpo = useRef<HTMLDivElement>(null);
  const [chegouAoFim, setChegouAoFim] = useState(lido);
  const [documento, setDocumento] = useState<EstadoDocumento>({ tipo: "a-carregar" });

  // O `aoChegarAoFim` chega numa função nova a cada render do formulário — ver
  // a mesma nota no `LeitorTermos`.
  const avisar = useRef(aoChegarAoFim);
  avisar.current = aoChegarAoFim;

  // Busca-se `/custos.html` em runtime — é conteúdo estático nosso, servido
  // da mesma origem — e extrai-se o `<style>` (já escopado sob `.doc-proposta`
  // no próprio ficheiro) e o conteúdo do documento, para injetar os dois no
  // leitor. Uma falha na busca (raro, mas possível) não deixa o cliente sem
  // documento: cai no aviso com o PDF oficial em destaque.
  useEffect(() => {
    let cancelado = false;
    fetch("/custos.html")
      .then((resposta) => {
        if (!resposta.ok) throw new Error("resposta não ok");
        return resposta.text();
      })
      .then((texto) => {
        if (cancelado) return;
        const parsed = new DOMParser().parseFromString(texto, "text/html");
        const css = parsed.querySelector("style")?.textContent ?? "";
        const html = parsed.querySelector(".doc-proposta")?.innerHTML;
        if (!html) throw new Error("documento sem conteúdo");
        setDocumento({ tipo: "pronto", css, html });
      })
      .catch(() => {
        if (!cancelado) setDocumento({ tipo: "erro" });
      });
    return () => {
      cancelado = true;
    };
  }, []);

  const verificar = () => {
    const el = corpo.current;
    if (!el) return;
    // 24px de tolerância, pela mesma razão do `LeitorTermos`: zoom do browser
    // e barras de rolagem do sistema deixam o `scrollTop` máximo uns pixels
    // abaixo da conta.
    const noFim = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
    if (!noFim) return;
    setChegouAoFim(true);
    avisar.current();
  };

  // Se a proposta couber toda no ecrã (o wrapper não chega a precisar de
  // rolar), não há fim para onde rolar — sem isto a caixa ficava trancada. A
  // medição só faz sentido depois de o documento entrar no DOM, daí depender
  // de `documento` e não correr só uma vez ao montar.
  useEffect(() => {
    if (documento.tipo !== "pronto") return;
    const el = corpo.current;
    if (el && el.scrollHeight <= el.clientHeight + 24) {
      setChegouAoFim(true);
      avisar.current();
    }
  }, [documento]);

  return (
    <DialogContent
      className="h-[92svh] max-w-3xl sm:h-[80svh]"
      aria-describedby={undefined}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        corpo.current?.focus();
      }}
    >
      <DialogHeader>
        <DialogTitle>Proposta de Honorários</DialogTitle>
      </DialogHeader>

      <div
        ref={corpo}
        onScroll={verificar}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
      >
        {documento.tipo === "a-carregar" && (
          <p className="text-xs text-muted-foreground">A carregar o documento…</p>
        )}

        {documento.tipo === "erro" && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-xs text-muted-foreground">
              Não foi possível carregar o documento aqui. Use o PDF oficial em ecrã inteiro.
            </p>
            <Button asChild variant="default" size="sm">
              <a href="/custos.pdf" target="_blank" rel="noopener">
                <Maximize2 className="size-3.5" />
                Abrir o PDF oficial
              </a>
            </Button>
          </div>
        )}

        {documento.tipo === "pronto" && (
          <>
            <style dangerouslySetInnerHTML={{ __html: documento.css }} />
            <div className="doc-proposta" dangerouslySetInnerHTML={{ __html: documento.html }} />
          </>
        )}
      </div>

      <div className="border-linha bg-latao/10 flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
        <p className="text-tinta text-xs">
          Prefere o ficheiro tal e qual? O PDF oficial abre num separador próprio.
        </p>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <a href="/custos.pdf" target="_blank" rel="noopener">
            <Maximize2 className="size-3.5" />
            Abrir o PDF oficial
          </a>
        </Button>
      </div>

      <DialogFooter className="justify-between">
        <p
          className={cn("text-xs", chegouAoFim ? "text-arquivo" : "text-muted-foreground")}
          aria-live="polite"
        >
          {chegouAoFim
            ? "Chegou ao fim do documento."
            : "Continue a percorrer o documento até ao fim."}
        </p>
        <Button type="button" onClick={aoFechar} disabled={!chegouAoFim}>
          {chegouAoFim ? "Li e compreendi" : "Percorra até ao fim"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
