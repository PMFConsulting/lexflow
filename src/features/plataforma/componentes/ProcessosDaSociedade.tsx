import Link from "next/link";
import { ArrowRight, FolderKanban } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EstadoBadge } from "@/components/estado-badge";
import { Ref } from "@/components/ref-processo";
import { BotaoNovoProcesso } from "@/features/processos/componentes/BotaoNovoProcesso";
import { processosDaSociedade } from "@/features/plataforma/consultas";

const dt = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("pt-PT", { dateStyle: "short", timeStyle: "short" }).format(d) : "—";

export async function ProcessosDaSociedade({
  organizacaoId,
  prefixo,
}: {
  organizacaoId: string;
  prefixo: string;
}) {
  const processos = await processosDaSociedade(organizacaoId);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-4">
        <div>
          <CardTitle className="text-base">Processos de Onboarding</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Dossiers de clientes e KYC desta sociedade. O super_admin tem acesso total de leitura e edição.
          </p>
        </div>
        <BotaoNovoProcesso tamanho="sm" organizacaoId={organizacaoId} />
      </CardHeader>
      <CardContent>
        {processos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed rounded-md border-linha">
            <FolderKanban className="size-8 text-muted-foreground/60 mb-2" />
            <p className="text-sm font-medium">Ainda não há processos nesta sociedade</p>
            <p className="text-xs text-muted-foreground max-w-sm mt-1 mb-4">
              Crie o primeiro processo para gerar o link mágico de onboarding e enviar ao cliente.
            </p>
            <BotaoNovoProcesso tamanho="sm" organizacaoId={organizacaoId} />
          </div>
        ) : (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-linha text-2xs font-mono tracking-[0.14em] uppercase text-muted-foreground">
                <tr>
                  <th className="pb-2.5 font-medium">Referência</th>
                  <th className="pb-2.5 font-medium">Cliente</th>
                  <th className="pb-2.5 font-medium">Tipo</th>
                  <th className="pb-2.5 font-medium">Estado</th>
                  <th className="pb-2.5 font-medium">Passo</th>
                  <th className="pb-2.5 font-medium">Atualizado</th>
                  <th className="pb-2.5 font-medium text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linha">
                {processos.map((p) => (
                  <tr key={p.id} className="group hover:bg-muted/40 transition-colors">
                    <td className="py-3 font-mono text-xs font-medium">
                      <Link
                        href={`/admin/sociedades/${organizacaoId}/processos/${p.id}`}
                        className="text-marca hover:underline"
                      >
                        {p.referencia}
                      </Link>
                    </td>
                    <td className="py-3">
                      <div className="font-medium text-sm">
                        {p.nomeCliente || <span className="text-muted-foreground font-normal italic">Sem nome</span>}
                      </div>
                      {p.nifCliente && <Ref className="text-xs text-muted-foreground">{p.nifCliente}</Ref>}
                    </td>
                    <td className="py-3 text-xs text-muted-foreground">
                      {p.tipoCliente === "empresa" ? "Empresa" : "Particular"}
                    </td>
                    <td className="py-3">
                      <EstadoBadge estado={p.estado} />
                    </td>
                    <td className="py-3 text-xs text-muted-foreground">
                      Passo {p.passoAtual} de 7
                    </td>
                    <td className="py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {dt(p.atualizadoEm)}
                    </td>
                    <td className="py-3 text-right">
                      <Link
                        href={`/admin/sociedades/${organizacaoId}/processos/${p.id}`}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-tinta font-medium"
                      >
                        Ver / Editar
                        <ArrowRight className="size-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
