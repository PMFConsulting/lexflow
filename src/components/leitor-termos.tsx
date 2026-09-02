"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, FileText } from "lucide-react";
import { Logotipo } from "@/components/logotipo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SeccaoTermos } from "@/lib/termos";
import { cn } from "@/lib/utils";

/**
 * O documento dos T&C, e a porta que ele fecha: a caixa de aceitação só
 * destranca depois de lido (padrão bancário) — sob RGPD, um consentimento
 * sobre um documento nunca mostrado não prova nada.
 *
 * "Lido" depende da forma:
 *   · `plataforma` — texto em secções, renderizado aqui. Fim medido no
 *     próprio elemento (D30).
 *   · `documento` — PDF da sociedade. Sem medição possível (`X-Frame-Options:
 *     DENY` recusa até o próprio domínio, `<iframe>` daria um retângulo em
 *     branco): destranca ao **abrir**, mesma escolha da proposta comercial
 *     (D52).
 */
export type TermosParaLer =
  | { forma: "plataforma"; versao: string; seccoes: SeccaoTermos[] }
  | { forma: "documento"; versao: string; nome: string; url: string };

export function LeitorTermos({
  termos,
  lido,
  aoLer,
  hrefExterno,
  titulo = "Termos e Condições",
}: {
  termos: TermosParaLer;
  lido: boolean;
  aoLer: () => void;
  /** Onde o documento abre em separador próprio, para guardar ou imprimir. */
  hrefExterno: string;
  titulo?: string;
}) {
  const [aberto, setAberto] = useState(false);

  const ePdf = termos.forma === "documento";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {ePdf ? (
          // PDF abre no próprio separador; abrir conta como leitura. O
          // `onClick` corre mesmo se o browser bloquear o separador —
          // imprecisão conhecida, preferível a trancar a caixa a quem tem
          // bloqueador de popups.
          <Button asChild variant={lido ? "outline" : "default"}>
            <a href={termos.url} target="_blank" rel="noopener" onClick={aoLer}>
              <FileText className="size-4" />
              {lido ? `Rever ${titulo}` : `Abrir e ler ${titulo}`}
            </a>
          </Button>
        ) : (
          <Button
            type="button"
            variant={lido ? "outline" : "default"}
            onClick={() => setAberto(true)}
          >
            <FileText className="size-4" />
            {lido ? `Rever ${titulo}` : `Abrir e ler ${titulo}`}
          </Button>
        )}

        <a
          href={hrefExterno}
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
          {ePdf ? "Documento aberto." : "Documento lido até ao fim."}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {ePdf
            ? "Para poder aceitar, abra o documento."
            : "Para poder aceitar, abra o documento e percorra-o até ao fim."}
        </p>
      )}

      {ePdf && (
        <p className="text-2xs font-mono tracking-wider text-muted-foreground uppercase">
          {termos.nome} · versão {termos.versao}
        </p>
      )}

      {!ePdf && (
        <Dialog open={aberto} onOpenChange={setAberto}>
          {aberto && (
            <Modal
              aoFechar={() => setAberto(false)}
              lido={lido}
              aoChegarAoFim={aoLer}
              seccoes={termos.seccoes}
              versao={termos.versao}
              titulo={titulo}
            />
          )}
        </Dialog>
      )}
    </div>
  );
}

/**
 * A janela do documento. Usa o `Dialog` da aplicação, não uma caixa `fixed`
 * escrita à mão — dá a armadilha de foco: sem ela, `Tab` saía para os campos
 * do formulário por baixo, e quem navega por teclado podia "percorrer o
 * documento" sem lá estar. Medição do fim conforme D30.
 */
function Modal({
  aoFechar,
  lido,
  aoChegarAoFim,
  seccoes,
  versao,
  titulo,
}: {
  aoFechar: () => void;
  lido: boolean;
  aoChegarAoFim: () => void;
  seccoes: SeccaoTermos[];
  versao: string;
  titulo: string;
}) {
  const corpo = useRef<HTMLDivElement>(null);
  const [chegouAoFim, setChegouAoFim] = useState(lido);

  // `aoChegarAoFim` chega numa função nova a cada render — numa dependência
  // de efeito isso corria sem parar. Guardado em ref, o efeito corre uma vez.
  const avisar = useRef(aoChegarAoFim);
  // A callback chega nova a cada render; guardada em ref, mas só dentro de um
  // efeito — escrever `ref.current` durante o render é o que react-hooks/refs nega.
  useEffect(() => {
    avisar.current = aoChegarAoFim;
  });

  const verificar = () => {
    const el = corpo.current;
    if (!el) return;
    // 24px de tolerância: zoom do browser ou barras de rolagem do sistema
    // deixam o `scrollTop` máximo uns pixels abaixo da conta.
    const noFim = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
    if (!noFim) return;
    setChegouAoFim(true);
    avisar.current();
  };

  // Documento que cabe todo no ecrã não tem fim para onde rolar — sem isto a
  // caixa ficava trancada para sempre num monitor grande.
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
      // Foco de partida no documento, não no botão de fechar — setas e
      // Page Down rolam o texto sem precisar de clicar no painel primeiro.
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        corpo.current?.focus();
      }}
    >
      <DialogHeader>
        <DialogTitle>{titulo}</DialogTitle>
        <p className="text-2xs font-mono tracking-[0.14em] text-muted-foreground uppercase">
          Versão {versao}
        </p>
      </DialogHeader>

      <div
        ref={corpo}
        onScroll={verificar}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-5 text-sm leading-relaxed"
      >
        <header className="mb-6 flex items-center gap-3.5">
          <Logotipo className="h-10 w-auto" />
          <span className="text-2xs font-mono tracking-[0.22em] text-latao uppercase">
            LexFlow · Plataforma de Onboarding
          </span>
        </header>
        <div className="bg-marca/85 mb-6 h-[3px] w-full rounded-full" />

        {seccoes.map((seccao) => (
          <section
            key={seccao.titulo}
            className="border-linha mt-7 border-t pt-4.5 first:mt-0 first:border-none first:pt-0"
          >
            <h3 className="font-display text-tinta mb-2 text-lg font-normal">{seccao.titulo}</h3>
            {seccao.paragrafos.map((p, j) => (
              <p key={j} className="text-tinta-suave mb-2">
                {p}
              </p>
            ))}
          </section>
        ))}
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
