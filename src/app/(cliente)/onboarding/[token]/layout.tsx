import Image from "next/image";
import { acessoPorToken, passosGravados, seccoesDoProcesso } from "@/features/onboarding/dados";
import { LinkIndisponivel } from "@/features/onboarding/componentes/LinkIndisponivel";
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
  const acesso = await acessoPorToken((await params).token);
  // O layout é o primeiro a decidir: sem `{children}`, o que a página tivesse
  // renderizado não chega ao ecrã. É por isso que o motivo tem de ser dito
  // aqui e não só nas páginas — e é aqui que ele fica sem a lombada à volta,
  // que não faz sentido nenhum num processo a que não se tem acesso.
  if (acesso.estado !== "ok") return <LinkIndisponivel acesso={acesso} />;

  const { processo, token } = acesso;

  const seccoes = await seccoesDoProcesso(processo.id);
  const gravados = passosGravados(seccoes, processo.tipoCliente);

  return (
    <div className="bg-papel min-h-svh">
      <header className="border-linha bg-papel-alto border-b">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          {/* O cabeçalho é o mesmo em todos os passos — vive no layout, e é por
              isso que basta trocá-lo aqui para o logo aparecer nos sete. */}
          <div className="flex items-center gap-3">
            <Image
              src="/logo_jm.png"
              alt="JMASSANO — Escritório de Advogado"
              width={202}
              height={171}
              priority
              className="h-11 w-auto"
            />
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
            tipoCliente={processo.tipoCliente}
          />
        </aside>

        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
