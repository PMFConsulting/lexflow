import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="bg-papel grid min-h-svh place-items-center px-4 py-10">
      <div className="w-full max-w-sm text-center">
        <p className="font-display text-2xl leading-none">POC</p>
        <p className="text-2xs text-muted-foreground mt-1 mb-8 font-mono tracking-[0.16em] uppercase">
          Processos · Onboarding
        </p>

        <div className="border-linha bg-papel-alto rounded-sm border p-6">
          <p className="text-2xs text-latao font-mono tracking-[0.16em] uppercase">Erro 404</p>
          <h1 className="mt-2 mb-1 text-xl">Esta página não existe.</h1>
          <p className="text-muted-foreground mb-6 text-sm">
            O link pode ter expirado ou o endereço está errado.
          </p>

          <div className="flex flex-col gap-3">
            <Button asChild size="lg">
              <Link href="/">Voltar ao início</Link>
            </Button>
            <Link
              href="/entrar"
              className="text-muted-foreground text-sm underline underline-offset-2"
            >
              Pedir novo link
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
