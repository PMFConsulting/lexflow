"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { trocarSociedade } from "@/features/conta/acoes";

/**
 * O seletor de sociedade ativa (BUG3-002).
 *
 * Só existe montado quando a conta tem mais do que uma sociedade — a decisão
 * de o mostrar ou não é de quem chama (`portal-shell`), e não deste
 * componente: ele assume que `opcoes` já vem filtrada para o caso que
 * interessa.
 */
export function SeletorSociedade({
  atual,
  opcoes,
}: {
  atual: string;
  opcoes: { id: string; nome: string }[];
}) {
  const router = useRouter();
  const [aTrocar, transicao] = useTransition();

  return (
    <label className="flex min-w-0 items-center gap-1.5 text-2xs opacity-70 group-data-[collapsible=icon]:hidden">
      <Building2 className="size-3.5 shrink-0" />
      <select
        value={atual}
        disabled={aTrocar}
        onChange={(e) => {
          const organizacaoId = e.target.value;
          transicao(async () => {
            const r = await trocarSociedade(organizacaoId);
            if (!r.ok) {
              toast.error(r.erro);
              return;
            }
            router.refresh();
          });
        }}
        aria-label="Sociedade ativa"
        className="w-full min-w-0 truncate rounded-md border border-white/20 bg-transparent px-1.5 py-1 text-2xs text-inherit outline-none focus-visible:ring-1 focus-visible:ring-white/40 disabled:opacity-50"
      >
        {opcoes.map((o) => (
          <option key={o.id} value={o.id} className="text-tinta">
            {o.nome}
          </option>
        ))}
      </select>
    </label>
  );
}
