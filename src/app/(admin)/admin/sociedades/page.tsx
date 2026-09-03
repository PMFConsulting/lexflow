import Link from "next/link";
import { Building2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Ref } from "@/components/ref-processo";
import { NovaSociedade } from "@/features/plataforma/componentes/NovaSociedade";
import { listarSociedades } from "@/features/plataforma/consultas";
import { formatarDataCurta } from "@/lib/datas";
import { exigirSuperAdmin } from "@/lib/sessao";

export const metadata = { title: "Sociedades" };

/**
 * A lista de sociedades.
 *
 * A pesquisa vai por `searchParams` e resolve-se no servidor, como em
 * `/processos` e `/clientes` — o mesmo padrão, e pela mesma razão: o volume
 * cresce, e uma lista filtrada no browser é uma lista que se carrega inteira.
 */
export default async function Sociedades({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  // Guard próprio, e não só o do layout: em Next uma página é um módulo que
  // pode ser alcançado sem o layout ter corrido (RSC payload pedido à mão), e
  // este portal é o único sítio sem filtro por sociedade.
  await exigirSuperAdmin();
  const sociedades = await listarSociedades(q);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Sociedades</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cada sociedade é um inquilino: os processos, os clientes e as contas vivem dentro
            dela e não se veem de fora.
          </p>
        </div>
        <NovaSociedade />
      </div>

      <form className="border-linha bg-papel-alto flex flex-wrap items-center gap-3 rounded-sm border p-3">
        <Input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Nome, NIPC ou prefixo"
          aria-label="Procurar sociedades"
          className="bg-papel-alto flex-1"
        />
        <Button type="submit" variant="outline">
          Procurar
        </Button>
      </form>

      {sociedades.length === 0 ? (
        <div className="border-linha flex flex-col items-center gap-3 rounded-sm border border-dashed py-12 text-center">
          <Building2 className="text-tinta-suave size-6" strokeWidth={1.5} />
          <p className="text-sm font-medium">
            {q ? "Nenhuma sociedade corresponde a essa procura." : "Ainda não há sociedades."}
          </p>
        </div>
      ) : (
        <ul className="border-linha divide-linha bg-papel-alto divide-y rounded-sm border">
          {sociedades.map((s) => (
            <li key={s.id}>
              <Link
                href={`/admin/sociedades/${s.id}`}
                className="hover:bg-muted flex flex-wrap items-center gap-x-4 gap-y-1 p-3 transition-colors"
              >
                <Ref className="text-muted-foreground">{s.prefixoReferencia}</Ref>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.nome}</span>
                <Ref className="text-xs text-muted-foreground">{s.nif}</Ref>
                {s.administradores === 0 && (
                  <span className="text-2xs border-selo/40 bg-selo/10 text-selo inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5">
                    <TriangleAlert className="size-3" /> sem administrador
                  </span>
                )}
                <Ref className="text-xs text-muted-foreground">
                  {s.contas} {s.contas === 1 ? "conta" : "contas"}
                </Ref>
                <Ref className="text-xs text-muted-foreground">
                  {s.processos} {s.processos === 1 ? "processo" : "processos"}
                </Ref>
                <Ref className="text-2xs text-muted-foreground">{formatarDataCurta(s.criadoEm)}</Ref>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
