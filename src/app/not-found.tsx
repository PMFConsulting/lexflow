import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Logotipo } from "@/components/logotipo";

export default function NotFound() {
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
          <p className="text-2xs text-latao font-mono tracking-[0.16em] uppercase">Erro 404</p>
          <h1 className="mt-2 mb-1 text-xl">Esta página não existe.</h1>
          <p className="text-muted-foreground mb-6 text-sm">
            O link pode ter expirado ou o endereço está errado. Os links de
            preenchimento expiram ao fim de 30 dias — para receber um novo, fale
            com o seu contacto na sociedade.
          </p>

          {/* Antes havia aqui um "Pedir novo link" para `/entrar`, que é a
              entrada da equipa: mandava o cliente para um ecrã de credenciais
              que ele nunca vai ter. Quem perde o link pede-o a quem lho
              enviou. */}
          <Button asChild size="lg">
            <Link href="/">Voltar ao início</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
