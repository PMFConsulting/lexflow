import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Carimbo } from "@/components/carimbo";
import { PASSOS, passoAplicavel } from "../passos";

/**
 * A lombada do dossier.
 *
 * Os sete passos numerados — aqui a numeração justifica-se, é uma sequência
 * real e obrigatória. Cada passo gravado recebe um carimbo; o passo em que se
 * está fica marcado; os que não se aplicam aparecem riscados em vez de
 * desaparecerem, para o cliente perceber que foram saltados e não perdidos.
 */
export function Lombada({
  token,
  atual,
  gravados,
  tipoCliente,
  representadoPorProcurador,
  carimbadoEm,
}: {
  token: string;
  atual: number;
  gravados: number[];
  tipoCliente: "particular" | "empresa";
  representadoPorProcurador: boolean;
  carimbadoEm?: Date | null;
}) {
  const ctx = { tipoCliente, representadoPorProcurador };

  return (
    <nav aria-label="Passos do processo" className="flex flex-col gap-1">
      <p className="text-2xs mb-3 font-mono tracking-[0.16em] text-muted-foreground uppercase">
        Dossier · {gravados.length} de {PASSOS.length}
      </p>

      <ol className="border-linha flex flex-col border-l">
        {PASSOS.map((p) => {
          const aplicavel = passoAplicavel(p.n, ctx);
          const feito = gravados.includes(p.n);
          const aqui = p.n === atual;
          const acessivel = aplicavel && (feito || p.n <= atual);

          const conteudo = (
            <span
              className={cn(
                "relative -ml-px flex items-center gap-3 border-l-2 py-2 pl-4 text-sm transition-colors",
                aqui
                  ? "border-selo text-tinta font-medium"
                  : feito
                    ? "border-arquivo/50 text-tinta-suave"
                    : "border-transparent text-muted-foreground",
                !aplicavel && "line-through opacity-50",
                acessivel && !aqui && "hover:text-tinta",
              )}
            >
              <span className="text-2xs w-4 shrink-0 font-mono tabular-nums">
                {String(p.n).padStart(2, "0")}
              </span>
              <span className="flex-1">{p.curto}</span>
              {feito && <Check className="text-arquivo size-3.5 shrink-0" strokeWidth={2.5} />}
            </span>
          );

          return (
            <li key={p.n}>
              {acessivel && !aqui ? (
                <Link href={`/onboarding/${token}/passo/${p.n}`} className="block">
                  {conteudo}
                </Link>
              ) : (
                <span
                  className="block"
                  aria-current={aqui ? "step" : undefined}
                  aria-disabled={!acessivel || undefined}
                >
                  {conteudo}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {/* O carimbo aparece quando o passo acabou de ser gravado — é o único
          momento de animação com peso na aplicação. */}
      {carimbadoEm && (
        <div className="mt-6 flex justify-center">
          <Carimbo data={carimbadoEm} rotulo="Gravado" />
        </div>
      )}
    </nav>
  );
}
