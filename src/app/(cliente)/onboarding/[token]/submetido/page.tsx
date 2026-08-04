import { notFound } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { assinaturaDoProcesso, processoPorToken } from "@/features/onboarding/dados";
import { Carimbo } from "@/components/carimbo";
import { Ref } from "@/components/ref-processo";

export const metadata = { title: "Processo submetido" };

const formatadorAssinatura = new Intl.DateTimeFormat("pt-PT", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Europe/Lisbon",
});

export default async function Submetido({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const processo = await processoPorToken(token);
  if (!processo) notFound();

  const assinatura = await assinaturaDoProcesso(processo.id);

  return (
    <div className="border-linha bg-papel-alto flex flex-col items-center gap-6 rounded-sm border p-8 text-center md:p-12">
      <Carimbo data={processo.submetidoEm ?? new Date()} rotulo="Submetido" />

      <div>
        <h1 className="text-2xl">Recebemos o seu processo</h1>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          A partir de agora o processo fica em revisão pela equipa da POC
          Consulting. Se faltar alguma coisa ou for preciso corrigir um dado,
          entramos em contacto pelo email que indicou.
        </p>
      </div>

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
            <Ref>
              {(processo.submetidoEm ?? new Date()).toLocaleString("pt-PT", {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </Ref>
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
