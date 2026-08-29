import { AlertTriangle, ShieldCheck } from "lucide-react";
import { Ref } from "@/components/ref-processo";
import { exigirAdministracao } from "@/lib/sessao";
import {
  aceitacoesDaSociedade,
  listarEquipa,
  sociedadeDe,
} from "@/features/administracao/consultas";
import { formatarData } from "@/lib/datas";

export const metadata = { title: "Conformidade" };
export const dynamic = "force-dynamic";

const dataHora = (d: Date | string) => formatarData(d, { dateStyle: "short", timeStyle: "short" });

/**
 * O ecrã da prova.
 *
 * É o que se abre numa validação jurídica, e por isso não é um painel de
 * estatísticas: é a lista das **linhas de prova** de aceitação do articulado —
 * quem, que versão, quando e de que endereço —, incluindo as das versões
 * antigas. Uma pessoa que tenha aceitado três versões ao longo de quatro anos
 * aparece três vezes, e é assim que tem de ser: a D3 existe precisamente para
 * que a aceitação antiga continue a apontar para o texto que quem a deu viu.
 *
 * O que **não** está aqui, de propósito: um botão de apagar. Nenhuma linha
 * desta página se pode remover pela interface, porque nenhuma se deve remover.
 */
export default async function Conformidade() {
  const { eu } = await exigirAdministracao();

  const [org, aceitacoes, equipa] = await Promise.all([
    sociedadeDe(eu.organizacaoId),
    aceitacoesDaSociedade(eu.organizacaoId),
    listarEquipa(eu.organizacaoId),
  ]);

  const versaoAtual = org?.termosVersao ?? null;

  // Quem tem acesso e não aceitou a versão que está de pé. É a única pergunta
  // desta página que exige ação, e por isso vem primeiro.
  const emFalta = equipa.filter(
    (p) => p.ativo && (versaoAtual === null || p.termosVersao !== versaoAtual),
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div>
        <h1 className="text-2xl">Conformidade</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          As aceitações dos Termos e Condições da sociedade, com a versão, a data e o endereço de onde foram
          dadas. Nenhuma destas linhas se apaga — são a prova de que a lei manda ser possível
          apresentar.
        </p>
      </div>

      <section className="border-linha bg-papel-alto rounded-sm border p-4">
        <h2 className="text-lg">Termos e Condições em vigor</h2>
        {versaoAtual ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Versão <Ref>{versaoAtual}</Ref>
            {org?.termosAtualizadoEm
              ? `, publicada em ${dataHora(new Date(org.termosAtualizadoEm))}`
              : ""}
            . É esta que os clientes aceitam no passo final do registo e que cada pessoa da equipa
            aceita no registo dela.
          </p>
        ) : (
          <p className="text-latao mt-2 flex items-start gap-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              A sociedade ainda não publicou Termos e Condições. Os clientes estão a aceitar o texto
              genérico da plataforma, que é texto de demonstração e não o contrato da sociedade —
              é o primeiro ponto que uma validação jurídica vai levantar.
            </span>
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg">Aceitações em falta</h2>
        {emFalta.length === 0 ? (
          <p className="border-arquivo/40 bg-arquivo/5 text-arquivo flex items-center gap-2 rounded-sm border p-3 text-sm">
            <ShieldCheck className="size-4 shrink-0" />
            Toda a equipa com acesso aceitou a versão em vigor.
          </p>
        ) : (
          <ul className="border-latao/40 divide-latao/20 bg-latao/5 divide-y rounded-sm border">
            {emFalta.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm">{p.nome}</p>
                  <p className="truncate text-xs text-muted-foreground">{p.email}</p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {p.termosVersao
                    ? `Aceitou a versão ${p.termosVersao}`
                    : "Sem aceitação registada"}
                </span>
              </li>
            ))}
          </ul>
        )}
        {emFalta.length > 0 && versaoAtual && (
          <p className="text-xs text-muted-foreground">
            Uma versão nova do articulado não invalida os acessos existentes — o que ela cria é
            esta lista. A aceitação da versão nova é pedida no registo; para quem já tem conta,
            aparece no portal de cada pessoa.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg">Registo de aceitações</h2>
        {aceitacoes.length === 0 ? (
          <p className="border-linha bg-muted rounded-sm border p-4 text-sm text-muted-foreground">
            Ainda não há aceitações registadas.
          </p>
        ) : (
          // O contentor rola por si: uma tabela com IP e data não cabe num
          // telemóvel, e o que não pode acontecer é a página inteira rolar para
          // o lado.
          <div className="border-linha overflow-x-auto rounded-sm border">
            <table className="w-full min-w-[42rem] text-sm">
              <thead className="bg-muted text-2xs text-muted-foreground uppercase">
                <tr>
                  <th className="px-3 py-2 text-left font-mono tracking-wider">Pessoa</th>
                  <th className="px-3 py-2 text-left font-mono tracking-wider">Versão</th>
                  <th className="px-3 py-2 text-left font-mono tracking-wider">Aceite em</th>
                  <th className="px-3 py-2 text-left font-mono tracking-wider">Endereço</th>
                </tr>
              </thead>
              <tbody className="divide-linha divide-y">
                {aceitacoes.map((a) => (
                  <tr key={a.id}>
                    <td className="px-3 py-2">
                      <p className="truncate">{a.nome ?? a.nomeConvite ?? "—"}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {a.email ?? a.emailConvite ?? "—"}
                        {/* Uma aceitação sem conta do outro lado é prova
                            válida: alguém que aceitou no passo 5 e abandonou o
                            registo no 6. Escondê-la seria esconder uma linha de
                            prova por uma razão de apresentação. */}
                        {!a.email && a.emailConvite ? " · registo por concluir" : ""}
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      <Ref>{a.versao}</Ref>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs tabular-nums">
                      {dataHora(new Date(a.aceiteEm))}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{a.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="border-linha bg-muted/40 rounded-sm border border-dashed p-4">
        <h2 className="text-lg">Onde está o resto da prova</h2>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-4 text-sm text-muted-foreground">
          <li>
            A <strong className="text-tinta">aceitação do cliente</strong> fica no dossier dele,
            com a versão do articulado que lhe foi apresentada, ao lado da assinatura e do código
            de verificação por email.
          </li>
          <li>
            A <strong className="text-tinta">declaração de sigilo profissional</strong> de cada
            pessoa da equipa fica no registo de auditoria, com a data e o endereço.
          </li>
          <li>
            O <strong className="text-tinta">registo de auditoria</strong> não pode ser alterado
            nem apagado — é o registo definitivo do que aconteceu. Está detalhado, obrigação a
            obrigação, em <code>docs/CONFORMIDADE.md</code>.
          </li>
        </ul>
      </section>
    </div>
  );
}
