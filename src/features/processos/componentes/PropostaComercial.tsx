"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, FileText, TriangleAlert, Upload } from "lucide-react";
import { formatarDataCurta } from "@/lib/datas";
import { cn } from "@/lib/utils";
import { carregarPropostaComercial } from "../proposta";

const kb = (b: number) =>
  b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

/**
 * Anexar (ou substituir) a proposta comercial de um processo já aberto.
 *
 * A janela "Novo processo" também a aceita, e é lá que ela entra no caso
 * normal. Isto existe para o caso que é quase tão normal: a proposta ainda não
 * estava fechada quando o dossier se abriu. Sem este ecrã, a única saída era
 * criar um segundo processo — com uma segunda referência e um segundo link —
 * só para poder anexar um PDF, o que é caro e é a receita para dois dossiers
 * do mesmo cliente.
 *
 * Substituir mantém-se possível de propósito, e não é descuido: uma proposta
 * renegociada é o caso comum, e o servidor põe a anterior em soft delete em vez
 * de a apagar, para ficar a prova de qual substituiu qual.
 */
export function PropostaComercial({
  processoId,
  atual,
}: {
  processoId: string;
  /** A que já lá está, se já lá está alguma. */
  atual: { id: string; nome: string; bytes: number; criadoEm?: Date | string | null } | null;
}) {
  const id = useId();
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [substituir, setSubstituir] = useState(false);
  const [arrastar, setArrastar] = useState(false);
  const [aEnviar, transicao] = useTransition();

  const escolher = (lista: FileList | null) => {
    const f = lista?.[0];
    if (!f) return;
    setErro(null);
    setSubstituir(Boolean(atual));

    const fd = new FormData();
    fd.set("ficheiro", f);

    transicao(async () => {
      try {
        const r = await carregarPropostaComercial(processoId, fd);
        if (!r.ok) {
          setErro(r.erro);
          return;
        }
        // O `revalidatePath` do servidor trata da cache; o `refresh` é o que
        // faz esta página voltar a montar com o documento novo à frente.
        router.refresh();
      } catch {
        setErro("Não foi possível enviar o ficheiro. Tente de novo.");
      } finally {
        // Limpar o campo é o que permite voltar a escolher o *mesmo* ficheiro
        // depois de um erro — sem isto o `change` não volta a disparar. Mesma
        // nota do `Anexos` do onboarding.
        if (entrada.current) entrada.current.value = "";
      }
    });
  };

  return (
    <div className="border-linha bg-papel-alto mt-4 flex flex-col gap-4 rounded-sm border p-4">
      <div>
        <p className="text-2xs font-mono tracking-[0.14em] text-muted-foreground uppercase">
          Proposta comercial
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {atual
            ? "É esta a proposta que o cliente lê e aceita no fim do processo. Anexar outro ficheiro substitui esta."
            : "Ainda não anexaste a proposta deste processo. O cliente só a pode aceitar depois de a anexares."}
        </p>
      </div>

      {atual ? (
        <div className="border-linha bg-papel flex items-center gap-3 rounded-sm border p-3">
          <div className="border-arquivo/30 bg-arquivo/10 text-arquivo flex size-11 shrink-0 items-center justify-center rounded-sm border">
            <FileText className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{atual.nome}</p>
            <p className="text-xs text-muted-foreground">
              PDF · {kb(atual.bytes)}
              {atual.criadoEm && ` · anexada em ${formatarDataCurta(atual.criadoEm)}`}
            </p>
          </div>
          <span className="border-arquivo/40 bg-arquivo/10 text-arquivo text-2xs inline-flex shrink-0 items-center gap-1 rounded-sm border px-2 py-0.5 font-medium whitespace-nowrap">
            <Check className="size-3" strokeWidth={2.5} />
            Proposta ativa
          </span>
        </div>
      ) : (
        <div
          className="border-latao/40 bg-latao/5 text-latao flex items-center gap-2 rounded-sm border border-dashed p-3 text-xs"
          role="alert"
        >
          <TriangleAlert className="size-4 shrink-0" />
          Sem proposta anexada.
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setArrastar(true);
        }}
        onDragLeave={() => setArrastar(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastar(false);
          escolher(e.dataTransfer.files);
        }}
        className={cn(
          "border-linha flex flex-col items-center gap-2 rounded-sm border border-dashed p-5 text-center transition-colors",
          arrastar && "border-marca bg-marca/5",
        )}
      >
        <div className="text-marca bg-marca/10 flex size-9 items-center justify-center rounded-sm">
          <Upload className="size-4" />
        </div>

        <input
          id={id}
          ref={entrada}
          type="file"
          accept=".pdf,application/pdf"
          onChange={(e) => escolher(e.target.files)}
          className="sr-only"
        />
        <label
          htmlFor={id}
          className="bg-tinta text-papel-alto hover:bg-tinta/90 focus-within:ring-ring inline-flex cursor-pointer items-center justify-center rounded-sm px-3 py-1.5 text-sm font-medium transition-colors focus-within:ring-2 focus-within:outline-none"
        >
          {atual ? "Substituir proposta" : "Anexar proposta"}
        </label>
        <p className="text-xs text-muted-foreground">
          Arraste o PDF para aqui ou clique para escolher. Até 4 MB.
        </p>
      </div>

      {aEnviar && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Upload className="size-3.5" />
          {substituir ? "A substituir a proposta anterior…" : "A enviar…"}
        </p>
      )}
      {erro && (
        <p className="text-selo flex items-start gap-1.5 text-xs" role="alert">
          <TriangleAlert className="mt-px size-3 shrink-0" />
          <span>{erro}</span>
        </p>
      )}
    </div>
  );
}
