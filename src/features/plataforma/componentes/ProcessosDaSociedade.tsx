import { FolderKanban } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EstadoBadge } from "@/components/estado-badge";
import { Ref } from "@/components/ref-processo";
import { BotaoNovoProcesso } from "@/features/processos/componentes/BotaoNovoProcesso";
import { metadadosProcessosDaSociedade } from "@/features/plataforma/consultas";
import { formatarData } from "@/lib/datas";

const dt = (d: Date | null | undefined) =>
  formatarData(d, { dateStyle: "short", timeStyle: "short" });

export async function ProcessosDaSociedade({
  organizacaoId,
  prefixo,
}: {
  organizacaoId: string;
  prefixo: string;
}) {
  const processos = await metadadosProcessosDaSociedade(organizacaoId);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-4">
        <div>
          <CardTitle className="text-base">Processos de Onboarding</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Metadados dos processos desta sociedade. Os dados confidenciais de clientes pertencem exclusivamente à sociedade.
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
                  <th className="pb-2.5 font-medium">Responsável</th>
                  <th className="pb-2.5 font-medium">Tipo</th>
                  <th className="pb-2.5 font-medium">Estado</th>
                  <th className="pb-2.5 font-medium">Passo</th>
                  <th className="pb-2.5 font-medium">Atualizado</th>
                </tr>
              </thead>
              <tbody className="divide-linha divide-y">
                {processos.map((p) => (
                  <tr key={p.id} className="group hover:bg-muted transition-colors">
                    <td className="py-2.5 font-mono text-xs font-medium">
                      <Ref className="font-medium text-xs text-tinta">{p.referencia}</Ref>
                    </td>
                    <td className="py-2.5 text-xs text-muted-foreground">
                      {p.responsavel ?? "—"}
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
                      <Ref className="text-xs text-muted-foreground">{dt(p.atualizadoEm)}</Ref>
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
