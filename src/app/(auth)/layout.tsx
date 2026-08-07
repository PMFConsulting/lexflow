import Image from "next/image";

export default function LayoutAuth({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-papel grid min-h-svh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Image
            src="/logo_jm.png"
            alt="JMASSANO — Escritório de Advogado"
            width={202}
            height={171}
            priority
            className="h-16 w-auto"
          />
          <p className="text-2xs mt-3 font-mono tracking-[0.16em] text-muted-foreground uppercase">
            Processos · Onboarding
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
