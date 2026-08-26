import Link from "next/link";
import { ArrowRight, FolderKanban, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EstadoBadge } from "@/components/estado-badge";
import { Ref } from "@/components/ref-processo";
import { listarProcessosPlataforma } from "@/features/processos/consultas";
import { listarSociedades } from "@/features/plataforma/consultas";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Processos — Plataforma",
};

const dt = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("pt-PT", { dateStyle: "short", timeStyle: "short" }).format(d) : "—";

export default async function ProcessosPlataforma({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sociedade?: string; estado?: string }>;
}) {
  const { q, sociedade, estado } = await searchParams;

  const [{ linhas: processos, total }, sociedades] = await Promise.all([
    listarProcessosPlataforma(
      {
        q,
        estado: estado ? [estado] : undefined,
      },
      sociedade || undefined,
    ),
    listarSociedades(),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-serif">Processos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Visão transversal de todos os processos de onboarding de todas as sociedades.
        </p>
      </div>

      <Card>
        <CardHeader className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between space-y-0 pb-4">
          <CardTitle className="text-base">
            Todos os Processos <span className="text-xs font-normal text-muted-foreground">({total})</span>
          </CardTitle>

          <form className="flex flex-wrap items-center gap-2" method="get">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
              <Input
                name="q"
                defaultValue={q}
                placeholder="Pesquisar cliente, NIF, ref…"
                className="h-8 w-48 pl-8 text-xs"
              />
            </div>

            <select
              name="sociedade"
              defaultValue={sociedade ?? ""}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-xs"
            >
              <option value="">Todas as sociedades</option>
              {sociedades.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome} ({s.prefixoReferencia})
                </option>
              ))}
            </select>

            <select
              name="estado"
              defaultValue={estado ?? ""}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-xs"
            >
              <option value="">Todos os estados</option>
              <option value="rascunho">Rascunho</option>
              <option value="pendente_cliente">Pendente cliente</option>
              <option value="submetido">Submetido</option>
              <option value="em_revisao">Em revisão</option>
              <option value="aguardar_aprovacao">Aguardar aprovação</option>
              <option value="aprovado">Aprovado</option>
              <option value="rejeitado">Rejeitado</option>
            </select>

            <button
              type="submit"
              className="h-8 rounded-md bg-tinta px-3 text-xs font-medium text-papel hover:bg-tinta/90"
            >
              Filtrar
            </button>
          </form>
        </CardHeader>

        <CardContent>
          {processos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed rounded-md border-linha">
              <FolderKanban className="size-8 text-muted-foreground/60 mb-2" />
              <p className="text-sm font-medium">Nenhum processo encontrado</p>
              <p className="text-xs text-muted-foreground max-w-sm mt-1">
                Tente ajustar os termos de pesquisa ou filtros aplicados.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-6 px-6">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-linha text-2xs font-mono tracking-[0.14em] uppercase text-muted-foreground">
                  <tr>
                    <th className="pb-2.5 font-medium">Referência</th>
                    <th className="pb-2.5 font-medium">Sociedade</th>
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
                          href={`/admin/sociedades/${p.organizacaoId}/processos/${p.id}`}
                          className="text-marca hover:underline"
                        >
                          {p.referencia}
                        </Link>
                      </td>
                      <td className="py-3">
                        <Link
                          href={`/admin/sociedades/${p.organizacaoId}`}
                          className="text-xs font-medium hover:underline text-tinta"
                        >
                          {p.sociedade ?? "—"}
                        </Link>
                      </td>
                      <td className="py-3">
                        <div className="font-medium text-sm">
                          {p.nome || <span className="text-muted-foreground font-normal italic">Sem nome</span>}
                        </div>
                        {p.nif && <Ref className="text-xs text-muted-foreground">{p.nif}</Ref>}
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
                          href={`/admin/sociedades/${p.organizacaoId}/processos/${p.id}`}
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
    </div>
  );
}
