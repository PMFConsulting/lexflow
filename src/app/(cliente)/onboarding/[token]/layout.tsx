import { Logotipo } from "@/components/logotipo";
import { acessoPorToken, passosGravados, seccoesDoProcesso } from "@/features/onboarding/dados";
import { LinkIndisponivel } from "@/features/onboarding/componentes/LinkIndisponivel";
import { Lombada } from "@/features/onboarding/componentes/Lombada";
import { Ref } from "@/components/ref-processo";
import { sociedadeDe } from "@/features/administracao/consultas";

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

  const [seccoes, org] = await Promise.all([
    seccoesDoProcesso(processo.id),
    sociedadeDe(processo.organizacaoId),
  ]);
  const gravados = passosGravados(seccoes, processo.tipoCliente);

  const logotipoUrl =
    org?.logotipoDados && org?.logotipoMime
      ? `data:${org.logotipoMime};base64,${org.logotipoDados}`
      : null;

  return (
    <div className="bg-papel min-h-svh">
      <header className="border-linha bg-papel-alto border-b">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          {/* O cabeçalho é o mesmo em todos os passos — vive no layout, e é por
              isso que basta trocá-lo aqui para o logo aparecer nos sete. */}
          {/* `min-w-0` no grupo e `shrink-0` no logo: o logo é item de flex e,
              sem isso, é ele que encolhe primeiro num ecrã estreito — a altura
              fica presa no `h-11` e a largura cede, que é o logo esticado. Quem
              encolhe passa a ser o texto ao lado, que tem por onde. */}
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Logotipo
              logotipoUrl={logotipoUrl}
              titulo={org?.nome ?? undefined}
              className="h-9 w-auto max-w-[40vw] shrink-0 sm:h-11"
            />
            <p className="text-2xs min-w-0 truncate font-mono tracking-[0.16em] text-muted-foreground uppercase">
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
