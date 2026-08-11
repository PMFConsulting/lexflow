import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, EyeOff, FileText, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Carimbos } from "@/components/carimbo";
import { EstadoBadge } from "@/components/estado-badge";
import { Ref } from "@/components/ref-processo";
import { auditoriaDoProcesso, ACOES } from "@/features/auditoria/consultas";
import { documentosDoProcesso, processoPorId } from "@/features/processos/consultas";
import {
  assinaturaDoProcesso,
  passosGravados,
  seccoesDoProcesso,
} from "@/features/onboarding/dados";
import {
  passosAntesDe,
  passosDoProcesso,
  type TipoCliente,
} from "@/features/onboarding/passos";
import { exigirSessao, podeAprovarProcesso, podeVerPpe } from "@/lib/sessao";
import { registarEvento } from "@/features/auditoria/registar";
import { AcoesAprovacao } from "@/features/processos/componentes/AcoesAprovacao";
import { AcoesReabrir } from "@/features/processos/componentes/AcoesReabrir";

export const dynamic = "force-dynamic";

const dt = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("pt-PT", { dateStyle: "short", timeStyle: "short" }).format(d) : "—";

const kb = (b: number) =>
  b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

const ORIGEM_CONTACTO_TEXTO: Record<string, string> = {
  evento_conferencia: "Evento / Conferência",
  recomendacao: "Recomendação de cliente anterior",
  pesquisa_online: "Pesquisa Online",
  outro: "Outro",
};

function Linha({ k, v }: { k: string; v: React.ReactNode }) {
  if (v === null || v === undefined || v === "") return null;
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="break-words">{v}</dd>
    </div>
  );
}

/**
 * Um bloco por passo.
 *
 * `preenchido` é o que distingue "o cliente ainda não chegou aqui" de "chegou
 * e não havia nada a dizer". Sem isso, um processo em rascunho abria com seis
 * cartões vazios, só com o título — e um cartão vazio lê-se como avaria, não
 * como passo por dar.
 */
function Bloco({
  titulo,
  passo,
  tipoCliente,
  preenchido,
  children,
}: {
  titulo: string;
  passo: number;
  tipoCliente: TipoCliente;
  preenchido: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-2xs font-mono tracking-[0.14em] text-muted-foreground uppercase">
          {/* A posição no percurso deste cliente, e não o número interno do
              passo: num particular o 3 não existe, e a lista lia-se 01 02 04.
              O `passo` continua a ser o número real — é ele que escolhe o
              conteúdo do bloco e que casa com os rótulos de auditoria. */}
          {String(passosAntesDe(passo, tipoCliente) + 1).padStart(2, "0")} · {titulo}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {preenchido ? (
          <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[minmax(0,13rem)_1fr]">
            {children}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Passo ainda por preencher.</p>
        )}
      </CardContent>
    </Card>
  );
}

export default async function Processo({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { eu } = await exigirSessao();

  const processo = await processoPorId(id);
  // A mesma regra da rota de download: um processo de outra organização
  // responde como um processo que não existe. Sem isto, o id na barra de
  // endereço abria o dossier inteiro — dados fiscais, PPE e auditoria — a
  // quem tem sessão em qualquer organização da instalação.
  if (!processo || processo.organizacaoId !== eu.organizacaoId) notFound();

  const [s, docs, eventos, assinatura] = await Promise.all([
    seccoesDoProcesso(processo.id),
    documentosDoProcesso(processo.id),
    auditoriaDoProcesso(processo.id),
    assinaturaDoProcesso(processo.id),
  ]);

  const vePpe = podeVerPpe(eu.papel);

  // Ler um processo é um acontecimento auditável: o §4 do brief pede registo
  // de toda a leitura de dados sensíveis, e é isso que torna o registo útil.
  await registarEvento({
    organizacaoId: processo.organizacaoId,
    processoId: processo.id,
    atorId: eu.id,
    acao: vePpe ? "processo.consultado" : "processo.consultado.sem_ppe",
    entidade: "processo_onboarding",
    entidadeId: processo.id,
    valorNovo: { papel: eu.papel },
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <Link
        href="/processos"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-tinta"
      >
        <ArrowLeft className="size-3.5" />
        Processos
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Ref className="text-sm text-muted-foreground">{processo.referencia}</Ref>
          <h1 className="mt-1 text-2xl">
            {s.identificacao?.nome ?? <span className="text-muted-foreground">Sem nome ainda</span>}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {processo.tipoCliente === "empresa" ? "Empresa / Entidade Coletiva" : "Pessoa Singular"}
            {processo.responsavel && ` · ${processo.responsavel}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <EstadoBadge estado={processo.estado} />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="flex items-center gap-2">
          <span className="text-muted-foreground">Progresso</span>
          {/* Contam-se os passos gravados, e não `passoAtual - 1`: num
              particular a numeração salta o 3, e a subtração dava um carimbo
              a um passo que ninguém preencheu. */}
          <Carimbos
            concluidos={passosGravados(s, processo.tipoCliente).length}
            total={passosDoProcesso(processo.tipoCliente).length}
          />
        </span>
        <span className="text-muted-foreground">
          Submetido <Ref>{dt(processo.submetidoEm)}</Ref>
        </span>
        <span className="text-muted-foreground">
          Atualizado <Ref>{dt(processo.atualizadoEm)}</Ref>
        </span>
      </div>

      <Separator />

      {/* ── decisão ───────────────────────────────────────────────────── */}
      {processo.estado === "aguardar_aprovacao" && podeAprovarProcesso(eu.papel) && (
        <AcoesAprovacao processoId={processo.id} />
      )}

      {processo.estado === "rejeitado" && podeAprovarProcesso(eu.papel) && (
        <AcoesReabrir processoId={processo.id} />
      )}

      {processo.estado === "rejeitado" && processo.motivoRejeicao && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Motivo da rejeição</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{processo.motivoRejeicao}</p>
          </CardContent>
        </Card>
      )}

      {/* ── dados ─────────────────────────────────────────────────────── */}
      <div className="grid gap-3">
        <Bloco
          titulo="Identificação"
          passo={1}
          tipoCliente={processo.tipoCliente}
          preenchido={Boolean(s.identificacao)}
        >
          <Linha k="Nome" v={s.identificacao?.nome} />
          <Linha k="Profissão" v={s.identificacao?.profissao} />
          <Linha k="Entidade patronal" v={s.identificacao?.entidadePatronal} />
          <Linha k="Data de nascimento" v={s.identificacao?.dataNascimento} />
          <Linha k="Natureza jurídica" v={s.identificacao?.naturezaJuridica} />
          <Linha k="Nacionalidade(s)" v={s.nacionalidades.join(", ")} />
          <Linha k="Email" v={s.identificacao?.email} />
          <Linha k="Telefone" v={<Ref>{s.identificacao?.telefone}</Ref>} />
          <Linha
            k="Morada"
            v={
              s.identificacao &&
              `${s.identificacao.morada}, ${s.identificacao.codigoPostal} ${s.identificacao.localidade} — ${s.identificacao.freguesia}, ${s.identificacao.concelho}, ${s.identificacao.distrito}`
            }
          />
        </Bloco>

        <Bloco
          titulo="Fiscal"
          passo={2}
          tipoCliente={processo.tipoCliente}
          preenchido={Boolean(s.fiscais)}
        >
          <Linha k="NIF / NIPC" v={<Ref>{s.fiscais?.nif}</Ref>} />
          <Linha k="NIF português" v={s.fiscais ? (s.fiscais.nifPortugues ? "Sim" : "Não") : null} />
          <Linha k="Reside em Portugal" v={s.fiscais ? (s.fiscais.resideEmPortugal ? "Sim" : "Não") : null} />
          <Linha k="Documento" v={<Ref>{s.fiscais?.docNumero}</Ref>} />
          <Linha k="Validade" v={<Ref>{s.fiscais?.docValidade}</Ref>} />
          <Linha k="CAE" v={s.fiscais?.cae} />
          <Linha k="Certidão permanente" v={s.fiscais?.codigoCertidaoPermanente} />
        </Bloco>

        {/* O passo 3 só existe para pessoas coletivas: uma pessoa singular
            representa-se a si própria, e o bloco em branco só diria isso. */}
        {processo.tipoCliente === "empresa" && (
        <Bloco
          titulo="Representante Legal"
          passo={3}
          tipoCliente={processo.tipoCliente}
          preenchido={Boolean(s.representante)}
        >
          <Linha
            k="Quem preencheu é o representante legal"
            v={s.representante ? (s.representante.eRepresentante ? "Sim" : "Não") : null}
          />
          {s.representante && !s.representante.eRepresentante && (
            <>
              <Linha k="Cargo" v={s.representante.relacao} />
              <Linha k="Nome" v={s.representante.nome} />
              <Linha k="Data de nascimento" v={s.representante.dataNascimento} />
              <Linha k="Nacionalidade(s)" v={s.nacionalidadesRepresentante.join(", ")} />
              <Linha k="Profissão" v={s.representante.profissao} />
              <Linha k="Email" v={s.representante.email} />
              <Linha k="Telefone" v={<Ref>{s.representante.telefone}</Ref>} />
              <Linha
                k="Morada"
                v={
                  s.representante.morada &&
                  `${s.representante.morada}, ${s.representante.codigoPostal} ${s.representante.localidade} — ${s.representante.freguesia}, ${s.representante.concelho}, ${s.representante.distrito}`
                }
              />
            </>
          )}
        </Bloco>
        )}

        {/* O passo 4 é o mais sensível do sistema. O papel `assistente` não o vê
            — nem aqui, nem por URL direto, nem por chamada à API. */}
        {vePpe ? (
          <Bloco
            titulo="PPE e relação de negócio"
            passo={4}
            tipoCliente={processo.tipoCliente}
            preenchido={Boolean(s.ppe ?? s.negocio)}
          >
            <Linha k="Pessoa politicamente exposta" v={s.ppe ? (s.ppe.ePpe ? "Sim" : "Não") : null} />
            <Linha k="Cargo" v={s.ppe?.ppeCargo} />
            <Linha k="Entidade" v={s.ppe?.ppeEntidade} />
            <Linha k="País" v={s.ppe?.ppePais} />
            {/* O fim do exercício era recolhido no passo 4 e não aparecia em
                lado nenhum: um cargo que já terminou lia-se aqui como um cargo
                em curso. */}
            <Linha
              k="Exercício"
              v={
                s.ppe?.ppeInicio &&
                (s.ppe.ppeFim
                  ? `${s.ppe.ppeInicio} a ${s.ppe.ppeFim}`
                  : `desde ${s.ppe.ppeInicio} (em exercício)`)
              }
            />
            <Linha
              k="Familiar ou associado de PPE"
              v={s.ppe ? (s.ppe.eRelacionadoPpe ? "Sim" : "Não") : null}
            />
            <Linha k="Serviços contratados" v={s.negocio?.servicos} />
            <Linha k="Origem dos fundos" v={s.negocio?.origemFundos} />
          </Bloco>
        ) : (
          <Card>
            <CardContent className="flex items-center gap-3 py-5 text-sm text-muted-foreground">
              <EyeOff className="size-4 shrink-0" />
              <span>
                <strong className="text-tinta">Passo 4 — PPE e origem de fundos</strong> não é
                visível para o papel <Ref>{eu.papel}</Ref>. A tentativa de consulta ficou
                registada na auditoria.
              </span>
            </CardContent>
          </Card>
        )}

        <Bloco
          titulo="Faturação"
          passo={5}
          tipoCliente={processo.tipoCliente}
          preenchido={Boolean(s.faturacao)}
        >
          <Linha k="Nome ou empresa" v={s.faturacao?.nome} />
          <Linha k="NIF" v={<Ref>{s.faturacao?.nif}</Ref>} />
          <Linha k="Email" v={s.faturacao?.email} />
          <Linha k="Ao cuidado de" v={s.faturacao?.acNome} />
        </Bloco>

        <Bloco
          titulo="RGPD — consentimentos"
          passo={6}
          tipoCliente={processo.tipoCliente}
          preenchido={Boolean(s.preferencias)}
        >
          <Linha k="Como chegou até nós" v={ORIGEM_CONTACTO_TEXTO[s.preferencias?.origemContacto ?? ""]} />
          <Linha
            k={
              s.preferencias?.origemContacto === "outro" ? "Em concreto" : "Recomendado por"
            }
            v={s.preferencias?.origemDetalhe}
          />
          <Linha k="Newsletter" v={s.preferencias ? (s.preferencias.newsletter ? "Sim" : "Não") : null} />
          <Linha k="Emails da newsletter" v={s.emailsNewsletter.join(", ")} />
          <Linha k="Áreas de interesse" v={s.areasInteresse.join(", ")} />
          <Linha
            k="Convites para iniciativas"
            v={s.preferencias ? (s.preferencias.convitesIniciativas ? "Sim" : "Não") : null}
          />
          <Linha k="Contacto para convites" v={s.preferencias?.convitesNome} />
        </Bloco>

        <Bloco
          titulo="T&C, aceitação de proposta e assinatura digital"
          passo={7}
          tipoCliente={processo.tipoCliente}
          preenchido={Boolean(s.fecho ?? assinatura)}
        >
          <Linha
            k="Termos e condições e proposta"
            v={s.fecho?.tcAceitacao ? "Aceite" : "Por aceitar"}
          />
          <Linha
            k="Declaração de veracidade"
            v={s.fecho?.declaracaoVeracidade ? "Aceite" : "Por aceitar"}
          />
          <Linha
            k="Rubrica"
            v={
              assinatura?.imagemDados ? (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="border-linha bg-papel-alto inline-flex items-center justify-center rounded-sm border p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={assinatura.imagemDados}
                      alt="Rubrica manuscrita do assinante"
                      className="h-10 w-auto max-w-[10rem]"
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Assinado em <Ref>{dt(assinatura.assinadoEm)}</Ref>
                  </span>
                </div>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <TriangleAlert className="size-3.5 shrink-0" />
                  Sem assinatura registada
                </span>
              )
            }
          />
        </Bloco>
      </div>

      {/* ── documentos ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Documentos</CardTitle>
        </CardHeader>
        <CardContent>
          {docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum documento anexado.</p>
          ) : (
            <ul className="border-linha divide-linha divide-y border-t">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-2.5">
                  <FileText className="text-tinta-suave size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{d.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.tipo} · {kb(d.bytes)} · <Ref>{d.hash.slice(0, 16)}…</Ref>
                    </p>
                  </div>
                  {/* Terracota é a cor de escolha do utilizador e não entra em
                      texto corrido (D45): a 3,46:1 sobre branco chega para um
                      contorno, não para um `text-xs`. Este link veste-se como o
                      de voltar aos Processos, que é o idioma de link da casa.
                      O nome do ficheiro vai no rótulo acessível — numa lista de
                      seis anexos, seis "Descarregar" iguais não dizem qual. */}
                  <a
                    href={`/processos/${processo.id}/documentos/${d.id}`}
                    download
                    aria-label={`Descarregar ${d.nome}`}
                    className="hover:text-tinta inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground"
                  >
                    <Download className="size-3.5" />
                    Descarregar
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            O download no painel vem da base de dados, com sessão exigida, e fica registado na
            auditoria. O URL assinado do armazenamento dedicado fica para quando houver object
            storage.
          </p>
        </CardContent>
      </Card>

      {/* ── auditoria ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Auditoria</CardTitle>
        </CardHeader>
        <CardContent>
          {eventos.length === 0 && (
            <p className="text-sm text-muted-foreground">Ainda não há eventos registados.</p>
          )}
          <ol className="border-linha ml-1 border-l">
            {eventos.map((e) => (
              <li key={e.id} className="relative py-2.5 pl-5">
                <span className="bg-selo absolute top-4 -left-[3px] size-1.5 rounded-full" />
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="text-sm">{ACOES[e.acao] ?? e.acao}</span>
                  <Ref className="text-xs text-muted-foreground">{dt(e.criadoEm)}</Ref>
                  {e.ator && <span className="text-xs text-muted-foreground">{e.ator}</span>}
                  {e.ip && <Ref className="text-xs text-muted-foreground">{e.ip}</Ref>}
                </div>
                <Ref className="text-2xs text-muted-foreground">{e.hash.slice(0, 24)}…</Ref>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">
            Registo append-only encadeado por hash. A base de dados recusa <code>UPDATE</code> e{" "}
            <code>DELETE</code> nesta tabela.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
