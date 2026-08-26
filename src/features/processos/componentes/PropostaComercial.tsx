"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, TriangleAlert, Upload } from "lucide-react";
import { Label } from "@/components/ui/label";
import { carregarPropostaComercial } from "../proposta";

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
  atual: { id: string; nome: string; bytes: number } | null;
}) {
  const id = useId();
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, transicao] = useTransition();

  const escolher = (lista: FileList | null) => {
    const f = lista?.[0];
    if (!f) return;
    setErro(null);

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
    <div className="border-linha bg-papel-alto mt-4 flex flex-col gap-3 rounded-sm border border-dashed p-4">
      <div>
        <h3 className="text-sm font-medium">Proposta comercial</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {atual
            ? "É esta a proposta que o cliente lê e aceita no fim do processo. Anexar outro ficheiro substitui esta."
            : "Ainda não anexaste a proposta deste processo. O cliente só a pode aceitar depois de a anexares."}
        </p>
      </div>

      {atual && (
        <div className="border-linha bg-muted/40 flex items-center gap-3 rounded-sm border p-2.5">
          <FileText className="text-tinta-suave size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{atual.nome}</p>
            <p className="text-xs text-muted-foreground">
              PDF ·{" "}
              {atual.bytes < 1024 * 1024
                ? `${Math.round(atual.bytes / 1024)} KB`
                : `${(atual.bytes / 1024 / 1024).toFixed(1)} MB`}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id} className="text-tinta-suave">
          Selecionar PDF
        </Label>
        <input
          id={id}
          ref={entrada}
          type="file"
          accept=".pdf,application/pdf"
          onChange={(e) => escolher(e.target.files)}
          className="file:bg-tinta file:text-papel-alto text-sm file:mr-3 file:rounded-sm file:border-0 file:px-3 file:py-1.5 file:text-sm"
        />
        <p className="text-xs text-muted-foreground">PDF, até 4 MB.</p>
      </div>

      {aEnviar && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Upload className="size-3.5" />A enviar…
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
