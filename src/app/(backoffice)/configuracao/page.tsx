import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Ref } from "@/components/ref-processo";
import { estadoArmazenamento } from "@/features/configuracao/consultas";
import { exigirSessao } from "@/lib/sessao";
import { cn } from "@/lib/utils";

export const metadata = { title: "Configuração" };
export const dynamic = "force-dynamic";

const dt = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("pt-PT", { dateStyle: "short", timeStyle: "short" }).format(d) : "—";

/**
 * A secção "Armazenamento" — estado da ligação, destino, pasta raiz,
 * credenciais e teste de ligação — saiu da UI a pedido do cliente. O motor
 * (`lib/storage`, a tabela de configuração, as variáveis de ambiente) mantém-se
 * intacto e continua a arquivar em cada submissão; o que desapareceu foi o
 * ecrã. Fica a lista das sincronizações, que é o registo de que aconteceu.
 */
export default async function Configuracao() {
  const { eu } = await exigirSessao();
  const { ultimosEventos } = await estadoArmazenamento(eu.organizacaoId);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="text-2xl">Configuração</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O arquivo dos dossiers é configurado no servidor. Aqui fica o registo de cada envio.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-2xs font-mono tracking-[0.14em] text-muted-foreground uppercase">
            Últimas sincronizações
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ultimosEventos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ainda não houve nenhuma. A primeira acontece quando um processo for submetido.
            </p>
          ) : (
            <ul className="divide-linha divide-y text-sm">
              {ultimosEventos.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
                  <span
                    className={cn(
                      "text-2xs font-mono tracking-wider uppercase",
                      e.acao === "armazenamento.erro" ? "text-selo" : "text-arquivo",
                    )}
                  >
                    {e.acao === "armazenamento.erro" ? "Erro" : "Enviado"}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    <Ref>{dt(e.criadoEm)}</Ref>
                  </span>
                  {e.detalhe && <span className="min-w-0 break-words">{e.detalhe}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
