import { CheckCircle2, Mail } from "lucide-react";
import { Logotipo } from "@/components/logotipo";
import { Ref } from "@/components/ref-processo";
import { acessoSociedadePorToken } from "@/features/sociedade/dados";
import { db } from "@/db";
import { conviteUtilizador } from "@/db/schema/sociedade";
import { organizacao } from "@/db/schema/organizacao";
import { onboardingSociedade } from "@/db/schema/sociedade";
import { and, desc, eq } from "drizzle-orm";
import { hashToken, normalizarToken } from "@/lib/token";

export const metadata = { title: "Registo submetido" };
export const dynamic = "force-dynamic";

/**
 * O ecrã do fim do registo da sociedade.
 *
 * Não usa o `acessoSociedadePorToken` para carregar os dados, e é de propósito:
 * essa função classifica um registo já submetido como `concluido` — o que está
 * certo para os passos, que não se podem voltar a abrir, e é exatamente o
 * estado em que esta página tem de conseguir mostrar alguma coisa. Vai buscar a
 * linha pelo hash do token, como ela faz, e não filtra pelo estado.
 */
export default async function SociedadeSubmetida({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const bruto = (await params).token;
  const acesso = await acessoSociedadePorToken(bruto);

  const token = normalizarToken(bruto);
  const [linha] = await db()
    .select({ onboarding: onboardingSociedade, org: organizacao })
    .from(onboardingSociedade)
    .innerJoin(organizacao, eq(organizacao.id, onboardingSociedade.organizacaoId))
    .where(eq(onboardingSociedade.tokenAcessoHash, hashToken(token)))
    .limit(1);

  // Um token que não corresponde a nada não descobre nada por passar aqui.
  if (!linha) {
    return (
      <div className="bg-papel grid min-h-svh place-items-center px-4 py-10">
        <div className="w-full max-w-md text-center">
          <Logotipo className="mx-auto h-14 w-auto" />
          <p className="mt-6 text-sm text-muted-foreground">
            Este link não é reconhecido.
          </p>
        </div>
      </div>
    );
  }

  const { onboarding, org } = linha;
  const logotipoUrl = org.logotipoDados
    ? `/api/sociedade/logotipo?sociedadeId=${org.id}&t=${org.logotipoAtualizadoEm ? new Date(org.logotipoAtualizadoEm).getTime() : Date.now()}`
    : null;

  // Ainda em rascunho: quem chegou aqui à mão não submeteu nada, e dizer-lhe
  // que está submetido era mentir-lhe sobre o estado do próprio registo.
  if (onboarding.estado === "rascunho" && acesso.estado === "ok") {
    return (
      <div className="bg-papel grid min-h-svh place-items-center px-4 py-10">
        <div className="w-full max-w-md text-center">
          <Logotipo logotipoUrl={logotipoUrl} titulo={org.nome} className="mx-auto h-14 w-auto" />
          <p className="mt-6 text-sm text-muted-foreground">
            O registo ainda não foi submetido.{" "}
            <a className="underline" href={`/sociedade/${acesso.token}/passo/${onboarding.passoAtual}`}>
              Continuar o preenchimento
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

  const [convite] = await db()
    .select({ email: conviteUtilizador.email, estado: conviteUtilizador.estado })
    .from(conviteUtilizador)
    .where(
      and(
        eq(conviteUtilizador.organizacaoId, org.id),
        eq(conviteUtilizador.papel, "society_admin"),
      ),
    )
    .orderBy(desc(conviteUtilizador.criadoEm))
    .limit(1);

  return (
    <div className="bg-papel grid min-h-svh place-items-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex flex-col items-center">
          <Logotipo logotipoUrl={logotipoUrl} titulo={org.nome} className="h-14 w-auto" />
          <p className="text-2xs mt-3 font-mono tracking-[0.16em] text-muted-foreground uppercase">
            Registo da sociedade
          </p>
        </div>

        <div className="border-linha bg-papel-alto rounded-sm border p-6 text-center">
          <span
            aria-hidden="true"
            className="border-arquivo/30 bg-arquivo/10 text-arquivo mx-auto mb-4 flex size-10 items-center justify-center rounded-sm border"
          >
            <CheckCircle2 className="size-5" />
          </span>

          <h1 className="mb-2 text-xl">Registo submetido.</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            A {org.nome} está registada. O articulado de Termos e Condições que anexaram passa a
            ser o que os vossos clientes leem e aceitam no passo final do registo deles.
          </p>

          <dl className="border-linha mt-6 flex flex-col gap-2 border-t pt-4 text-left text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">Sociedade</dt>
              <dd className="text-right">{org.nome}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">NIPC</dt>
              <dd>
                <Ref>{org.nif}</Ref>
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">Prefixo das referências</dt>
              <dd>
                <Ref>{org.prefixoReferencia}</Ref>
              </dd>
            </div>
            {org.termosVersao && (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">Versão dos T&amp;C</dt>
                <dd>
                  <Ref>{org.termosVersao}</Ref>
                </dd>
              </div>
            )}
          </dl>
        </div>

        {convite && (
          <div className="border-latao/40 bg-latao/5 mt-4 flex items-start gap-3 rounded-sm border p-4">
            <Mail className="text-latao mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 text-sm">
              <p className="font-medium">O que acontece a seguir</p>
              <p className="mt-1 text-muted-foreground">
                {convite.estado === "aceite" ? (
                  <>A conta de administrador já foi criada. Podem entrar na plataforma.</>
                ) : (
                  <>
                    Foi enviado um convite para <span className="break-all">{convite.email}</span>.
                    É por aí que a conta de administrador se cria — e é essa conta que passa a
                    poder convidar o resto da equipa.
                  </>
                )}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
