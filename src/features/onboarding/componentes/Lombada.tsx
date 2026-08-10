"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Carimbo } from "@/components/carimbo";
import { passosDoProcesso, type TipoCliente } from "../passos";

/** Onde o formulário deixa dito qual foi o último passo gravado. */
export const CHAVE_CARIMBO = "pmf.carimbado";

/**
 * A lombada do dossier.
 *
 * Os passos numerados — aqui a numeração justifica-se, é uma sequência
 * real e obrigatória. Cada passo gravado recebe um visto; o que acabou de ser
 * gravado leva com o carimbo.
 *
 * Em ecrãs estreitos deita-se: uma fita horizontal por cima do formulário, que
 * é onde há espaço.
 */
export function Lombada({
  token,
  atual,
  gravados,
  tipoCliente,
}: {
  token: string;
  atual: number;
  gravados: number[];
  tipoCliente: TipoCliente;
}) {
  const [carimbo, setCarimbo] = useState<{ passo: number; quando: Date } | null>(null);

  // Numa pessoa singular o percurso tem seis passos, não sete: o Representante
  // Legal não entra, e a contagem do dossier não pode prometer um passo que
  // ninguém vai ver.
  const percurso = passosDoProcesso(tipoCliente);

  // O carimbo é a recompensa de ter gravado, por isso aparece na página
  // seguinte — que é para onde o cliente vai a seguir a carregar em guardar.
  useEffect(() => {
    const marca = sessionStorage.getItem(CHAVE_CARIMBO);
    if (!marca) return;
    sessionStorage.removeItem(CHAVE_CARIMBO);
    const passo = Number(marca);
    if (!Number.isInteger(passo)) return;
    setCarimbo({ passo, quando: new Date() });
    const t = setTimeout(() => setCarimbo(null), 3200);
    return () => clearTimeout(t);
  }, []);

  return (
    <nav aria-label="Passos do processo">
      <p className="text-2xs mb-3 font-mono tracking-[0.16em] text-muted-foreground uppercase">
        Dossier · {gravados.length} de {percurso.length}
      </p>

      {/* barra de progresso — em mobile é o único indicador que cabe bem */}
      <div className="bg-linha mb-3 h-0.5 w-full md:hidden">
        <div
          className="bg-selo h-full transition-[width] duration-500 ease-out"
          style={{ width: `${(gravados.length / percurso.length) * 100}%` }}
        />
      </div>

      <ol className="border-linha flex gap-1 overflow-x-auto pb-2 md:flex-col md:gap-0 md:overflow-visible md:border-l md:pb-0">
        {percurso.map((p, indice) => {
          const feito = gravados.includes(p.n);
          const aqui = p.n === atual;
          const acessivel = feito || p.n <= atual;
          const aCarimbar = carimbo?.passo === p.n;

          const conteudo = (
            <span
              className={cn(
                "relative flex shrink-0 items-center gap-2 rounded-sm px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors",
                "md:-ml-px md:rounded-none md:border-l-2 md:px-0 md:py-2 md:pl-4 md:whitespace-normal",
                aqui
                  ? "bg-tinta text-papel-alto md:bg-transparent md:border-selo md:text-tinta font-medium"
                  : feito
                    ? "border-linha text-tinta-suave border md:border-0 md:border-l-2 md:border-arquivo/50"
                    : "border-linha border text-muted-foreground md:border-0 md:border-l-2 md:border-transparent",
                acessivel && !aqui && "hover:text-tinta",
              )}
            >
              <span className="text-2xs font-mono tabular-nums md:w-4">
                {/* A posição no percurso, e não o número interno do passo: num
                    particular a numeração salta o 3, e o cliente via 01 02 04
                    numa lista de seis. O `p.n` continua a mandar nos links e
                    nos rótulos de auditoria — o que muda é só o que se lê. */}
                {String(indice + 1).padStart(2, "0")}
              </span>
              <span className="md:flex-1">{p.curto}</span>
              {feito && !aCarimbar && (
                <Check className="text-arquivo size-3.5 shrink-0" strokeWidth={2.5} />
              )}
              {aCarimbar && (
                <span
                  className="animate-carimbo border-selo/40 bg-selo/10 text-selo text-2xs ml-auto rounded-full border px-1.5 py-0.5 font-mono"
                  aria-hidden="true"
                >
                  ✓
                </span>
              )}
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

      {/* O carimbo grande, o momento com peso. Só em ecrã largo: no telemóvel
          rouba metade do espaço útil ao formulário. */}
      {carimbo && (
        <div className="mt-6 hidden justify-center md:flex">
          <Carimbo data={carimbo.quando} rotulo="Gravado" />
        </div>
      )}

      <p aria-live="polite" className="sr-only">
        {carimbo ? `Passo ${carimbo.passo} gravado.` : ""}
      </p>
    </nav>
  );
}
