import { Clock, FileX2, LinkIcon, CheckCircle2 } from "lucide-react";
import { Ref } from "@/components/ref-processo";
import { Logotipo } from "@/components/logotipo";

/**
 * O ecrã de quem chega com um link que não abre.
 *
 * Substituiu o `notFound()` que estava nas rotas do onboarding (D49). O 404 não
 * era falso, era **mudo**: dizia "esta página não existe" a quem tinha na mão
 * um endereço que lhe foi enviado, e induzia a única conclusão que não era
 * verdade — que se tinha enganado. As causas reais têm saídas diferentes, e
 * nenhuma delas é "voltar ao início".
 *
 * Há sempre três coisas: o que aconteceu, o que fazer a seguir, e a referência
 * quando ela se pode dizer — que é o que permite a quem atende o telefone
 * encontrar o registo em vez de pedir que reencaminhem o email.
 */

const ICONES = {
  expirado: Clock,
  arquivado: FileX2,
  concluido: CheckCircle2,
  desconhecido: LinkIcon,
} as const;

export type EstadoIndisponivel = keyof typeof ICONES;

export function LinkIndisponivelBase({
  estado,
  titulo,
  descricao,
  referencia,
  rotuloReferencia = "Referência",
  contexto,
}: {
  estado: EstadoIndisponivel;
  titulo: string;
  descricao: string;
  referencia?: string;
  rotuloReferencia?: string;
  /** A linha por baixo do logo — "Onboarding de cliente", "Registo da sociedade"… */
  contexto: string;
}) {
  const Icone = ICONES[estado];

  return (
    <div className="bg-papel grid min-h-svh place-items-center px-4 py-10">
      <div className="w-full max-w-md text-center">
        <div className="mb-8 flex flex-col items-center">
          <Logotipo className="h-14 w-auto" />
          <p className="text-2xs mt-3 font-mono tracking-[0.16em] text-muted-foreground uppercase">
            {contexto}
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
              <dt className="text-muted-foreground">{rotuloReferencia}</dt>
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
