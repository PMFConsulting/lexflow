"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Faceta = { chave: string; n: number };

const ROTULOS: Record<string, string> = {
  rascunho: "Rascunho",
  submetido: "Submetido",
  em_revisao: "Em revisão",
  pendente_cliente: "Pendente do cliente",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
  arquivado: "Arquivado",
  particular: "Particular",
  empresa: "Empresa",
};

/**
 * Filtros facetados com contagens, com o estado no URL.
 *
 * É isto que faz um filtro ser partilhável por link — o colega abre o mesmo
 * endereço e vê exatamente a mesma lista.
 */
export function Filtros({
  facetas,
}: {
  facetas: { porEstado: Faceta[]; porTipo: Faceta[] };
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [aFiltrar, transicao] = useTransition();

  const aplicar = (mudar: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(sp.toString());
    mudar(p);
    p.delete("pagina");
    transicao(() => router.push(`/processos?${p}`));
  };

  const alternar = (campo: string, valor: string) =>
    aplicar((p) => {
      const atuais = p.getAll(campo);
      p.delete(campo);
      const novos = atuais.includes(valor)
        ? atuais.filter((v) => v !== valor)
        : [...atuais, valor];
      novos.forEach((v) => p.append(campo, v));
    });

  const ativo = (campo: string, valor: string) => sp.getAll(campo).includes(valor);
  const temFiltros = ["estado", "tipo", "ppe", "q"].some((c) => sp.has(c));

  const grupo = (campo: string, itens: Faceta[]) =>
    itens.length === 0 ? null : (
      <div className="flex flex-wrap items-center gap-1.5">
        {itens.map((i) => (
          <button
            key={i.chave}
            type="button"
            onClick={() => alternar(campo, i.chave)}
            aria-pressed={ativo(campo, i.chave)}
            className={cn(
              "border-linha inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-xs transition-colors",
              ativo(campo, i.chave)
                ? "border-tinta bg-tinta text-papel-alto"
                : "bg-papel-alto hover:border-tinta-suave",
            )}
          >
            {ROTULOS[i.chave] ?? i.chave}
            <span className="font-mono tabular-nums opacity-60">{i.n}</span>
          </button>
        ))}
      </div>
    );

  return (
    <div className="border-linha bg-papel-alto flex flex-col gap-3 rounded-sm border p-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const v = new FormData(e.currentTarget).get("q");
          aplicar((p) => {
            const s = String(v ?? "").trim();
            if (s) p.set("q", s);
            else p.delete("q");
          });
        }}
      >
        <Input
          name="q"
          defaultValue={sp.get("q") ?? ""}
          placeholder="Referência, nome ou NIF — os acentos não importam"
          className="h-9"
          aria-label="Pesquisar processos"
        />
      </form>

      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {grupo("estado", facetas.porEstado)}
        {grupo("tipo", facetas.porTipo)}

        <div className="flex flex-wrap items-center gap-1.5">
          {(["sim", "nao"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() =>
                aplicar((p) => (p.get("ppe") === v ? p.delete("ppe") : p.set("ppe", v)))
              }
              aria-pressed={sp.get("ppe") === v}
              className={cn(
                "border-linha rounded-sm border px-2 py-1 text-xs transition-colors",
                sp.get("ppe") === v
                  ? "border-tinta bg-tinta text-papel-alto"
                  : "bg-papel-alto hover:border-tinta-suave",
              )}
            >
              PPE {v === "sim" ? "sim" : "não"}
            </button>
          ))}
        </div>

        {temFiltros && (
          <button
            type="button"
            onClick={() => transicao(() => router.push("/processos"))}
            className="text-muted-foreground hover:text-selo inline-flex items-center gap-1 text-xs"
          >
            <X className="size-3" />
            Limpar
          </button>
        )}

        {aFiltrar && <span className="text-xs text-muted-foreground">a filtrar…</span>}
      </div>
    </div>
  );
}
