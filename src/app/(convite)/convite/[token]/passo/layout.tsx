import { Logotipo } from "@/components/logotipo";
import { Lombada } from "@/components/lombada";
import {
  acessoConvitePorToken,
  aceitacaoDoConvite,
  documentosDoConvite,
  passosConviteGravados,
} from "@/features/convites/dados";
import { LinkIndisponivelConvite } from "@/features/convites/componentes/LinkIndisponivelConvite";
import { exerceAdvocacia, PASSOS_CONVITE } from "@/features/convites/passos";

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

export const metadata = { title: "Registo de utilizador · JMASSANO" };
export const dynamic = "force-dynamic";

export default async function LayoutConvite({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}) {
  const acesso = await acessoConvitePorToken((await params).token);
  // O layout é o primeiro a decidir: sem `{children}`, o que a página tivesse
  // renderizado não chega ao ecrã.
  if (acesso.estado !== "ok") return <LinkIndisponivelConvite acesso={acesso} />;

  const { convite, perfil, org, token } = acesso;
  const documentos = await documentosDoConvite(convite.id);
  const aceitacao = await aceitacaoDoConvite(convite.id);

  const gravados = passosConviteGravados(
    perfil,
    documentos.map((d) => d.tipo),
    Boolean(aceitacao),
    exerceAdvocacia(convite.papel),
  );

  return (
    <div className="bg-papel min-h-svh">
      <header className="border-linha bg-papel-alto border-b">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Logotipo className="h-9 w-auto max-w-[40vw] shrink-0 sm:h-11" />
            <p className="text-2xs min-w-0 truncate font-mono tracking-[0.16em] text-muted-foreground uppercase">
              Registo de utilizador
            </p>
          </div>
          <p className="text-2xs min-w-0 truncate font-mono tracking-[0.16em] text-muted-foreground uppercase">
            {org.nome}
          </p>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:grid-cols-[190px_1fr] md:gap-10">
        {/* min-w-0: sem isto o item da grelha cresce com o conteúdo da fita
            horizontal e arrasta a página inteira para o lado no telemóvel. */}
        <aside className="min-w-0 md:sticky md:top-8 md:self-start">
          <Lombada
            percurso={PASSOS_CONVITE}
            atual={convite.passoAtual}
            gravados={gravados}
            base={`/convite/${token}`}
            rotulo="Passos do registo"
            contador="Registo"
          />
        </aside>

        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
