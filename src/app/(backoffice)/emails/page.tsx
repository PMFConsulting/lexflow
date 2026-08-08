import Link from "next/link";
import { Mail, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Ref } from "@/components/ref-processo";
import { FiltrosEmails } from "@/features/emails/componentes/FiltrosEmails";
import { LIMITE, facetasEmails, listarEmails } from "@/features/emails/consultas";
import {
  ROTULOS_ESTADO,
  ROTULOS_TEMPLATE,
  type EstadoEmail,
  type TemplateEmail,
} from "@/features/emails/rotulos";
import { estadoEmail, templateEmail } from "@/db/schema/enums";
import { exigirAdmin } from "@/lib/sessao";
import { cn } from "@/lib/utils";

export const metadata = { title: "Emails" };
export const dynamic = "force-dynamic";

const quando = (d: Date | string) => {
  const data = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(data.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-PT", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(data);
};

/**
 * Lê um parâmetro repetível do URL e deita fora o que não seja do enum.
 *
 * Sem isto, um `?estado=qualquer-coisa` escrito à mão entrava no `inArray` e
 * fazia o Postgres rebentar a comparar texto com o tipo enumerado — um 500 a
 * partir do URL, que é barato de fechar aqui.
 */
function valores<T extends string>(
  bruto: string | string[] | undefined,
  validos: readonly T[],
): T[] | undefined {
  const lista = (Array.isArray(bruto) ? bruto : bruto ? [bruto] : []).filter((v): v is T =>
    (validos as readonly string[]).includes(v),
  );
  return lista.length ? lista : undefined;
}

/**
 * O diário do canal de email: uma linha por tentativa de envio, com o erro
 * quando houve erro.
 *
 * Responde à pergunta que se faz quando um cliente diz que não recebeu nada —
 * saiu? para que endereço? quando? — e é por isso que as falhas aparecem na
 * mesma lista dos sucessos, e não escondidas atrás de um filtro.
 */
export default async function Emails({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigirAdmin();

  const sp = await searchParams;
  const filtros = {
    q: typeof sp.q === "string" ? sp.q : undefined,
    estado: valores<EstadoEmail>(sp.estado, estadoEmail.enumValues),
    template: valores<TemplateEmail>(sp.template, templateEmail.enumValues),
  };

  const [linhas, facetas] = await Promise.all([
    listarEmails(filtros),
    facetasEmails(filtros),
  ]);

  const falhas = linhas.filter((l) => l.estado === "erro").length;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div>
        <h1 className="text-2xl">Emails</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {linhas.length === 1 ? "1 mensagem" : `${linhas.length} mensagens`}
          {falhas > 0 && ` · ${falhas === 1 ? "1 com erro" : `${falhas} com erro`}`}
          {filtros.q && ` para “${filtros.q}”`}
        </p>
      </div>

      <FiltrosEmails facetas={facetas} />

      {linhas.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-14 text-center">
          {filtros.q || filtros.estado || filtros.template ? (
            <>
              <Search className="text-tinta-suave size-6" strokeWidth={1.5} />
              <p className="text-sm font-medium">Nenhuma mensagem com estes filtros.</p>
              <Link href="/emails" className="text-sm underline underline-offset-4">
                Limpar filtros
              </Link>
            </>
          ) : (
            <>
              <Mail className="text-tinta-suave size-6" strokeWidth={1.5} />
              <p className="text-sm font-medium">Ainda não saiu nenhum email.</p>
              <p className="text-sm text-muted-foreground">
                Cada mensagem enviada pelo sistema — o link de registo, a confirmação de
                receção, as boas-vindas — aparece aqui, tenha saído ou falhado.
              </p>
            </>
          )}
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-linha border-b text-left">
                    {["Data", "Destinatário", "Assunto", "Tipo", "Processo", "Estado"].map(
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
                  {linhas.map((l) => (
                    <tr key={l.id} className="hover:bg-muted align-top transition-colors">
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <Ref className="text-muted-foreground">{quando(l.criadoEm)}</Ref>
                      </td>
                      <td className="max-w-56 truncate px-3 py-2.5">{l.para}</td>
                      <td className="max-w-72 px-3 py-2.5">
                        <span className="block truncate">{l.assunto}</span>
                        {/* O motivo da falha fica à vista, por baixo do assunto:
                            é a razão de alguém ter aberto esta página. */}
                        {l.erro && (
                          <span className="text-selo mt-0.5 block font-mono text-xs break-all">
                            {l.erro}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                        {ROTULOS_TEMPLATE[l.template] ?? l.template}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {l.processoId && l.referencia ? (
                          <Link href={`/processos/${l.processoId}`} className="hover:text-selo">
                            <Ref>{l.referencia}</Ref>
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span
                          className={cn(
                            "border-linha inline-flex rounded-sm border px-1.5 py-0.5 font-mono text-xs",
                            l.estado === "erro"
                              ? "border-selo/40 bg-selo/10 text-selo"
                              : "text-muted-foreground",
                          )}
                        >
                          {ROTULOS_ESTADO[l.estado] ?? l.estado}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Um corte silencioso lia-se como "é isto que há". */}
          {linhas.length === LIMITE && (
            <p className="text-xs text-muted-foreground">
              A mostrar as {LIMITE} mensagens mais recentes. Use a pesquisa ou os filtros
              para chegar às anteriores.
            </p>
          )}
        </>
      )}
    </div>
  );
}
