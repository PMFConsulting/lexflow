import Link from "next/link";
import { AlertTriangle, ArrowLeft, ShieldCheck, Mail } from "lucide-react";
import { exigirAdministracao } from "@/lib/sessao";
import {
  aceitacoesDaSociedade,
  documentosDaSociedadeAdmin,
  listarEquipa,
  sociedadeDe,
} from "@/features/administracao/consultas";
import { consultarModelosEmail } from "@/features/emails/consultas";
import { PublicarTermos } from "@/features/administracao/componentes/PublicarTermos";
import { LogotipoSociedade } from "@/features/administracao/componentes/LogotipoSociedade";
import { DadosSociedade } from "@/features/administracao/componentes/DadosSociedade";
import { EditorModelosEmail } from "@/features/emails/componentes/EditorModelosEmail";
import { PreferenciaNotificacaoEmail } from "@/features/notificacoes/componentes/PreferenciaNotificacaoEmail";
import { urlLogotipoSociedade } from "@/lib/emails/moldura";
import { Ref } from "@/components/ref-processo";
import { cn } from "@/lib/utils";
import { formatarData, formatarDataCurta } from "@/lib/datas";

export const metadata = { title: "Configurações da Sociedade" };
export const dynamic = "force-dynamic";

const dataHora = (d: Date | string) => formatarData(d, { dateStyle: "short", timeStyle: "short" });

function Linha({
  etiqueta,
  valor,
  mono = false,
}: {
  etiqueta: string;
  valor: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="border-linha flex items-baseline justify-between gap-4 border-b py-2 last:border-0">
      <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
      <dd className={cn("text-right text-sm break-all", mono && "font-mono tabular-nums")}>
        {valor || "—"}
      </dd>
    </div>
  );
}

export default async function ConfiguracoesSociedade() {
  const { eu } = await exigirAdministracao();

  const [org, documentos, aceitacoes, equipa, modelos] = await Promise.all([
    sociedadeDe(eu.organizacaoId),
    documentosDaSociedadeAdmin(eu.organizacaoId),
    aceitacoesDaSociedade(eu.organizacaoId),
    listarEquipa(eu.organizacaoId),
    consultarModelosEmail(eu.organizacaoId),
  ]);

  const termos = documentos.find((d) => d.tipo === "termos_sociedade");
  const versaoAtual = org?.termosVersao ?? null;
  const logotipoUrl = urlLogotipoSociedade(org);

  const emFalta = equipa.filter(
    (p) => p.ativo && (versaoAtual === null || p.termosVersao !== versaoAtual),
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-10">
      <div>
        <Link
          href="/gestao"
          className="text-tinta-suave hover:text-foreground inline-flex items-center gap-1.5 text-xs transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          Voltar à Administração
        </Link>
        <div className="mt-4">
          <h1 className="text-2xl">Configurações da sociedade</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Dados da sociedade, logótipo, modelos de email e conformidade dos Termos e Condições.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-12">
        {/* SECÇÃO 1: Dados e Identificação */}
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-medium border-b border-linha pb-2">Identificação e Dados</h2>
          
          <LogotipoSociedade
            temLogotipo={Boolean(org?.logotipoDados)}
            nomeLogotipo={org?.logotipoNome ?? null}
            atualizadoEm={org?.logotipoAtualizadoEm ?? null}
          />

          <section className="border-linha bg-papel-alto rounded-sm border p-4">
            <h3 className="text-lg">Identificação</h3>
            <dl className="mt-2">
              <Linha etiqueta="Nome" valor={org?.nome} />
              <Linha etiqueta="NIPC" valor={org?.nif} mono />
              <Linha etiqueta="Prefixo das referências" valor={org?.prefixoReferencia} mono />
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              Estes três identificam a sociedade e não se alteram por aqui. Para os mudar, fale com a administração da plataforma.
            </p>
          </section>

          <DadosSociedade
            inicial={{
              naturezaJuridica: org?.naturezaJuridica ?? null,
              numeroOrdem: org?.numeroOrdem ?? null,
              emailGeral: org?.emailGeral ?? null,
              telefone: org?.telefone ?? null,
              website: org?.website ?? null,
              morada: org?.morada ?? null,
              pais: org?.pais ?? null,
              localidade: org?.localidade ?? null,
              codigoPostal: org?.codigoPostal ?? null,
              freguesia: org?.freguesia ?? null,
              concelho: org?.concelho ?? null,
              distrito: org?.distrito ?? null,
            }}
          />

          {documentos.length > 0 && (
            <section className="border-linha bg-papel-alto rounded-sm border p-4">
              <h3 className="text-lg">Documentos da sociedade</h3>
              <ul className="divide-linha mt-2 divide-y">
                {documentos.map((d) => (
                  <li key={d.id} className="flex items-baseline justify-between gap-4 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{d.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.tipo === "termos_sociedade"
                          ? "Termos e Condições"
                          : d.tipo === "certidao_sociedade"
                            ? "Certidão permanente"
                            : "Outro"}
                      </p>
                    </div>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {formatarDataCurta(new Date(d.criadoEm))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>

        {/* SECÇÃO 2: Emails */}
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-medium border-b border-linha pb-2">Modelos de Email</h2>
          
          <PreferenciaNotificacaoEmail ativadoInicial={org?.notificarSubmissoesEmail ?? false} />

          <EditorModelosEmail modelosIniciais={modelos} logotipoUrl={logotipoUrl} />
        </section>

        {/* SECÇÃO 3: Termos e Conformidade */}
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-medium border-b border-linha pb-2">Termos e Conformidade</h2>
          
          <PublicarTermos
            versaoAtual={org?.termosVersao ?? null}
            atualizadoEm={org?.termosAtualizadoEm ?? null}
            nomeDocumento={termos?.nome ?? null}
          />

          <section className="border-linha bg-papel-alto rounded-sm border p-4">
            <h3 className="text-lg">Termos e Condições em vigor</h3>
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
                  genérico da plataforma.
                </span>
              </p>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-lg">Aceitações em falta</h3>
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
            <h3 className="text-lg">Registo de aceitações</h3>
            {aceitacoes.length === 0 ? (
              <p className="border-linha bg-muted rounded-sm border p-4 text-sm text-muted-foreground">
                Ainda não há aceitações registadas.
              </p>
            ) : (
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
        </section>
      </div>
    </div>
  );
}
