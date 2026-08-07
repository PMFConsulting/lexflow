"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TERMOS_CONDICOES, VERSAO_TERMOS } from "@/lib/termos";
import { cn } from "@/lib/utils";

/**
 * O documento dos Termos e Condições, e a porta que ele fecha.
 *
 * A caixa de aceitação do passo 7 só se destranca depois de o documento ter
 * sido aberto e percorrido até ao fim — o padrão da banca, e pela mesma razão:
 * uma declaração de que se leu um documento que nunca chegou a ser mostrado não
 * prova coisa nenhuma, e num consentimento sob RGPD é o que se tem de provar.
 *
 * O texto é renderizado aqui dentro, e não num `iframe` para o ficheiro: dentro
 * do componente o fim do documento é uma medição do próprio elemento, sem
 * depender de o browser deixar ler o `scrollTop` de outro documento nem de a
 * folha ter carregado. O mesmo texto está em `/termos-condicoes`, para quem o
 * quiser guardar ou imprimir, e vai em PDF no email de boas-vindas.
 */
export function LeitorTermos({
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
          {lido ? "Rever os Termos e Condições" : "Abrir e ler os Termos e Condições"}
        </Button>

        <a
          href="/termos-condicoes"
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

      {aberto && (
        <Modal
          aoFechar={() => setAberto(false)}
          lido={lido}
          aoChegarAoFim={aoLer}
        />
      )}
    </div>
  );
}

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

  // O `aoChegarAoFim` chega numa função nova a cada render do formulário. Numa
  // dependência de efeito isso era o efeito a correr sem parar; guardado numa
  // ref, o efeito corre uma vez e continua a chamar a versão mais recente.
  const avisar = useRef(aoChegarAoFim);
  avisar.current = aoChegarAoFim;

  // Escape fecha, e o fundo da página não rola por baixo da janela — sem isto,
  // no telemóvel, o dedo rola a página em vez do documento.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") aoFechar();
    };
    document.addEventListener("keydown", tecla);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", tecla);
      document.body.style.overflow = overflow;
    };
  }, [aoFechar]);

  const verificar = () => {
    const el = corpo.current;
    if (!el) return;
    // 24px de tolerância: com zoom do browser ou barras de rolagem do sistema,
    // o `scrollTop` máximo fica uns pixels abaixo da conta e o fim nunca era
    // dado por atingido — o cliente rolava até não haver mais e continuava preso.
    const noFim = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
    if (!noFim) return;
    setChegouAoFim(true);
    avisar.current();
  };

  // Um documento que caiba todo no ecrã não tem fim para onde rolar: sem isto,
  // um monitor grande ou um texto encurtado deixavam a caixa trancada para
  // sempre.
  useEffect(() => {
    const el = corpo.current;
    if (el && el.scrollHeight <= el.clientHeight + 24) {
      setChegouAoFim(true);
      avisar.current();
    }
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-tinta/50 p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Termos e Condições"
    >
      <div className="bg-papel-alto border-linha flex h-[92svh] w-full max-w-3xl flex-col rounded-t-sm border sm:h-[80svh] sm:rounded-sm">
        <header className="border-linha flex items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <h2 className="text-lg leading-tight">Termos e Condições</h2>
            <p className="text-2xs font-mono tracking-[0.14em] text-muted-foreground uppercase">
              Versão {VERSAO_TERMOS}
            </p>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            className="text-sm text-muted-foreground hover:text-tinta"
          >
            Fechar
          </button>
        </header>

        <div
          ref={corpo}
          onScroll={verificar}
          tabIndex={0}
          className="flex-1 overflow-y-auto px-5 py-5 text-sm leading-relaxed"
        >
          {TERMOS_CONDICOES.map((seccao) => (
            <section key={seccao.titulo} className="mb-6">
              <h3 className="mb-2 font-medium">{seccao.titulo}</h3>
              {seccao.paragrafos.map((p, i) => (
                <p key={i} className="mb-2 text-muted-foreground">
                  {p}
                </p>
              ))}
            </section>
          ))}
        </div>

        <footer className="border-linha flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
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
        </footer>
      </div>
    </div>
  );
}
