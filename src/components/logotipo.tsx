import { cn } from "@/lib/utils";

/**
 * O logo da marca — a wordmark "lexflow" com ondas (o ficheiro que o dono
 * entregou). Não um monograma inventado à mão: a marca é esta, a palavra por
 * extenso com as ondas por cima, e é ela que o cliente e a equipa reconhecem.
 *
 * Há duas versões, porque há dois fundos:
 *  - `escuro` (padrão): a original, com "lex" escura e "flow" latão — para
 *    fundos claros (login, onboarding, submetido, termos, erro).
 *  - `sobreEscuro`: a mesma wordmark com a palavra "lex" em quase-branco,
 *    para assentar na tinta sólida da barra lateral do backoffice.
 *
 * O `titulo` alimenta o `alt`/`aria-label` — é o que o leitor de ecrã diz.
 * Ninguém descreve um logo dizendo "LF no quadrado verde": diz "LexFlow".
 */
export function Logotipo({
  className,
  titulo = "LexFlow — software de gestão para sociedades de advogados",
  sobreEscuro = false,
  logotipoUrl,
}: {
  className?: string;
  titulo?: string;
  sobreEscuro?: boolean;
  logotipoUrl?: string | null;
}) {
  const fonte = logotipoUrl || (sobreEscuro ? "/lexflow-clara.png" : "/lexflow.svg");
  return (
    /* eslint-disable-next-line @next/next/no-img-element -- a app não usa `next/image`; um <img> simples com alt honesto é o que cabe aqui. */
    <img
      src={fonte}
      alt={titulo}
      aria-label={titulo}
      title={titulo}
      className={cn("select-none", className)}
    />
  );
}
