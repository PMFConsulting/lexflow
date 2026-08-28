import { eq } from "drizzle-orm";
import { Check, Clock, Mail, TriangleAlert } from "lucide-react";
import { db } from "@/db";
import { organizacao } from "@/db/schema/organizacao";
import { acessoPorToken, assinaturaDoProcesso } from "@/features/onboarding/dados";
import { LinkIndisponivel } from "@/features/onboarding/componentes/LinkIndisponivel";
import { Carimbo } from "@/components/carimbo";
import { Ref } from "@/components/ref-processo";
import { cn } from "@/lib/utils";

export const metadata = { title: "Processo submetido" };

const formatadorAssinatura = new Intl.DateTimeFormat("pt-PT", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Europe/Lisbon",
});

/**
 * Também com fuso fixo, e não `toLocaleString` sem opções: isto renderiza no
 * servidor, e um contentor a correr em UTC dava ao cliente uma hora de
 * submissão uma hora abaixo da que ele viu no relógio.
 */
const formatadorSubmissao = new Intl.DateTimeFormat("pt-PT", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Lisbon",
});

type EstadoEtapa = "feita" | "atual" | "futura";

interface Etapa {
  titulo: string;
  descricao: string;
  estado: EstadoEtapa;
}

/**
 * Ícone e cor por estado, no mesmo vocabulário do `EstadoBadge`: arquivo
 * (verde) para o que já aconteceu, latão para o que está a decorrer, e a cor
 * de texto secundário para o que ainda não chegou.
 */
const ICONE_ETAPA = { feita: Check, atual: Clock, futura: Mail } as const;

const CLASSE_MARCADOR: Record<EstadoEtapa, string> = {
  feita: "border-arquivo/40 bg-arquivo/10 text-arquivo",
  atual: "border-latao/40 bg-latao/10 text-latao",
  futura: "border-linha bg-muted/50 text-tinta-suave",
};

/**
 * Timeline dos próximos passos. Substitui o parágrafo genérico "fica em
 * análise" por um estado que se vê: o cliente sabe que já foi um passo (a
 * submissão), que há um segundo a decorrer (a aprovação) e o que acontece a
 * seguir se ela correr bem — sem prometer prazo, que a POC não tem como
 * cumprir.
 */
function ProximosPassos({ etapas }: { etapas: Etapa[] }) {
  return (
    <ol className="w-full max-w-sm text-left" aria-label="Próximos passos">
      {etapas.map((etapa, i) => {
        const Icone = ICONE_ETAPA[etapa.estado];
        const ultima = i === etapas.length - 1;
        return (
          <li key={etapa.titulo} className="relative flex gap-3">
            {!ultima && (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-6 left-[10.5px] -bottom-0.5 w-px",
                  etapa.estado === "feita" ? "bg-arquivo/30" : "bg-linha",
                )}
              />
            )}
            <span
              className={cn(
                "relative z-10 mt-0.5 grid size-[21px] shrink-0 place-items-center rounded-full border",
                CLASSE_MARCADOR[etapa.estado],
              )}
            >
              <Icone className="size-3" />
            </span>
            <div
              className="pb-5"
              aria-current={etapa.estado === "atual" ? "step" : undefined}
            >
              <p
                className={cn(
                  "text-sm font-medium",
                  etapa.estado === "futura" && "text-muted-foreground",
                )}
              >
                {etapa.titulo}
              </p>
              <p className="text-xs text-muted-foreground">{etapa.descricao}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default async function Submetido({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const acesso = await acessoPorToken((await params).token);
  if (acesso.estado !== "ok") return <LinkIndisponivel acesso={acesso} />;

  const { processo } = acesso;
  const assinatura = await assinaturaDoProcesso(processo.id);
  const submetidoEm = processo.submetidoEm ?? new Date();

  const [org] = await db()
    .select({ nome: organizacao.nome })
    .from(organizacao)
    .where(eq(organizacao.id, processo.organizacaoId))
    .limit(1);

  const etapas: Etapa[] = [
    {
      titulo: "Submissão recebida",
      descricao: `Registada em ${formatadorSubmissao.format(submetidoEm)}.`,
      estado: "feita",
    },
    {
      titulo: processo.estado === "aprovado" ? "Aprovação concluída" : "Análise e aprovação pela equipa",
      descricao:
        processo.estado === "aprovado"
          ? "O processo foi aprovado — ficou concluído e já não pode ser alterado."
          : "Recebe um email assim que o processo for decidido.",
      estado: "feita" as EstadoEtapa,
    },
    {
      titulo: "Boas-vindas, se aprovado",
      descricao:
        "Email com o resumo do processo, os Termos e Condições e a proposta de honorários.",
      estado: "futura",
    },
  ];

  return (
    <div className="border-linha bg-papel-alto flex flex-col items-center gap-6 rounded-sm border p-8 text-center md:p-12">
      <Carimbo data={submetidoEm} rotulo="Submetido" />

      <div>
        <h1 className="text-2xl">Recebemos o seu processo</h1>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          O processo está agora <strong className="text-latao font-medium">a aguardar aprovação</strong> da
          equipa da {org?.nome}.
        </p>
      </div>

      <ProximosPassos etapas={etapas} />

      <p className="max-w-prose text-xs text-muted-foreground">
        Se faltar alguma coisa ou for preciso corrigir um dado, a equipa entra em
        contacto pelo email que indicou.
      </p>

      <dl className="border-linha grid w-full max-w-sm gap-px border text-left text-sm">
        <div className="bg-papel-alto flex justify-between gap-4 p-3">
          <dt className="text-muted-foreground">Referência</dt>
          <dd>
            <Ref>{processo.referencia}</Ref>
          </dd>
        </div>
        <div className="bg-papel-alto flex justify-between gap-4 p-3">
          <dt className="text-muted-foreground">Submetido em</dt>
          <dd>
            <Ref>{formatadorSubmissao.format(submetidoEm)}</Ref>
          </dd>
        </div>
      </dl>

      {assinatura?.imagemDados ? (
        <div className="border-linha bg-papel-alto w-full max-w-sm rounded-sm border p-1">
          <div className="border-latao/40 flex flex-col items-center gap-3 rounded-sm border p-5">
            <p className="text-2xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
              Rubrica registada
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={assinatura.imagemDados}
              alt="Rubrica manuscrita do assinante"
              className="h-16 w-auto max-w-full"
            />
            <p className="text-xs text-muted-foreground">
              Assinado em <Ref>{formatadorAssinatura.format(assinatura.assinadoEm)}</Ref>
            </p>
          </div>
        </div>
      ) : (
        <div className="border-linha flex w-full max-w-sm items-center gap-2 rounded-sm border border-dashed p-4 text-left text-xs text-muted-foreground">
          <TriangleAlert className="size-4 shrink-0" />
          Este processo não tem assinatura registada.
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Guarde a referência — serve para qualquer contacto sobre este processo.
      </p>
    </div>
  );
}
