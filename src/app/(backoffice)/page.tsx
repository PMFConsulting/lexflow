import { FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Carimbos } from "@/components/carimbo";
import { EstadoBadge, RiscoBadge } from "@/components/estado-badge";
import { Ref } from "@/components/ref-processo";
import { BotaoNovoProcesso } from "@/features/processos/componentes/BotaoNovoProcesso";

export const metadata = { title: "Painel" };

/**
 * Painel. Sem gráficos decorativos — só o que faz agir (§6 do brief).
 *
 * As contagens ligam-se às queries na Fase 3; nesta fase o painel existe para
 * fixar a linguagem visual e provar os tokens em contexto real.
 */
const TILES = [
  { rotulo: "Por rever", valor: 0, nota: "submetidos à espera de triagem" },
  { rotulo: "Risco elevado por aprovar", valor: 0, nota: "só sócio ou admin podem aprovar" },
  { rotulo: "Parados há mais de 7 dias", valor: 0, nota: "sem atividade do cliente" },
  { rotulo: "Documentos a expirar", valor: 0, nota: "nos próximos 60 dias" },
];

export default function Painel() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Painel</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            O estado dos processos de onboarding, hoje.
          </p>
        </div>
        <BotaoNovoProcesso />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {TILES.map((tile) => (
          <Card key={tile.rotulo} className="gap-2">
            <CardHeader className="pb-0">
              <CardTitle className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {tile.rotulo}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-3xl leading-none tabular-nums">{tile.valor}</div>
              <p className="mt-2 text-xs text-muted-foreground">{tile.nota}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Atividade recente</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-3 border border-dashed border-linha py-12 text-center">
            <FileText className="size-6 text-tinta-suave" strokeWidth={1.5} />
            <div>
              <p className="text-sm font-medium">Ainda não há processos.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Crie o primeiro e envie o link de preenchimento ao cliente.
              </p>
            </div>
            <BotaoNovoProcesso tamanho="sm" />
          </div>
        </CardContent>
      </Card>

      {/* Amostra do vocabulário visual. Sai quando as queries entrarem, na Fase 3. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vocabulário visual</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
          <Ref>PMF-2026-0142</Ref>
          <EstadoBadge estado="em_revisao" />
          <EstadoBadge estado="aprovado" />
          <EstadoBadge estado="rejeitado" />
          <RiscoBadge nivel="elevado" fatores={[{ descricao: "PPE declarada" }]} />
          <Carimbos concluidos={5} />
        </CardContent>
      </Card>
    </div>
  );
}
