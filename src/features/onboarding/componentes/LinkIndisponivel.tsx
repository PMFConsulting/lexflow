import Image from "next/image";
import { Clock, FileX2, LinkIcon } from "lucide-react";
import { Ref } from "@/components/ref-processo";
import { motivoDoAcesso, type AcessoOnboarding } from "../dados";

/**
 * O ecrã de quem chega com um link que não abre.
 *
 * Substitui o `notFound()` que estava nas quatro rotas do onboarding. O 404 não
 * era falso, era **mudo**: dizia "esta página não existe" a um cliente que
 * tinha na mão um endereço que a sociedade lhe enviou, e mandava-o concluir a
 * única coisa que não era verdade — que se tinha enganado. As três causas
 * reais têm três saídas diferentes, e nenhuma delas é "voltar ao início".
 *
 * Aqui há sempre três coisas: o que aconteceu, o que fazer a seguir, e a
 * referência do processo quando ela se pode dizer — que é o que permite a quem
 * atende o telefone na sociedade encontrar o dossier em vez de pedir ao cliente
 * que reencaminhe o email.
 */

const ICONES = {
  expirado: Clock,
  arquivado: FileX2,
  desconhecido: LinkIcon,
} as const;

export function LinkIndisponivel({ acesso }: { acesso: AcessoOnboarding }) {
  if (acesso.estado === "ok") return null;

  const { titulo, descricao, referencia } = motivoDoAcesso(acesso);
  const Icone = ICONES[acesso.estado];

  return (
    <div className="bg-papel grid min-h-svh place-items-center px-4 py-10">
      <div className="w-full max-w-md text-center">
        <div className="mb-8 flex flex-col items-center">
          <Image
            src="/logo_jm.png"
            alt="JMASSANO — Escritório de Advogado"
            width={202}
            height={171}
            className="h-14 w-auto"
          />
          <p className="text-2xs mt-3 font-mono tracking-[0.16em] text-muted-foreground uppercase">
            Onboarding de cliente
          </p>
        </div>

        <div className="border-linha bg-papel-alto rounded-sm border p-6">
          <span
            aria-hidden="true"
            className="border-linha bg-muted/50 text-tinta-suave mx-auto mb-4 flex size-10 items-center justify-center rounded-sm border"
          >
            <Icone className="size-5" />
          </span>

          <h1 className="mb-2 text-xl">{titulo}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">{descricao}</p>

          {referencia && (
            <dl className="border-linha mt-6 flex items-center justify-between gap-4 border-t pt-4 text-left text-sm">
              <dt className="text-muted-foreground">Referência</dt>
              <dd>
                <Ref>{referencia}</Ref>
              </dd>
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}
