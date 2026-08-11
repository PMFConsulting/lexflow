"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Logotipo } from "@/components/logotipo";

export default function ErrorGlobal({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="bg-papel grid min-h-svh place-items-center px-4 py-10">
      <div className="w-full max-w-sm text-center">
        <div className="mb-8 flex flex-col items-center">
          <Logotipo className="h-14 w-auto" />
          <p className="text-2xs text-muted-foreground mt-3 font-mono tracking-[0.16em] uppercase">
            Processos · Onboarding
          </p>
        </div>

        <div className="border-linha bg-papel-alto rounded-sm border p-6">
          <p className="text-2xs text-selo font-mono tracking-[0.16em] uppercase">Erro</p>
          <h1 className="mt-2 mb-1 text-xl">Algo correu mal.</h1>
          <p className="text-muted-foreground mb-6 text-sm">
            Ocorreu um erro inesperado. Pode tentar novamente ou voltar ao início.
          </p>

          <div className="flex flex-col gap-3">
            <Button size="lg" onClick={() => reset()}>
              Tentar novamente
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/">Voltar ao início</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
