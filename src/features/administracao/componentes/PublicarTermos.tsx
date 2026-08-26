"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Ref } from "@/components/ref-processo";
import { publicarTermosSociedade } from "../acoes";

const dataCurta = new Intl.DateTimeFormat("pt-PT", { dateStyle: "long" });

/**
 * Publicar uma versão nova do articulado da sociedade.
 *
 * O ecrã diz, antes de qualquer campo, o que está em vigor — porque a operação
 * que se vai fazer aqui é **substituir** aquilo, e a pergunta que quem publica
 * tem de conseguir responder sozinho é "o que é que está lá agora?".
 *
 * A versão é obrigatória e o servidor recusa repeti-la (D3/D38). Isso podia
 * parecer burocracia; não é. Substituir o PDF mantendo a versão apaga a
 * diferença entre o que cada cliente e cada advogado aceitou e o que passou a
 * estar escrito — e essa diferença é precisamente a prova que esta parte do
 * sistema existe para guardar.
 */
export function PublicarTermos({
  versaoAtual,
  atualizadoEm,
  nomeDocumento,
}: {
  versaoAtual: string | null;
  atualizadoEm: Date | null;
  nomeDocumento: string | null;
}) {
  const router = useRouter();
  const [erros, setErros] = useState<Record<string, string[]>>({});
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [aPublicar, transicao] = useTransition();
  const formulario = useRef<HTMLFormElement>(null);

  const enviar = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    setMensagem(null);
    setSucesso(null);

    transicao(async () => {
      try {
        const r = await publicarTermosSociedade(fd);
        if (!r.ok) {
          setErros(r.erros ?? {});
          setMensagem(r.mensagem);
          return;
        }
        setErros({});
        setSucesso(
          `Versão ${r.versao} publicada. É esta que os clientes e a equipa passam a aceitar.`,
        );
        // Limpar o formulário é o que permite publicar outra versão a seguir
        // sem recarregar — e, sobretudo, o que impede publicar duas vezes o
        // mesmo ficheiro por o campo ter ficado preenchido.
        formulario.current?.reset();
        router.refresh();
      } catch {
        setMensagem("O servidor não respondeu. Verifique a ligação e tente de novo.");
      }
    });
  };

  return (
    <section className="border-linha bg-papel-alto flex flex-col gap-4 rounded-sm border p-4">
      <div>
        <h2 className="text-lg">Termos e Condições da sociedade</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          É este articulado que os vossos clientes leem e aceitam no passo final do registo, e que
          cada pessoa da equipa aceita no registo dela.
        </p>
      </div>

      <div className="border-linha bg-muted flex flex-col gap-1 rounded-sm border p-3">
        {versaoAtual ? (
          <>
            <p className="text-sm">
              Em vigor: <Ref>{versaoAtual}</Ref>
            </p>
            <p className="text-xs text-muted-foreground">
              {nomeDocumento ?? "documento"}
              {atualizadoEm ? ` · publicado em ${dataCurta.format(new Date(atualizadoEm))}` : ""}
            </p>
          </>
        ) : (
          <>
            <p className="text-latao text-sm">Nenhum articulado publicado.</p>
            <p className="text-xs text-muted-foreground">
              Enquanto assim for, os vossos clientes aceitam o texto genérico da plataforma — texto
              de demonstração, não o contrato da sociedade.
            </p>
          </>
        )}
      </div>

      {mensagem && (
        <p className="border-selo/40 bg-selo/5 text-selo rounded-sm border p-3 text-sm" role="alert">
          {mensagem}
        </p>
      )}
      {sucesso && (
        <p className="border-arquivo/40 bg-arquivo/5 text-arquivo rounded-sm border p-3 text-sm">
          {sucesso}
        </p>
      )}

      <form ref={formulario} onSubmit={enviar} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="versao-termos" className="text-tinta-suave">
            Versão <span className="text-selo">*</span>
          </Label>
          <Input
            id="versao-termos"
            name="versao"
            className="font-mono"
            placeholder="2026.08.1"
            aria-invalid={Boolean(erros.versao)}
          />
          {erros.versao?.[0] ? (
            <p className="text-selo text-xs" role="alert">
              {erros.versao[0]}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Tem de mudar sempre que o documento mudar. Cada aceitação fica gravada com a versão
              que estava em vigor no momento — repetir a versão apaga a diferença entre o que já
              foi aceite e o que passa a estar escrito.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ficheiro-termos" className="text-tinta-suave">
            Documento (PDF) <span className="text-selo">*</span>
          </Label>
          <input
            id="ficheiro-termos"
            name="ficheiro"
            type="file"
            accept=".pdf"
            className="file:bg-tinta file:text-papel-alto text-sm file:mr-3 file:rounded-sm file:border-0 file:px-3 file:py-1.5 file:text-sm"
          />
          {erros.ficheiro?.[0] ? (
            <p className="text-selo text-xs" role="alert">
              {erros.ficheiro[0]}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Só PDF, no máximo 4 MB. Uma fotografia de um contrato não é um contrato legível.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          {versaoAtual && (
            <a
              href="/gestao/sociedade/termos"
              target="_blank"
              rel="noopener"
              className="text-xs text-muted-foreground underline underline-offset-2"
            >
              <FileText className="mr-1 inline size-3" />
              Ver o articulado em vigor
            </a>
          )}
          <Button type="submit" disabled={aPublicar} className="ml-auto">
            <Upload className="size-4" />
            {aPublicar ? "A publicar…" : versaoAtual ? "Publicar nova versão" : "Publicar"}
          </Button>
        </div>
      </form>
    </section>
  );
}
