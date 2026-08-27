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
          <div className="border-linha flex flex-col items-center justify-center rounded-sm border border-dashed py-8 text-center">
            <FolderKanban className="mb-2 size-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">Ainda não há processos nesta sociedade</p>
            <p className="mt-1 mb-4 max-w-sm text-xs text-muted-foreground">
              Crie o primeiro processo para gerar o link mágico de onboarding e enviar ao cliente.
            </p>
            <BotaoNovoProcesso tamanho="sm" organizacaoId={organizacaoId} />
          </div>
        ) : (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full text-sm">
              <thead className="text-2xs font-mono tracking-wider text-muted-foreground uppercase">
                <tr className="border-linha border-b text-left">
                  <th className="pb-2.5 font-medium">Referência</th>
                  <th className="pb-2.5 font-medium">Cliente</th>
                  <th className="pb-2.5 font-medium">Tipo</th>
                  <th className="pb-2.5 font-medium">Estado</th>
                  <th className="pb-2.5 font-medium">Passo</th>
                  <th className="pb-2.5 font-medium">Atualizado</th>
                  <th className="pb-2.5 font-medium text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-linha divide-y">
                {processos.map((p) => (
                  <tr key={p.id} className="group hover:bg-muted transition-colors">
                    <td className="py-2.5 font-mono text-xs font-medium">
                      <Link
                        href={`/admin/sociedades/${organizacaoId}/processos/${p.id}`}
                        className="text-marca hover:underline"
                      >
                        {p.referencia}
                      </Link>
                    </td>
                    <td className="py-2.5">
                      <div className="font-medium text-sm">
                        {p.nomeCliente || <span className="text-muted-foreground font-normal italic">Sem nome</span>}
                      </div>
                      {p.nifCliente && <Ref className="text-xs text-muted-foreground">{p.nifCliente}</Ref>}
                    </td>
                    <td className="py-2.5 text-xs text-muted-foreground">
                      {p.tipoCliente === "empresa" ? "Empresa" : "Particular"}
                    </td>
                    <td className="py-2.5">
                      <EstadoBadge estado={p.estado} />
                    </td>
                    <td className="py-2.5 text-xs text-muted-foreground">
                      Passo {p.passoAtual} de 7
                    </td>
                    <td className="py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                      {dt(p.atualizadoEm)}
                    </td>
                    <td className="py-2.5 text-right">
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
