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

/** A proposta que a sociedade anexou a **este** processo, quando existe. */
export type PropostaAnexada = {
  nome: string;
  bytes: number;
  /** A rota que a serve, autorizada pelo mesmo token do link mágico. */
  url: string;
};

const kb = (b: number) =>
  b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

/**
 * A proposta de honorários, e a porta que ela fecha.
 *
 * Mesmo padrão do `LeitorTermos`: a caixa "Aceito a proposta" só se destranca
 * depois de o documento ser aberto — a proposta é o documento que fixa o que o
 * cliente vai pagar, e uma aceitação sem o ter visto não prova nada.
 *
 * **Há dois documentos possíveis, e a diferença entre eles importa.**
 *
 * Quando a sociedade anexou uma proposta ao convite (`anexada`), é essa que se
 * mostra — é a proposta *deste* cliente, com os valores que lhe foram
 * negociados, e é essa que ele aceita. Sem anexo, cai-se no `/custos.html` que
 * vive em `public/`: a proposta genérica, igual para toda a gente, que é o que
 * havia antes de o upload existir e continua a servir uma demonstração.
 *
 * A medição de "leu até ao fim" só se aplica ao segundo. O HTML é injetado num
 * `<div>` nosso e o fim do documento é uma medição do próprio elemento (D30); um
 * PDF anexado não se pode medir assim, e nem sequer se pode embeber — o
 * `X-Frame-Options: DENY` de `next.config.ts` recusa **também** o mesmo domínio,
 * e um `<iframe>` daria ao cliente um retângulo em branco sem explicação
 * nenhuma. Com anexo, portanto, a porta destranca-se ao **abrir** o documento
 * em separador próprio, e não ao chegar ao fim dele. É menos do que a D30 pedia
 * e é o que se consegue prometer com verdade; fingir uma medição que não se faz
 * seria pior do que não a fazer.
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant={lido ? "outline" : "default"} onClick={() => setAberto(true)}>
          <FileText className="size-4" />
          {lido ? "Rever a proposta de honorários" : "Abrir e ler a proposta de honorários"}
        </Button>

        {!anexada && (
          <a
            href="/custos.pdf"
            target="_blank"
            rel="noopener"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-tinta"
          >
            Abrir o PDF oficial em separador próprio
            <ExternalLink className="ml-1 inline size-3" />
          </a>
        )}
      </div>

      {lido ? (
        <p className="text-arquivo flex items-center gap-1.5 text-xs">
          <Check className="size-3.5" strokeWidth={2.5} />
          {anexada ? "Documento aberto." : "Documento lido até ao fim."}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {anexada
            ? "Para poder aceitar, abra o documento que a sociedade lhe enviou."
            : "Para poder aceitar, abra o documento e percorra-o até ao fim."}
        </p>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        {aberto &&
          (anexada ? (
            <ModalAnexada
              aoFechar={() => setAberto(false)}
              lido={lido}
              aoAbrir={aoLer}
              proposta={anexada}
            />
          ) : (
            <Modal aoFechar={() => setAberto(false)} lido={lido} aoChegarAoFim={aoLer} />
          ))}
      </Dialog>
    </div>
  );
}

/**
 * A proposta que a sociedade anexou: um PDF, servido pela rota do token.
 *
 * Não se embebe (ver a nota do componente acima). O que o modal faz é dizer que
 * documento é, dar-lhe um botão que o abre em separador próprio, e só depois
 * disso deixar fechar com "Li e compreendi" — que é o gesto que destranca a
 * caixa de aceitação lá fora.
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
    <DialogContent className="max-w-lg" aria-describedby={undefined}>
      <DialogHeader className="pr-8">
        <DialogTitle>Proposta de Honorários</DialogTitle>
      </DialogHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-5">
        <p className="text-sm text-muted-foreground">
          Esta é a proposta que a JMASSANO preparou para si. Abra-a e leia-a com
          atenção antes de a aceitar — é o documento que fixa os serviços e os
          honorários acordados.
        </p>

        <div className="border-linha bg-papel-alto flex items-center gap-3 rounded-sm border p-3">
          <FileText className="text-tinta-suave size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{proposta.nome}</p>
            <p className="text-xs text-muted-foreground">PDF · {kb(proposta.bytes)}</p>
          </div>
        </div>

        <Button asChild variant={abriu ? "outline" : "default"} className="w-fit">
          <a
            href={proposta.url}
            target="_blank"
            rel="noopener"
            onClick={() => {
              setAbriu(true);
              aoAbrir();
            }}
          >
            <Maximize2 className="size-3.5" />
            {abriu ? "Abrir outra vez" : "Abrir a proposta (PDF)"}
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
      {/* O PDF oficial vive aqui, em link discreto ao lado do título, e não
          numa faixa própria por cima do rodapé: era uma barra da largura toda,
          em latão, a competir com o botão que faz avançar o passo — e a repetir
          o mesmo link que já está fora do modal. Continua ao alcance de quem o
          queira, sem ser o que mais salta à vista num documento que se pede
          para ler. */}
      <DialogHeader className="flex-row items-baseline justify-between gap-4 pr-8">
        <DialogTitle>Proposta de Honorários</DialogTitle>
        <a
          href="/custos.pdf"
          target="_blank"
          rel="noopener"
          className="text-muted-foreground hover:text-tinta shrink-0 text-xs underline underline-offset-2"
        >
          PDF oficial
          <ExternalLink className="ml-1 inline size-3" />
        </a>
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
