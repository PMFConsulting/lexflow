import { cn } from "@/lib/utils";

const formatador = new Intl.DateTimeFormat("pt-PT", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
});

const formatadorHora = new Intl.DateTimeFormat("pt-PT", {
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * O carimbo. Aplicado quando um passo é validado e gravado.
 *
 * É o único momento de animação com peso na aplicação — 180ms, com a rotação
 * de um carimbo real a bater no papel. Com `prefers-reduced-motion` fica
 * imediato, tratado globalmente em globals.css.
 */
export function Carimbo({
  data,
  rotulo = "Validado",
  className,
}: {
  data: Date;
  rotulo?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "animate-carimbo grid size-16 shrink-0 place-items-center rounded-full",
        "border-2 border-selo/25 bg-selo/8 text-selo select-none",
        className,
      )}
      role="img"
      aria-label={`${rotulo} a ${formatador.format(data)} às ${formatadorHora.format(data)}`}
    >
      <div className="text-center leading-none">
        <div className="text-2xs font-medium tracking-[0.14em] uppercase opacity-70">
          {rotulo}
        </div>
        <div className="mt-1 font-mono text-xs font-medium tabular-nums">
          {formatador.format(data)}
        </div>
        <div className="font-mono text-2xs tabular-nums opacity-70">
          {formatadorHora.format(data)}
        </div>
      </div>
    </div>
  );
}

/**
 * Versão compacta para listagens: quantos dos 6 carimbos o processo já tem.
 * Mesmo vocabulário, densidade de tabela.
 */
export function Carimbos({
  concluidos,
  total = 6,
  className,
}: {
  concluidos: number;
  total?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("flex items-center gap-1", className)}
      role="img"
      aria-label={`${concluidos} de ${total} passos validados`}
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            "size-2 rounded-full border",
            i < concluidos
              ? "border-selo/40 bg-selo/25"
              : "border-linha bg-transparent",
          )}
        />
      ))}
      <span className="ml-1.5 font-mono text-xs text-muted-foreground tabular-nums">
        {concluidos}/{total}
      </span>
    </div>
  );
}
