"use client";

import { useState, useTransition } from "react";
import { Copy, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Ref } from "@/components/ref-processo";
import { criarProcesso } from "../acoes";

/**
 * Cria um processo e mostra o link mágico uma única vez.
 *
 * Uma única vez a sério: o token só existe em claro aqui. Se a página for
 * recarregada, ele desaparece — na base de dados só há o hash.
 */
export function BotaoNovoProcesso({ tamanho = "default" }: { tamanho?: "default" | "sm" }) {
  const [aCriar, transicao] = useTransition();
  const [resultado, setResultado] = useState<{ referencia: string; link: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const criar = () =>
    transicao(async () => {
      setErro(null);
      const r = await criarProcesso("particular");
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      setResultado({
        referencia: r.referencia,
        link: `${window.location.origin}/onboarding/${r.token}`,
      });
    });

  const copiar = async () => {
    if (!resultado) return;
    await navigator.clipboard.writeText(resultado.link);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1800);
  };

  if (resultado) {
    return (
      <div className="border-arquivo/40 bg-arquivo/5 flex w-full flex-col gap-3 rounded-sm border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">
            Processo <Ref>{resultado.referencia}</Ref> criado
          </p>
          <a
            href={resultado.link}
            className="text-arquivo text-sm underline underline-offset-4"
            target="_blank"
            rel="noopener"
          >
            Abrir o formulário
          </a>
        </div>

        <div className="flex gap-2">
          <input
            readOnly
            value={resultado.link}
            onFocus={(e) => e.currentTarget.select()}
            className="border-linha bg-papel-alto min-w-0 flex-1 rounded-sm border px-2 py-1.5 font-mono text-xs"
            aria-label="Link de preenchimento"
          />
          <Button type="button" variant="outline" size="sm" onClick={copiar}>
            <Copy className="size-3.5" />
            {copiado ? "Copiado" : "Copiar"}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Envie este link ao cliente. Não volta a ser mostrado — na base de dados
          fica só o resumo criptográfico. Expira em 30 dias.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button onClick={criar} disabled={aCriar} size={tamanho}>
        <Plus className="size-4" />
        {aCriar ? "A criar…" : "Novo processo"}
      </Button>
      {erro && <p className="text-selo text-xs">{erro}</p>}
    </div>
  );
}
