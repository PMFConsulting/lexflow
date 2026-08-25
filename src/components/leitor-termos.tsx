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
 * O documento dos Termos e Condições, e a porta que ele fecha.
 *
 * A caixa de aceitação só se destranca depois de o documento ter sido lido — o
 * padrão da banca, e pela mesma razão: uma declaração de que se leu um
 * documento que nunca chegou a ser mostrado não prova coisa nenhuma, e num
 * consentimento sob RGPD é precisamente o que se tem de provar.
 *
 * **O que "lido" quer dizer depende da forma do documento**, e o componente diz
 * qual das duas está a aplicar em vez de as confundir:
 *
 *   · `plataforma` — o texto vem em secções e é renderizado aqui dentro. O fim
 *     do documento é uma medição do próprio elemento, sem depender de o browser
 *     deixar ler o `scrollTop` de outro documento nem de uma folha ter
 *     carregado. É a D30, intacta.
 *
 *   · `documento` — o PDF que a sociedade submeteu. Aqui a medição **não
 *     existe**, e é dito no ecrã: o `X-Frame-Options: DENY` do
 *     `next.config.ts` recusa até o próprio domínio, um `<iframe>` daria um
 *     retângulo em branco, e medir o scroll de um PDF que abre noutro separador
 *     não é possível. A caixa destranca ao **abrir**. Foi a mesma escolha da
 *     proposta comercial anexada (D52), e pela mesma razão: fingir a medição
 *     era pior do que dizer que ali ela não existe.
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
          // Um PDF não abre dentro da janela: abre no separador dele, e é o
          // próprio abrir que conta como leitura. O `onClick` corre à mesma
          // quando o browser bloqueia o separador — o que é uma imprecisão
          // conhecida e preferível ao contrário, que era trancar a caixa a quem
          // tem um bloqueador de popups.
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
 * A janela do documento.
 *
 * Assenta no `Dialog` da aplicação e não numa caixa `fixed` escrita à mão. O
 * que se ganha não é aparência — é a armadilha de foco: sem ela, o `Tab` dentro
 * da janela saía para os campos do formulário por baixo, e quem navega por
 * teclado ou leitor de ecrã podia estar a "percorrer o documento" sem nunca lá
 * estar. Numa caixa que liberta a aceitação de um contrato, isso não é um
 * pormenor. Escape e o bloqueio da rolagem de fundo vêm do primitivo.
 *
 * A medição do fim do documento é exatamente a que a D30 descreve.
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

  // O `aoChegarAoFim` chega numa função nova a cada render do formulário. Numa
  // dependência de efeito isso era o efeito a correr sem parar; guardado numa
  // ref, o efeito corre uma vez e continua a chamar a versão mais recente.
  const avisar = useRef(aoChegarAoFim);
  avisar.current = aoChegarAoFim;

  const verificar = () => {
    const el = corpo.current;
    if (!el) return;
    // 24px de tolerância: com zoom do browser ou barras de rolagem do sistema, o
    // `scrollTop` máximo fica uns pixels abaixo da conta e o fim nunca era dado
    // por atingido — quem rolava até não haver mais continuava preso.
    const noFim = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
    if (!noFim) return;
    setChegouAoFim(true);
    avisar.current();
  };

  // Um documento que caiba todo no ecrã não tem fim para onde rolar: sem isto,
  // um monitor grande ou um texto curto deixavam a caixa trancada para sempre.
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
      // O foco de partida é o próprio documento, e não o botão de fechar: quem
      // abre isto vem para ler, e assim as setas e o Page Down rolam o texto sem
      // ser preciso primeiro apanhar o painel com o rato.
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
            JMASSANO Escritório de Advogados
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
