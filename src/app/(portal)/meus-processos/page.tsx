import Link from "next/link";
import { FileText } from "lucide-react";
import { EstadoBadge } from "@/components/estado-badge";
import { Ref } from "@/components/ref-processo";
import { BotaoNovoProcesso } from "@/features/processos/componentes/BotaoNovoProcesso";
import { processosDaSociedade } from "@/features/plataforma/consultas";
import { exigirEquipaDaSociedade } from "@/lib/sessao";
import { formatarData } from "@/lib/datas";

export const metadata = { title: "Os meus processos" };

const quando = (d: Date) => formatarData(d, { dateStyle: "short", timeStyle: "short" });

/**
 * Os processos da sociedade de quem está autenticado.
 *
 * "Os meus" quer dizer **os da minha sociedade**, e não "os que eu abri". A
 * distinção interessa: um processo é da casa e não de quem o criou, e quem
 * pega nele quando o colega está de férias tem de o encontrar. O
 * `processo.responsavel_id` existe e é o que permitirá, um dia, uma vista mais
 * estreita — mas restringir hoje esconderia processos a quem tem de lhes
 * mexer.
 *
 * O isolamento é a `organizacaoId` da sessão, já estreitada para `string` pelo
 * guard: o `super_admin`, que a tem a `null`, nem sequer entra neste portal.
 */
export default async function MeusProcessos() {
  const { eu } = await exigirEquipaDaSociedade();
  const processos = await processosDaSociedade(eu.organizacaoId);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Os meus processos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Os processos de onboarding da sua sociedade, do mais recente para o mais antigo.
          </p>
        </div>
        <BotaoNovoProcesso />
      </div>

      {processos.length === 0 ? (
        <div className="border-linha flex flex-col items-center gap-3 rounded-sm border border-dashed py-12 text-center">
          <FileText className="text-tinta-suave size-6" strokeWidth={1.5} />
          <div>
            <p className="text-sm font-medium">Ainda não há processos.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Crie o primeiro e envie o link de preenchimento ao cliente.
            </p>
          </div>
          <BotaoNovoProcesso tamanho="sm" />
        </div>
      ) : (
        <ul className="border-linha divide-linha bg-papel-alto divide-y rounded-sm border">
          {processos.map((p) => (
            <li key={p.id}>
              <Link
                href={`/processos/${p.id}`}
                className="hover:bg-muted flex flex-wrap items-center gap-x-4 gap-y-1 p-3 transition-colors"
              >
                <Ref className="text-muted-foreground">{p.referencia}</Ref>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {p.nomeCliente ?? (
                    <span className="text-muted-foreground">sem nome ainda</span>
                  )}
                </span>
                <span className="text-2xs text-muted-foreground">
                  {p.tipoCliente === "empresa" ? "Empresa" : "Pessoa singular"}
                </span>
                <EstadoBadge estado={p.estado} />
                <Ref className="text-xs text-muted-foreground">{quando(p.atualizadoEm)}</Ref>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
