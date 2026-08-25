import { exigirAdministracao } from "@/lib/sessao";
import {
  documentosDaSociedadeAdmin,
  sociedadeDe,
} from "@/features/administracao/consultas";
import { PublicarTermos } from "@/features/administracao/componentes/PublicarTermos";
import { cn } from "@/lib/utils";

export const metadata = { title: "Sociedade · JMASSANO" };
export const dynamic = "force-dynamic";

const dataCurta = new Intl.DateTimeFormat("pt-PT", { dateStyle: "short" });

function Linha({
  etiqueta,
  valor,
  mono = false,
}: {
  etiqueta: string;
  valor: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="border-linha flex items-baseline justify-between gap-4 border-b py-2 last:border-0">
      <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
      <dd className={cn("text-right text-sm break-all", mono && "font-mono tabular-nums")}>
        {valor || "—"}
      </dd>
    </div>
  );
}

export default async function Sociedade() {
  const { eu } = await exigirAdministracao();

  const [org, documentos] = await Promise.all([
    sociedadeDe(eu.organizacaoId),
    documentosDaSociedadeAdmin(eu.organizacaoId),
  ]);

  const termos = documentos.find((d) => d.tipo === "termos_sociedade");
  const morada = [org?.morada, org?.codigoPostal, org?.localidade]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="text-2xl">Sociedade</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Os dados que a sociedade indicou no registo, e o articulado que vincula os seus clientes.
        </p>
      </div>

      <PublicarTermos
        versaoAtual={org?.termosVersao ?? null}
        atualizadoEm={org?.termosAtualizadoEm ?? null}
        nomeDocumento={termos?.nome ?? null}
      />

      <section className="border-linha bg-papel-alto rounded-sm border p-4">
        <h2 className="text-lg">Identificação</h2>
        <dl className="mt-2">
          <Linha etiqueta="Nome" valor={org?.nome} />
          <Linha etiqueta="NIPC" valor={org?.nif} mono />
          <Linha etiqueta="Forma jurídica" valor={org?.naturezaJuridica} />
          <Linha etiqueta="N.º na Ordem dos Advogados" valor={org?.numeroOrdem} mono />
          <Linha etiqueta="Prefixo das referências" valor={org?.prefixoReferencia} mono />
        </dl>
      </section>

      <section className="border-linha bg-papel-alto rounded-sm border p-4">
        <h2 className="text-lg">Sede e contactos</h2>
        <dl className="mt-2">
          <Linha etiqueta="Morada" valor={morada || null} />
          <Linha etiqueta="Concelho" valor={org?.concelho} />
          <Linha etiqueta="Distrito" valor={org?.distrito} />
          <Linha etiqueta="Email geral" valor={org?.emailGeral} />
          <Linha etiqueta="Telefone" valor={org?.telefone} mono />
          <Linha etiqueta="Website" valor={org?.website} />
        </dl>
        {/* Estes dados vieram do registo inicial e ainda não se alteram por
            aqui. Dizê-lo é melhor do que ter um ecrã que parece editável e não
            é — que é a forma de alguém tentar corrigir uma morada durante meia
            hora antes de perceber. */}
        <p className="mt-3 text-xs text-muted-foreground">
          Estes dados vieram do registo inicial da sociedade. Para os alterar, fale com o suporte —
          uma alteração ao NIPC ou à forma jurídica implica reconfirmar a certidão.
        </p>
      </section>

      {documentos.length > 0 && (
        <section className="border-linha bg-papel-alto rounded-sm border p-4">
          <h2 className="text-lg">Documentos da sociedade</h2>
          <ul className="divide-linha mt-2 divide-y">
            {documentos.map((d) => (
              <li key={d.id} className="flex items-baseline justify-between gap-4 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm">{d.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.tipo === "termos_sociedade"
                      ? "Termos e Condições"
                      : d.tipo === "certidao_sociedade"
                        ? "Certidão permanente"
                        : "Outro"}
                  </p>
                </div>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {dataCurta.format(new Date(d.criadoEm))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
