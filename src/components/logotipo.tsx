import { cn } from "@/lib/utils";

/**
 * O emblema JMASSANO — monograma "JM" sobre verde-arquivo, com o nome por
 * extenso por baixo. Vetorial e não raster: fica nítido em qualquer tamanho,
 * do ícone da barra recolhida (24px) ao cabeçalho da entrada (64px), e usa as
 * mesmas fontes e tokens de cor do resto da aplicação (`--arquivo`/`--latao`,
 * `font-display`, `font-mono`) em vez de os ter cozinhados num PNG à parte —
 * é por isso que escala sem desfocar e por que as duas cores acompanham o
 * tema escuro sem precisar de um segundo ficheiro.
 */
export function Logotipo({
  className,
  titulo = "JMASSANO — Escritório de Advogado",
}: {
  className?: string;
  titulo?: string;
}) {
  return (
    <svg
      viewBox="0 0 120 102"
      role="img"
      aria-label={titulo}
      className={cn("shrink-0", className)}
    >
      <rect
        x="0.75"
        y="0.75"
        width="118.5"
        height="100.5"
        rx="9"
        style={{ fill: "var(--arquivo)" }}
      />
      <text
        x="60"
        y="53"
        textAnchor="middle"
        fontSize="46"
        className="font-display"
        style={{ fill: "var(--latao)", letterSpacing: "-0.01em" }}
      >
        JM
      </text>
      <line
        x1="33"
        y1="64.5"
        x2="87"
        y2="64.5"
        strokeWidth="1.1"
        opacity="0.45"
        style={{ stroke: "var(--latao)" }}
      />
      <text
        x="60"
        y="80"
        textAnchor="middle"
        fontSize="12.5"
        className="font-mono font-medium"
        style={{ fill: "var(--latao)", letterSpacing: "0.2em" }}
      >
        MASSANO
      </text>
      <text
        x="60"
        y="93"
        textAnchor="middle"
        fontSize="8.5"
        opacity="0.7"
        className="font-mono"
        style={{ fill: "var(--latao)", letterSpacing: "0.16em" }}
      >
        ADVOGADO
      </text>
    </svg>
  );
}
