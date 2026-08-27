import Link from "next/link";
import { ArrowLeft, Download, EyeOff, FileText, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Carimbos } from "@/components/carimbo";
import { EstadoBadge } from "@/components/estado-badge";
import { Ref } from "@/components/ref-processo";
import { ACOES } from "@/features/auditoria/consultas";
import type { LinhaEmailDoProcesso } from "@/features/emails/consultas";
import {
  ESTADOS_FALHADOS,
  ROTULOS_CANAL,
  ROTULOS_ESTADO,
  ROTULOS_TEMPLATE,
  TOM_ESTADO,
} from "@/features/emails/rotulos";
import {
  passosAntesDe,
  passosDoProcesso,
  type TipoCliente,
} from "@/features/onboarding/passos";
import { AcoesAprovacao } from "@/features/processos/componentes/AcoesAprovacao";
import { PropostaComercial } from "@/features/processos/componentes/PropostaComercial";
import { ModalEditarSeccao } from "./ModalEditarSeccao";
import { passosGravados, type Seccoes } from "@/features/onboarding/dados";

const dt = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("pt-PT", { dateStyle: "short", timeStyle: "short" }).format(d) : "—";

/**
 * `criadoEm` do `email_log` chega como `Date` ou como texto, consoante o
 * caminho por onde a linha veio. O `dt` acima só sabe `Date`, e um `string`
 * silenciosamente formatado como "—" é uma mensagem sem data no meio de uma
 * cronologia.
 */
const dtm = (d: Date | string) => {
  const data = d instanceof Date ? d : new Date(d);
  return Number.isNaN(data.getTime()) ? "—" : dt(data);
};

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

function Bloco({
  titulo,
  passo,
  tipoCliente,
  preenchido,
  processoId,
  seccoes,
  podeEditar = true,
  children,
}: {
  titulo: string;
  passo: number;
  tipoCliente: TipoCliente;
  preenchido: boolean;
  processoId: string;
  seccoes: Seccoes;
  podeEditar?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-2xs font-mono tracking-[0.14em] text-muted-foreground uppercase">
          {String(passosAntesDe(passo, tipoCliente) + 1).padStart(2, "0")} · {titulo}
        </CardTitle>
        {podeEditar && (
          <ModalEditarSeccao
            processoId={processoId}
            passo={passo}
            tipoCliente={tipoCliente}
            seccoes={seccoes}
            titulo={titulo}
          />
        )}
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

import type { estadoProcesso } from "@/db/schema/enums";

type Estado = (typeof estadoProcesso.enumValues)[number];

export type DetalheProcessoProps = {
  processo: {
    id: string;
    organizacaoId: string;
    referencia: string;
    tipoCliente: TipoCliente;
    nomeCliente: string | null;
    nifCliente: string | null;
    emailCliente: string | null;
    estado: Estado;
    passoAtual: number;
    responsavelId: string | null;
    responsavel: string | null;
    nivelRisco: string;
    submetidoEm: Date | null;
    atualizadoEm: Date | null;
    motivoRejeicao: string | null;
  };
  seccoes: Seccoes;
  documentos: Array<{
    id: string;
    nome: string;
    tipo: string;
    bytes: number;
    hash: string;
    criadoEm: Date;
  }>;
  eventos: Array<{
    id: string;
    acao: string;
    criadoEm: Date;
    ator: string | null;
    ip: string | null;
    hash: string;
  }>;
  emails: LinhaEmailDoProcesso[];
  assinatura: {
    imagemDados: string | null;
    assinadoEm: Date | null;
  } | null;
  proposta: {
    id: string;
    nome: string;
    bytes: number;
  } | null;
  vePpe: boolean;
  podeAprovar: boolean;
  podeEditar?: boolean;
  caminhoVoltar: string;
  textoVoltar?: string;
  papelAtual?: string;
};

export function DetalheProcesso({
  processo,
  seccoes: s,
  documentos: docs,
  eventos,
  emails,
  assinatura,
  proposta,
  vePpe,
  podeAprovar,
  podeEditar = true,
  caminhoVoltar,
  textoVoltar = "Voltar",
  papelAtual,
}: DetalheProcessoProps) {
  const naoChegaram = emails.filter((m) => ESTADOS_FALHADOS.includes(m.estado)).length;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <Link
        href={caminhoVoltar}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-tinta"
      >
        <ArrowLeft className="size-3.5" />
        {textoVoltar}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Ref className="text-sm text-muted-foreground">{processo.referencia}</Ref>
          <h1 className="mt-1 text-2xl font-serif">
            {s.identificacao?.nome ?? processo.nomeCliente ?? (
              <span className="text-muted-foreground">Sem nome ainda</span>
            )}
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
      {processo.estado === "aguardar_aprovacao" && podeAprovar && (
        <AcoesAprovacao processoId={processo.id} />
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
          processoId={processo.id}
          seccoes={s}
          podeEditar={podeEditar}
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
          processoId={processo.id}
          seccoes={s}
          podeEditar={podeEditar}
        >
          <Linha k="NIF / NIPC" v={<Ref>{s.fiscais?.nif}</Ref>} />
          <Linha k="NIF português" v={s.fiscais ? (s.fiscais.nifPortugues ? "Sim" : "Não") : null} />
          <Linha k="Reside em Portugal" v={s.fiscais ? (s.fiscais.resideEmPortugal ? "Sim" : "Não") : null} />
          <Linha k="Documento" v={<Ref>{s.fiscais?.docNumero}</Ref>} />
          <Linha k="Validade" v={<Ref>{s.fiscais?.docValidade}</Ref>} />
          <Linha k="CAE" v={s.fiscais?.cae} />
          <Linha k="Certidão permanente" v={s.fiscais?.codigoCertidaoPermanente} />
        </Bloco>

        {processo.tipoCliente === "empresa" && (
          <Bloco
            titulo="Representante Legal"
            passo={3}
            tipoCliente={processo.tipoCliente}
            preenchido={Boolean(s.representante)}
            processoId={processo.id}
            seccoes={s}
            podeEditar={podeEditar}
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

        {vePpe ? (
          <Bloco
            titulo="PPE e relação de negócio"
            passo={4}
            tipoCliente={processo.tipoCliente}
            preenchido={Boolean(s.ppe ?? s.negocio)}
            processoId={processo.id}
            seccoes={s}
            podeEditar={podeEditar}
          >
            <Linha k="Pessoa politicamente exposta" v={s.ppe ? (s.ppe.ePpe ? "Sim" : "Não") : null} />
            <Linha k="Cargo" v={s.ppe?.ppeCargo} />
            <Linha k="Entidade" v={s.ppe?.ppeEntidade} />
            <Linha k="País" v={s.ppe?.ppePais} />
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
                visível para o papel <Ref>{papelAtual ?? "super_admin"}</Ref>. A tentativa de consulta ficou
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
          processoId={processo.id}
          seccoes={s}
          podeEditar={podeEditar}
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
          processoId={processo.id}
          seccoes={s}
          podeEditar={podeEditar}
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
          processoId={processo.id}
          seccoes={s}
          podeEditar={podeEditar}
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
          <PropostaComercial
            processoId={processo.id}
            atual={
              proposta ? { id: proposta.id, nome: proposta.nome, bytes: proposta.bytes } : null
            }
          />

          <p className="mt-3 text-xs text-muted-foreground">
            O download no painel vem da base de dados, com sessão exigida, e fica registado na
            auditoria.
          </p>
        </CardContent>
      </Card>

      {/* ── emails ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-baseline gap-x-3 text-base">
            Emails
            {/* Um dossier sem link é um cliente à espera, e é esta contagem que
                o anuncia sem obrigar a ler a lista linha a linha. */}
            {naoChegaram > 0 && (
              <span className="text-selo text-xs font-normal">
                {naoChegaram === 1 ? "1 não chegou" : `${naoChegaram} não chegaram`}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {emails.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ainda não saiu nenhuma mensagem no âmbito deste processo.
            </p>
          ) : (
            <ul className="border-linha divide-linha divide-y border-t">
              {emails.map((m) => (
                <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{m.assunto}</p>
                    <p className="text-xs text-muted-foreground">
                      <Ref>{m.para}</Ref> · {ROTULOS_TEMPLATE[m.template] ?? m.template}
                      {m.canal && ` · ${ROTULOS_CANAL[m.canal]}`}
                    </p>
                    {/* O motivo por baixo do assunto que o causou: um estado a
                        carmim sem a razão manda quem lê para os registos do
                        contentor à procura do que a linha já sabe. */}
                    {m.erro && <p className="text-selo text-xs">{m.erro}</p>}
                  </div>
                  <span
                    className={`text-2xs shrink-0 rounded-xs border px-2 py-0.5 ${
                      TOM_ESTADO[m.estado] ?? "border-linha bg-papel text-muted-foreground"
                    }`}
                  >
                    {ROTULOS_ESTADO[m.estado]}
                  </span>
                  <Ref className="shrink-0 text-xs text-muted-foreground">{dtm(m.criadoEm)}</Ref>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            {/* A mesma distinção do `/emails`, repetida aqui porque é aqui que
                ela decide se alguém vai atrás de um cliente que não recebeu
                nada — e a D50 nasceu precisamente de as duas se confundirem. */}
            <strong className="font-medium">Aceite</strong> quer dizer que o fornecedor ficou com
            a mensagem; <strong className="font-medium">Entregue</strong> quer dizer que o
            servidor do destinatário a aceitou.
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
