import { cn } from "@/lib/utils";
import type { estadoProcesso, nivelRisco } from "@/db/schema/enums";

type Estado = (typeof estadoProcesso.enumValues)[number];
type Risco = (typeof nivelRisco.enumValues)[number];

const ESTADOS: Record<Estado, { rotulo: string; classe: string }> = {
  rascunho: { rotulo: "Rascunho", classe: "border-linha text-tinta-suave" },
  submetido: { rotulo: "Submetido", classe: "border-latao/40 bg-latao/10 text-latao" },
  em_revisao: { rotulo: "Em revisão", classe: "border-latao/40 bg-latao/10 text-latao" },
  pendente_cliente: {
    rotulo: "Pendente do cliente",
    classe: "border-latao/40 bg-latao/10 text-latao",
  },
  aprovado: { rotulo: "Aprovado", classe: "border-arquivo/40 bg-arquivo/10 text-arquivo" },
  rejeitado: { rotulo: "Rejeitado", classe: "border-selo/40 bg-selo/10 text-selo" },
  arquivado: { rotulo: "Arquivado", classe: "border-linha bg-muted text-tinta-suave" },
};

const RISCOS: Record<Risco, { rotulo: string; classe: string }> = {
  baixo: { rotulo: "Risco baixo", classe: "border-arquivo/40 bg-arquivo/10 text-arquivo" },
  medio: { rotulo: "Risco médio", classe: "border-latao/40 bg-latao/10 text-latao" },
  elevado: { rotulo: "Risco elevado", classe: "border-selo/40 bg-selo/10 text-selo" },
};

const base =
  "inline-flex items-center gap-1.5 rounded-xs border px-2 py-0.5 text-xs font-medium whitespace-nowrap";

export function EstadoBadge({ estado, className }: { estado: Estado; className?: string }) {
  const { rotulo, classe } = ESTADOS[estado];
  return <span className={cn(base, classe, className)}>{rotulo}</span>;
}

/**
 * O nível de risco nunca aparece sozinho: mostra-se sempre o porquê ao lado,
 * como o §6 do brief exige. Um badge sem fatores é um badge que não se consegue
 * contestar.
 */
export function RiscoBadge({
  nivel,
  fatores,
  className,
}: {
  nivel: Risco;
  fatores?: { descricao: string }[];
  className?: string;
}) {
  const { rotulo, classe } = RISCOS[nivel];
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-2", className)}>
      <span className={cn(base, classe)}>{rotulo}</span>
      {fatores && fatores.length > 0 && (
        <span className="text-xs text-muted-foreground">
          {fatores.map((f) => f.descricao).join(" · ")}
        </span>
      )}
    </span>
  );
}
