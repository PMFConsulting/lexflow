import Link from "next/link";
import { Mail, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Ref } from "@/components/ref-processo";
import { FiltrosEmails } from "@/features/emails/componentes/FiltrosEmails";
import {
  LIMITE,
  facetasEmails,
  listarEmails,
  type LinhaEmail,
} from "@/features/emails/consultas";
import {
  ESTADOS_FALHADOS,
  ROTULOS_CANAL,
  ROTULOS_ESTADO,
  ROTULOS_TEMPLATE,
  type EstadoEmail,
  type TemplateEmail,
} from "@/features/emails/rotulos";
import { estadoEmail, templateEmail } from "@/db/schema/enums";
import { exigirSocietyAdmin } from "@/lib/sessao";
import { cn } from "@/lib/utils";

export const metadata = { title: "Emails" };
export const dynamic = "force-dynamic";

/**
 * A cor de cada estado, na paleta do §3.
 *
 * O carmim (`selo`) é para o que não chegou — o erro de envio e o devolvido são
 * o mesmo problema visto de dois sítios. O verde-arquivo é a única confirmação
 * a sério que esta tabela tem. O latão fica para a queixa de spam, que não é
 * falha de entrega mas exige atenção. O «Aceite» fica cinzento de propósito:
 * não é bom nem mau, é o estado em que ainda não se sabe.
 */
const TOM_ESTADO: Partial<Record<EstadoEmail, string>> = {
  erro: "border-selo/40 bg-selo/10 text-selo",
  devolvido: "border-selo/40 bg-selo/10 text-selo",
  queixa: "border-latao/40 bg-latao/10 text-latao",
  entregue: "border-arquivo/40 bg-arquivo/10 text-arquivo",
};

const quando = (d: Date | string) => {
  const data = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(data.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-PT", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(data);
};

/**
 * De onde vem o estado: o canal, o id da mensagem e a hora da confirmação.
 *
 * Fica no `title` e não numa coluna — é o que se copia para o painel do
 * fornecedor no dia em que este ecrã já não chega, e não é o que se lê a cada
 * visita. Sem id, diz-se porquê: uma linha que nunca vai sair de «Aceite» tem
 * de o anunciar, senão lê-se como "ainda a caminho" para sempre.
 */
function proveniencia(l: LinhaEmail): string {
  if (!l.canal) return "Nenhum fornecedor aceitou esta mensagem.";
  if (!l.mensagemId) {
    return `${ROTULOS_CANAL[l.canal]} — aceite sem devolver id; a entrega não se consegue confirmar.`;
  }
  const confirmado = l.verificadoEm ? ` · confirmado em ${quando(l.verificadoEm)}` : "";
  return `${ROTULOS_CANAL[l.canal]} · ${l.mensagemId}${confirmado}`;
}

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
  await exigirSocietyAdmin();

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

  const falhas = linhas.filter((l) => ESTADOS_FALHADOS.includes(l.estado)).length;
  const porConfirmar = linhas.filter((l) => l.estado === "enviado").length;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div>
        <h1 className="text-2xl">Emails</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {linhas.length === 1 ? "1 mensagem" : `${linhas.length} mensagens`}
          {falhas > 0 && ` · ${falhas === 1 ? "1 não chegou" : `${falhas} não chegaram`}`}
          {filtros.q && ` para “${filtros.q}”`}
        </p>
        {/* «Aceite» e «Entregue» não são a mesma coisa, e a diferença entre as
            duas é o defeito que esta coluna existe para tornar visível. */}
        {porConfirmar > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            <strong className="font-medium">Aceite</strong> quer dizer que o fornecedor ficou
            com a mensagem; <strong className="font-medium">Entregue</strong> quer dizer que o
            servidor do destinatário a aceitou. A confirmação chega alguns minutos depois do
            envio.
          </p>
        )}
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
                            TOM_ESTADO[l.estado] ?? "text-muted-foreground",
                          )}
                          // O par canal + id é o que se leva ao painel do
                          // fornecedor quando este ecrã já não chega.
                          title={proveniencia(l)}
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
