import { notFound } from "next/navigation";
import { processoPorToken, passosGravados, seccoesDoProcesso } from "@/features/onboarding/dados";
import { Lombada } from "@/features/onboarding/componentes/Lombada";
import { Ref } from "@/components/ref-processo";

export const metadata = { title: "Onboarding" };

export default async function LayoutOnboarding({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const processo = await processoPorToken(token);
  if (!processo) notFound();

  const seccoes = await seccoesDoProcesso(processo.id);
  const gravados = passosGravados(seccoes);

  return (
    <div className="bg-papel min-h-svh">
      <header className="border-linha bg-papel-alto border-b">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div>
            <p className="font-display text-lg leading-none">POC</p>
            <p className="text-2xs font-mono tracking-[0.16em] text-muted-foreground uppercase">
              Onboarding de cliente
            </p>
          </div>
          <Ref className="text-muted-foreground">{processo.referencia}</Ref>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:grid-cols-[190px_1fr] md:gap-10">
        {/* min-w-0: sem isto o item da grelha cresce com o conteúdo da fita
            horizontal e arrasta a página inteira para o lado no telemóvel. */}
        <aside className="min-w-0 md:sticky md:top-8 md:self-start">
          <Lombada
            token={token}
            atual={processo.passoAtual}
            gravados={gravados}
          />
        </aside>

        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
