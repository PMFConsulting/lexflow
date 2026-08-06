import { Cloud, HardDrive, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Ref } from "@/components/ref-processo";
import { estadoArmazenamento } from "@/features/configuracao/consultas";
import { BotaoTestarLigacao } from "@/features/configuracao/componentes/BotaoTestarLigacao";
import type { EstadoLigacao } from "@/lib/storage";
import { exigirSessao } from "@/lib/sessao";
import { cn } from "@/lib/utils";

export const metadata = { title: "Configuração" };
export const dynamic = "force-dynamic";

const dt = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("pt-PT", { dateStyle: "short", timeStyle: "short" }).format(d) : "—";

const ESTADOS: Record<EstadoLigacao, { rotulo: string; classe: string; explicacao: string }> = {
  ligado: {
    rotulo: "Ligado",
    classe: "border-arquivo/40 bg-arquivo/10 text-arquivo",
    explicacao:
      "Cada processo submetido cria a pasta do cliente com o summary.pdf e os anexos carregados.",
  },
  desativado: {
    rotulo: "Desativado",
    classe: "border-linha bg-muted text-tinta-suave",
    explicacao:
      "As credenciais estão gravadas mas a sincronização está desligada. Nada é enviado.",
  },
  por_configurar: {
    rotulo: "Por configurar",
    classe: "border-latao/40 bg-latao/10 text-latao",
    explicacao:
      "Falta ligar o destino. As credenciais gravam-se com `pnpm armazenamento configurar` — ver docs/ARMAZENAMENTO.md.",
  },
  sem_chave: {
    rotulo: "Sem chave de cifra",
    classe: "border-selo/40 bg-selo/10 text-selo",
    explicacao:
      "Há credenciais gravadas mas falta ARMAZENAMENTO_CHAVE no ambiente, e sem ela não é possível decifrá-las.",
  },
  sem_configuracao: {
    rotulo: "Sem configuração",
    classe: "border-selo/40 bg-selo/10 text-selo",
    explicacao:
      "Esta sociedade não tem linha em armazenamento_sociedade. Corra as migrações.",
  },
};

function Linha({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="break-words">{v}</dd>
    </div>
  );
}

/**
 * Estado da ligação ao armazenamento da sociedade — sem formulário de
 * credenciais de propósito: um `token_refresh` colado numa caixa de texto fica
 * no histórico do browser e nos logs do proxy. Configura-se por script, no
 * servidor, e este ecrã diz se resultou.
 */
export default async function Configuracao() {
  const { eu } = await exigirSessao();
  const { config, estado, ultimosEventos } = await estadoArmazenamento(eu.organizacaoId);

  const info = ESTADOS[estado];
  const Icone = config?.tipo === "servidor" ? HardDrive : Cloud;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="text-2xl">Configuração</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Onde é que esta sociedade guarda os dossiers dos seus clientes.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
          <CardTitle className="text-2xs flex items-center gap-2 font-mono tracking-[0.14em] text-muted-foreground uppercase">
            <Icone className="size-3.5" strokeWidth={1.5} />
            Armazenamento
          </CardTitle>
          <span
            className={cn(
              "inline-flex items-center rounded-xs border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
              info.classe,
            )}
          >
            {info.rotulo}
          </span>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{info.explicacao}</p>

          <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[minmax(0,13rem)_1fr]">
            <Linha
              k="Destino"
              v={config?.tipo === "servidor" ? "Servidor próprio (WebDAV / SFTP)" : "OneDrive"}
            />
            <Linha k="Pasta raiz" v={<Ref>{config?.pastaRaiz ?? "—"}</Ref>} />
            <Linha k="Credenciais" v={config?.parametros ? "Gravadas e cifradas" : "Por gravar"} />
            <Linha k="Última sincronização" v={dt(config?.ultimaSincronizacaoEm)} />
          </dl>

          {config?.ultimoErro && (
            <p className="border-selo/40 bg-selo/5 text-selo flex items-start gap-2 rounded-xs border p-3 text-xs">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.5} />
              <span className="break-words">{config.ultimoErro}</span>
            </p>
          )}

          <div>
            <BotaoTestarLigacao ativo={estado === "ligado"} />
          </div>
        </CardContent>
      </Card>

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
