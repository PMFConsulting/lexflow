import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Carimbos } from "@/components/carimbo";
import { EstadoBadge } from "@/components/estado-badge";
import { Ref } from "@/components/ref-processo";
import { facetas, listarProcessos } from "@/features/processos/consultas";
import { Filtros } from "@/features/processos/componentes/Filtros";
import { BotaoNovoProcesso } from "@/features/processos/componentes/BotaoNovoProcesso";
import { passosAntesDe, passosDoProcesso } from "@/features/onboarding/passos";
import { exigirEquipaDaSociedade, podeVerPpe } from "@/lib/sessao";

export const metadata = { title: "Processos" };
export const dynamic = "force-dynamic";

const quando = (d: Date | null) =>
  d ? new Intl.DateTimeFormat("pt-PT", { dateStyle: "short" }).format(d) : "—";

const lista = (v: string | string[] | undefined) =>
  v === undefined ? undefined : Array.isArray(v) ? v : [v];

/**
 * Listagem de processos.
 *
 * Filtros no URL, não em estado local: o §6 pede que um filtro seja
 * partilhável por link — "risco elevado + por aprovar" tem de abrir igual para
 * quem receber o endereço.
 */
export default async function Processos({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { eu } = await exigirEquipaDaSociedade();
  const sp = await searchParams;

  // O papel `assistente` não vê declarações de PPE no detalhe — e não pode
  // vê-las por outra porta: filtrar a lista por `?ppe=sim` dava-lhe exatamente
  // a mesma informação, só que em bloco. O filtro é ignorado, e não devolve
  // erro: quem lá chegar por um link partilhado vê a lista toda.
  const vePpe = podeVerPpe(eu.papel);
  const ppe: "sim" | "nao" | undefined = !vePpe
    ? undefined
    : sp.ppe === "sim"
      ? "sim"
      : sp.ppe === "nao"
        ? "nao"
        : undefined;

  const filtros = {
    q: typeof sp.q === "string" ? sp.q : undefined,
    estado: lista(sp.estado),
    tipo: lista(sp.tipo),
    ppe,
    pagina: Number(sp.pagina) || 1,
  };

  /** Mantém os filtros ao mudar de página, sem os reescrever à mão. */
  const comPagina = (n: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (k === "pagina" || v === undefined) continue;
      if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
      else p.set(k, v);
    }
    p.set("pagina", String(n));
    return `/processos?${p}`;
  };

  const gestorId = eu.papel === "gestor" ? eu.id : undefined;

  const [{ linhas, total, pagina, porPagina }, f] = await Promise.all([
    listarProcessos(filtros, eu.organizacaoId, { gestorId }),
    facetas(eu.organizacaoId, gestorId),
  ]);

  const paginas = Math.max(1, Math.ceil(total / porPagina));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Processos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total === 1 ? "1 processo" : `${total} processos`}
            {filtros.q && ` para “${filtros.q}”`}
          </p>
        </div>
        {/* O sítio natural para criar um processo é a lista deles, e não só o
            painel — era preciso voltar atrás para chegar ao botão. */}
        <BotaoNovoProcesso />
      </div>

      <Filtros facetas={f} vePpe={vePpe} />

      {linhas.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-14 text-center">
          <Search className="text-tinta-suave size-6" strokeWidth={1.5} />
          <p className="text-sm font-medium">Nenhum processo com estes filtros.</p>
          <Link href="/processos" className="text-sm underline underline-offset-4">
            Limpar filtros
          </Link>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-linha border-b text-left">
                  {["Referência", "Cliente", "Tipo", "Estado", "Progresso", "Submetido", "Responsável"].map(
                    (h) => (
                      <th
                        key={h}
                        className="text-2xs px-3 py-2.5 font-mono font-medium tracking-wider text-muted-foreground uppercase whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-linha divide-y">
                {linhas.map((p) => (
                  <tr key={p.id} className="hover:bg-muted transition-colors">
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <Link href={`/processos/${p.id}`} className="hover:text-selo">
                        <Ref>{p.referencia}</Ref>
                      </Link>
                    </td>
                    <td className="max-w-56 truncate px-3 py-2.5">
                      <Link href={`/processos/${p.id}`}>
                        {p.nome ?? <span className="text-muted-foreground">—</span>}
                      </Link>
                      {p.nif && (
                        <Ref className="ml-2 text-xs text-muted-foreground">{p.nif}</Ref>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                      {p.tipoCliente === "empresa" ? "Empresa" : "Particular"}
                    </td>
                    <td className="px-3 py-2.5">
                      <EstadoBadge estado={p.estado} />
                    </td>
                    <td className="px-3 py-2.5">
                      <Carimbos
                        concluidos={passosAntesDe(p.passoAtual, p.tipoCliente)}
                        total={passosDoProcesso(p.tipoCliente).length}
                      />
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <Ref className="text-xs text-muted-foreground">
                        {quando(p.submetidoEm)}
                      </Ref>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                      {p.responsavel ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {paginas > 1 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Paginação">
          <span className="text-muted-foreground">
            Página {pagina} de {paginas}
          </span>
          <div className="flex gap-2">
            {pagina > 1 && (
              <Button asChild variant="outline" size="sm">
                <Link href={comPagina(pagina - 1)}>
                  Anterior
                </Link>
              </Button>
            )}
            {pagina < paginas && (
              <Button asChild variant="outline" size="sm">
                <Link href={comPagina(pagina + 1)}>
                  Seguinte
                </Link>
              </Button>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
