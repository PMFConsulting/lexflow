"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";

/** Pesquisa de clientes por nome, NIF ou email, com o termo no URL. */
export function PesquisaClientes() {
  const router = useRouter();
  const sp = useSearchParams();
  const [aFiltrar, transicao] = useTransition();

  return (
    <div className="border-linha bg-papel-alto flex flex-wrap items-center gap-3 rounded-sm border p-3">
      <form
        className="min-w-0 flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          const v = String(new FormData(e.currentTarget).get("q") ?? "").trim();
          const p = new URLSearchParams();
          if (v) p.set("q", v);
          transicao(() => router.push(`/clientes?${p}`));
        }}
      >
        <Input
          name="q"
          defaultValue={sp.get("q") ?? ""}
          placeholder="Nome, NIF ou email — os acentos não importam"
          className="h-9"
          aria-label="Pesquisar clientes"
        />
      </form>

      {sp.has("q") && (
        <button
          type="button"
          onClick={() => transicao(() => router.push("/clientes"))}
          className="text-muted-foreground hover:text-selo inline-flex items-center gap-1 text-xs"
        >
          <X className="size-3" />
          Limpar
        </button>
      )}

      {aFiltrar && <span className="text-xs text-muted-foreground">a filtrar…</span>}
    </div>
  );
}
