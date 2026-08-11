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
 * A proposta de honorários (`/custos.pdf`), e a porta que ela fecha.
 *
 * Mesmo padrão do `LeitorTermos`: a caixa "Aceito a proposta" só se destranca
 * depois de o documento ser aberto e percorrido até ao fim — a proposta é o
 * documento que fixa o que o cliente vai pagar, e uma aceitação sem o ter visto
 * não prova nada.
 *
 * A diferença é o que há dentro do leitor. O `LeitorTermos` renderiza o texto
 * dos T&C como HTML nosso e mede o `scrollTop` do elemento que o contém — sem
 * incerteza nenhuma, porque o elemento é nosso. A proposta só existe como PDF
 * em `public/`, e o conteúdo de um `<iframe>` de PDF não se lê de dentro: o
 * visualizador nativo do browser corre no seu próprio contexto, e o
 * `scrollTop` dele não está acessível a este código, mesmo sendo o ficheiro da
 * mesma origem.
 *
 * O ficheiro oficial é um documento tipo apresentação (paisagem, várias
 * páginas) — dentro do iframe, à largura do modal, o texto fica pequeno. Não
 * há como corrigir isso a partir daqui: o visualizador de PDF é do browser, não
 * nosso. Por isso o botão "Abrir em ecrã inteiro" — que usa o visualizador
 * nativo a ecrã inteiro, com zoom e rolagem próprios — é a forma de leitura
 * principal, e vive dentro do modal, visível sem precisar de procurar; o
 * iframe fica como pré-visualização contida, com o mesmo aviso.
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
          Abrir o documento em separador próprio
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

/**
 * Altura do iframe: alta o suficiente para as 9 páginas em paisagem do
 * documento oficial caberem sem o visualizador do PDF abrir a sua própria
 * barra de rolagem interna — é o `<div>` à volta, esse sim nosso, que tem de
 * ser o único a rolar, para a medição do fim funcionar (ver nota do módulo).
 */
const ALTURA_IFRAME = 5400;

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

  // O `aoChegarAoFim` chega numa função nova a cada render do formulário — ver
  // a mesma nota no `LeitorTermos`.
  const avisar = useRef(aoChegarAoFim);
  avisar.current = aoChegarAoFim;

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
  // rolar), não há fim para onde rolar — sem isto a caixa ficava trancada.
  useEffect(() => {
    const el = corpo.current;
    if (el && el.scrollHeight <= el.clientHeight + 24) {
      setChegouAoFim(true);
      avisar.current();
    }
  }, []);

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

      <div className="border-linha bg-latao/10 flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
        <p className="text-tinta text-xs">
          Documento em formato de apresentação — lê-se melhor a ecrã inteiro.
        </p>
        <Button asChild variant="default" size="sm" className="shrink-0">
          <a href="/custos.pdf" target="_blank" rel="noopener">
            <Maximize2 className="size-3.5" />
            Abrir o documento em ecrã inteiro
          </a>
        </Button>
      </div>

      <div
        ref={corpo}
        onScroll={verificar}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <iframe
          src="/custos.pdf#toolbar=0"
          title="Proposta de Honorários"
          className="w-full border-0"
          style={{ height: ALTURA_IFRAME }}
        />
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
