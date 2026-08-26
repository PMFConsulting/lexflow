import { CheckCircle2 } from "lucide-react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizacao } from "@/db/schema/organizacao";
import { conviteUtilizador } from "@/db/schema/sociedade";
import { Button } from "@/components/ui/button";
import { Logotipo } from "@/components/logotipo";
import { hashToken, normalizarToken } from "@/lib/token";

export const metadata = { title: "Conta criada" };
export const dynamic = "force-dynamic";

/**
 * O fim do registo de uma pessoa da equipa.
 *
 * Vai buscar a linha pelo hash do token e **não** filtra pelo estado, ao
 * contrário do `acessoConvitePorToken` — que classifica um convite já aceite
 * como `concluido`, que é o certo para os passos e é exatamente o estado em que
 * esta página tem de conseguir mostrar alguma coisa.
 */
export default async function ConviteConcluido({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const token = normalizarToken((await params).token);

  const [linha] = await db()
    .select({ convite: conviteUtilizador, org: organizacao })
    .from(conviteUtilizador)
    .innerJoin(organizacao, eq(organizacao.id, conviteUtilizador.organizacaoId))
    .where(eq(conviteUtilizador.tokenAcessoHash, hashToken(token)))
    .limit(1);

  // Um token que não corresponde a nada não descobre nada por passar aqui.
  if (!linha) {
    return (
      <div className="bg-papel grid min-h-svh place-items-center px-4 py-10">
        <div className="w-full max-w-md text-center">
          <Logotipo className="mx-auto h-14 w-auto" />
          <p className="mt-6 text-sm text-muted-foreground">Este link não é reconhecido.</p>
        </div>
      </div>
    );
  }

  const { convite, org } = linha;

  return (
    <div className="bg-papel grid min-h-svh place-items-center px-4 py-10">
      <div className="w-full max-w-md text-center">
        <div className="mb-8 flex flex-col items-center">
          <Logotipo className="h-14 w-auto" />
          <p className="text-2xs mt-3 font-mono tracking-[0.16em] text-muted-foreground uppercase">
            {org.nome}
          </p>
        </div>

        <div className="border-linha bg-papel-alto rounded-sm border p-6">
          <span
            aria-hidden="true"
            className="border-arquivo/30 bg-arquivo/10 text-arquivo mx-auto mb-4 flex size-10 items-center justify-center rounded-sm border"
          >
            <CheckCircle2 className="size-5" />
          </span>

          <h1 className="mb-2 text-xl">
            {convite.estado === "aceite" ? "A sua conta está criada." : "Registo por concluir."}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {convite.estado === "aceite" ? (
              <>
                Entre com o email <span className="font-mono break-all">{convite.email}</span> e a
                palavra-passe que definiu. Este link deixa de servir para alguma coisa — a partir
                de agora entra pela página de entrada.
              </>
            ) : (
              <>
                Este registo ainda não foi concluído. Volte ao link que recebeu por email para o
                terminar.
              </>
            )}
          </p>

          {convite.estado === "aceite" && (
            <Button asChild className="mt-6 w-full">
              <a href="/entrar">Entrar na plataforma</a>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
