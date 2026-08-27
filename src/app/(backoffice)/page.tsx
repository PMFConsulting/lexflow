import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EstadoBadge } from "@/components/estado-badge";
import { Ref } from "@/components/ref-processo";
import { BotaoNovoProcesso } from "@/features/processos/componentes/BotaoNovoProcesso";
import { numerosDoPainel, recentes } from "@/features/processos/consultas";
import { exigirEquipaDaSociedade, portalDoPapel } from "@/lib/sessao";

export const metadata = { title: "Painel" };

const quando = (d: Date) =>
  new Intl.DateTimeFormat("pt-PT", { dateStyle: "short", timeStyle: "short" }).format(d);

/**
 * Painel — e o despachante da raiz.
 *
 * `/` é o destino único a seguir ao início de sessão, e é aqui que ele se
 * resolve: o ecrã de entrada manda toda a gente para a raiz e é o servidor que
 * decide para onde. Assim o browser nunca precisa de saber o papel de quem
 * entra para calcular um destino — o que, além de mais simples, evita
 * anunciar o papel a quem ainda não passou por guard nenhum.
 *
 * Para o `society_admin`, `portalDoPapel` devolve `/` e a página continua para
 * baixo, que é o painel. Os outros dois saem daqui.
 *
 * Sem gráficos decorativos — só o que faz agir (§6 do brief). Cada número é um
 * link para a listagem já filtrada: ver "3 por rever" e não poder clicar seria
 * obrigar a refazer o filtro à mão.
 */
export default async function Painel() {
  const { eu } = await exigirEquipaDaSociedade();

  const destino = portalDoPapel(eu.papel);
  if (destino !== "/") redirect(destino);

  const [n, ultimos] = await Promise.all([
    numerosDoPainel(eu.organizacaoId),
    recentes(eu.organizacaoId),
  ]);

  const tiles = [
    {
      rotulo: "Por rever",
      valor: n.porRever,
      nota: "à espera de aprovação",
      href: "/processos?estado=aguardar_aprovacao&estado=submetido&estado=em_revisao",
    },
    {
      rotulo: "Parados há mais de 7 dias",
      valor: n.parados,
      nota: "sem atividade do cliente",
      href: "/processos?estado=rascunho&estado=pendente_cliente",
    },
    {
      rotulo: "Documentos a expirar",
      valor: n.aExpirar,
      nota: "nos próximos 60 dias",
      href: "/processos",
    },
  ];

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
        {tiles.map((t) => (
          <Link key={t.rotulo} href={t.href} className="group">
            <Card className="hover:border-tinta-suave h-full gap-2 transition-colors">
              <CardHeader className="pb-0">
                <CardTitle className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {t.rotulo}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-mono text-3xl leading-none tabular-nums">{t.valor}</div>
                <p className="mt-2 text-xs text-muted-foreground">{t.nota}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Atividade recente</CardTitle>
          <Link href="/processos" className="text-xs underline underline-offset-4">
            Ver todos
          </Link>
        </CardHeader>
        <CardContent>
          {ultimos.length === 0 ? (
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
            <ul className="border-linha divide-linha divide-y border-t">
              {ultimos.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/processos/${p.id}`}
                    className="hover:bg-muted flex flex-wrap items-center gap-x-4 gap-y-1 px-1 py-3 transition-colors"
                  >
                    <Ref className="text-muted-foreground">{p.referencia}</Ref>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {p.nome ?? <span className="text-muted-foreground">sem nome ainda</span>}
                    </span>
                    <EstadoBadge estado={p.estado} />
                    <Ref className="text-xs text-muted-foreground">
                      {quando(p.atualizadoEm)}
                    </Ref>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
