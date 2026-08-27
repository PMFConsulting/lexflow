import Link from "next/link";
import { Search, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EstadoBadge } from "@/components/estado-badge";
import { Ref } from "@/components/ref-processo";
import { listarClientes } from "@/features/clientes/consultas";
import { PesquisaClientes } from "@/features/clientes/componentes/PesquisaClientes";
import { BotaoExportarClientes } from "@/features/clientes/componentes/BotaoExportarClientes";
import { exigirEquipaDaSociedade } from "@/lib/sessao";

export const metadata = { title: "Clientes" };
export const dynamic = "force-dynamic";

const quando = (d: Date | string | null) => {
  if (!d) return "—";
  const data = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(data.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-PT", { dateStyle: "short" }).format(data);
};

/**
 * Um cliente é uma pessoa ou empresa distinta, deduplicada por NIF/NIPC — não
 * um processo. Quem tem três processos ao longo dos anos aparece uma vez só,
 * com os dados do mais recente.
 */
export default async function Clientes({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { eu } = await exigirEquipaDaSociedade();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : undefined;

  const clientes = await listarClientes(eu.organizacaoId, q);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Clientes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {clientes.length === 1 ? "1 cliente" : `${clientes.length} clientes`}
            {q && ` para “${q}”`}
          </p>
        </div>
        {eu.papel === "society_admin" && (
          <BotaoExportarClientes termoPesquisa={q} />
        )}
      </div>

      <PesquisaClientes />

      {clientes.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-14 text-center">
          {q ? (
            <>
              <Search className="text-tinta-suave size-6" strokeWidth={1.5} />
              <p className="text-sm font-medium">0 clientes para “{q}”.</p>
              <Link href="/clientes" className="text-sm underline underline-offset-4">
                Limpar pesquisa
              </Link>
            </>
          ) : (
            <>
              <Users className="text-tinta-suave size-6" strokeWidth={1.5} />
              <p className="text-sm font-medium">Ainda não há clientes.</p>
              <p className="text-sm text-muted-foreground">
                Um cliente aparece aqui assim que um processo tiver NIF preenchido.
              </p>
            </>
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-linha border-b text-left">
                  {[
                    "Nome",
                    "Tipo",
                    "NIF/NIPC",
                    "Email",
                    "Telefone",
                    "Nacionalidade",
                    "Processos",
                    "Último processo",
                    "Estado",
                  ].map((h) => (
                    <th
                      key={h}
                      className="text-2xs px-3 py-2.5 font-mono font-medium tracking-wider text-muted-foreground uppercase whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-linha divide-y">
                {clientes.map((c) => (
                  <tr key={c.nif} className="hover:bg-muted transition-colors">
                    <td className="max-w-56 truncate px-3 py-2.5">
                      <Link href={`/processos/${c.ultimoProcessoId}`}>
                        {c.nome ?? <span className="text-muted-foreground">—</span>}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                      {c.tipoCliente === "empresa" ? "Empresa" : "Particular"}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <Ref>{c.nif}</Ref>
                    </td>
                    <td className="max-w-48 truncate px-3 py-2.5 text-muted-foreground">
                      {c.email ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {c.telefone ? <Ref>{c.telefone}</Ref> : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                      {c.nacionalidades ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="font-mono tabular-nums">{c.totalProcessos}</span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <Link href={`/processos/${c.ultimoProcessoId}`} className="hover:text-selo">
                        <Ref>{c.ultimaReferencia}</Ref>
                      </Link>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {quando(c.ultimoCriadoEm)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <EstadoBadge estado={c.ultimoEstado} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
