import { cn } from "@/lib/utils";

/**
 * O emblema LexFlow — monograma "LF" sobre verde-arquivo, com o nome por
 * extenso por baixo. Vetorial e não raster: fica nítido em qualquer tamanho,
 * do ícone da barra recolhida (24px) ao cabeçalho da entrada (64px), e usa as
 * mesmas fontes e tokens de cor do resto da aplicação (`--arquivo`/`--latao`,
 * `font-display`, `font-mono`) em vez de os ter cozinhados num PNG à parte —
 * é por isso que escala sem desfocar e por que as duas cores acompanham o
 * tema escuro sem precisar de um segundo ficheiro.
 *
 * A marca é a do software e não a da sociedade que o usa: quem vê este
 * emblema é a equipa, dentro da aplicação. O que é da sociedade — o nome nos
 * documentos, o responsável pelo tratamento nos textos de RGPD — vive noutro
 * sítio e não passa por aqui.
 */
export function Logotipo({
  className,
  titulo = "LexFlow — Software de gestão para sociedades de advogados",
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
        LF
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
        LEXFLOW
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
        SOFTWARE
      </text>
    </svg>
  );
}
