import Link from "next/link";
import { Building2, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Ref } from "@/components/ref-processo";
import { NovaSociedade } from "@/features/plataforma/componentes/NovaSociedade";
import { listarSociedades, numerosDaPlataforma } from "@/features/plataforma/consultas";

export const metadata = { title: "Plataforma" };

/**
 * O painel da plataforma.
 *
 * O número que faz agir é o das sociedades **sem administrador**: uma sociedade
 * nesse estado está criada e não tem quem a opere — ninguém entra, ninguém abre
 * processos —, e de fora parece exatamente igual às outras. É o resultado
 * previsível de o formulário deixar adiar o primeiro administrador, que é uma
 * comodidade que só se pode dar tendo este contador.
 */
export default async function PainelDaPlataforma() {
  const [n, sociedades] = await Promise.all([numerosDaPlataforma(), listarSociedades()]);

  const tiles = [
    { rotulo: "Sociedades", valor: n.sociedades, nota: "inquilinos da plataforma" },
    { rotulo: "Contas", valor: n.contas, nota: "em todas as sociedades" },
    { rotulo: "Processos", valor: n.processos, nota: "no total" },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Plataforma</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            As sociedades que usam o sistema e as contas de cada uma.
          </p>
        </div>
        <NovaSociedade />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.rotulo} className="gap-2">
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
        ))}

        <Card className={n.semAdmin > 0 ? "border-selo/40 bg-selo/5 gap-2" : "gap-2"}>
          <CardHeader className="pb-0">
            <CardTitle className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Sem administrador
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`font-mono text-3xl leading-none tabular-nums ${n.semAdmin > 0 ? "text-selo" : ""}`}
            >
              {n.semAdmin}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {n.semAdmin > 0 ? "ninguém consegue entrar nelas" : "todas têm quem as opere"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Sociedades</CardTitle>
          <Link href="/admin/sociedades" className="text-xs underline underline-offset-4">
            Ver todas
          </Link>
        </CardHeader>
        <CardContent>
          {sociedades.length === 0 ? (
            <div className="border-linha flex flex-col items-center gap-3 border border-dashed py-12 text-center">
              <Building2 className="text-tinta-suave size-6" strokeWidth={1.5} />
              <div>
                <p className="text-sm font-medium">Ainda não há sociedades.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Crie a primeira e dê-lhe um administrador.
                </p>
              </div>
              <NovaSociedade />
            </div>
          ) : (
            <ul className="border-linha divide-linha divide-y border-t">
              {sociedades.slice(0, 8).map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/admin/sociedades/${s.id}`}
                    className="hover:bg-muted flex flex-wrap items-center gap-x-4 gap-y-1 px-1 py-3 transition-colors"
                  >
                    <Ref className="text-muted-foreground">{s.prefixoReferencia}</Ref>
                    <span className="min-w-0 flex-1 truncate text-sm">{s.nome}</span>
                    {s.administradores === 0 && (
                      <span className="text-2xs border-selo/40 bg-selo/10 text-selo inline-flex items-center gap-1 rounded-xs border px-2 py-0.5">
                        <TriangleAlert className="size-3" /> sem administrador
                      </span>
                    )}
                    <Ref className="text-xs text-muted-foreground">
                      {s.contas} {s.contas === 1 ? "conta" : "contas"}
                    </Ref>
                    <Ref className="text-xs text-muted-foreground">
                      {s.processos} {s.processos === 1 ? "processo" : "processos"}
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
