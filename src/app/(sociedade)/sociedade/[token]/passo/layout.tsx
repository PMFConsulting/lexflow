import { Logotipo } from "@/components/logotipo";
import { Lombada } from "@/components/lombada";
import { Ref } from "@/components/ref-processo";
import {
  acessoSociedadePorToken,
  documentosDaSociedade,
  passosSociedadeGravados,
} from "@/features/sociedade/dados";
import { LinkIndisponivelSociedade } from "@/features/sociedade/componentes/LinkIndisponivelSociedade";
import { PASSOS_SOCIEDADE } from "@/features/sociedade/passos";

/*
 * Este layout vive em `passo/` e não em `[token]/`, e a diferença não é
 * arrumação.
 *
 * Ele recusa tudo o que não seja um registo em curso — e um registo **já
 * submetido** é um desses casos. Estando um nível acima, engolia a página
 * `/submetido`, que é precisamente a que tem de conseguir mostrar-se nesse
 * estado: quem acabava de submeter via «este registo já foi submetido» no lugar
 * do ecrã de sucesso, com a lombada dos passos à volta de um registo que já não
 * tem passos. O layout é dos passos; só os passos é que o levam.
 */

export const metadata = { title: "Registo da sociedade" };
export const dynamic = "force-dynamic";

export default async function LayoutSociedade({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}) {
  const acesso = await acessoSociedadePorToken((await params).token);
  // O layout é o primeiro a decidir: sem `{children}`, o que a página tivesse
  // renderizado não chega ao ecrã. É por isso que o motivo tem de ser dito aqui
  // e não só nas páginas.
  if (acesso.estado !== "ok") return <LinkIndisponivelSociedade acesso={acesso} />;

  const { onboarding, org, token } = acesso;
  const documentos = await documentosDaSociedade(org.id);
  const gravados = passosSociedadeGravados(
    org,
    onboarding,
    documentos.map((d) => d.tipo),
  );

  const logotipoUrl =
    org.logotipoDados && org.logotipoMime
      ? `data:${org.logotipoMime};base64,${org.logotipoDados}`
      : null;

  return (
    <div className="bg-papel min-h-svh">
      <header className="border-linha bg-papel-alto border-b">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Logotipo
              logotipoUrl={logotipoUrl}
              titulo={org.nome}
              className="h-9 w-auto max-w-[40vw] shrink-0 sm:h-11"
            />
            <p className="text-2xs min-w-0 truncate font-mono tracking-[0.16em] text-muted-foreground uppercase">
              Registo da sociedade
            </p>
          </div>
          <Ref className="text-muted-foreground">{org.prefixoReferencia}</Ref>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:grid-cols-[190px_1fr] md:gap-10">
        {/* min-w-0: sem isto o item da grelha cresce com o conteúdo da fita
            horizontal e arrasta a página inteira para o lado no telemóvel. */}
        <aside className="min-w-0 md:sticky md:top-8 md:self-start">
          <Lombada
            percurso={PASSOS_SOCIEDADE}
            atual={onboarding.passoAtual}
            gravados={gravados}
            base={`/sociedade/${token}`}
            rotulo="Passos do registo"
          />
        </aside>

        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
