"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
 * A janela do documento.
 *
 * Passou a assentar no `Dialog` da aplicação em vez de ser uma caixa `fixed`
 * escrita à mão. O que se ganha não é aparência — é o que faltava: a armadilha
 * de foco. Antes, o `Tab` dentro da janela saía para os campos do formulário
 * por baixo, e quem navega por teclado ou leitor de ecrã podia estar a
 * "percorrer o documento" sem nunca lá estar. Numa caixa que liberta a
 * aceitação de um contrato, isso não é um pormenor. Escape e o bloqueio da
 * rolagem de fundo deixam de ser código nosso: vêm do primitivo.
 *
 * A medição do fim do documento fica exatamente como estava — é ela que a D30
 * descreve, e não havia razão para lhe tocar.
 */
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
    <DialogContent
      className="h-[92svh] max-w-3xl sm:h-[80svh]"
      aria-describedby={undefined}
      // O foco de partida é o próprio documento, e não o botão de fechar: quem
      // abre isto vem para ler, e assim as setas e o Page Down rolam o texto
      // sem ser preciso primeiro apanhar o painel com o rato.
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        corpo.current?.focus();
      }}
    >
      <DialogHeader>
        <DialogTitle>Termos e Condições</DialogTitle>
        <p className="text-2xs font-mono tracking-[0.14em] text-muted-foreground uppercase">
          Versão {VERSAO_TERMOS}
        </p>
      </DialogHeader>

      <div
        ref={corpo}
        onScroll={verificar}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-5 text-sm leading-relaxed"
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
