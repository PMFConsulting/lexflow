"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { guardarPasso, submeter } from "../acoes";
import { CHAVE_CARIMBO } from "./Lombada";
import { PASSOS, passoAnterior } from "../passos";
import type { Seccoes } from "../dados";
import { Assinatura } from "./Assinatura";
import {
  CampoCaixa,
  CampoEscolha,
  CampoLista,
  CampoLongo,
  CampoSimNao,
  CampoTexto,
} from "./Campo";

type Erros = Record<string, string[]>;

const PAISES = [
  { valor: "PT", texto: "Portugal" },
  { valor: "ES", texto: "Espanha" },
  { valor: "FR", texto: "França" },
  { valor: "GB", texto: "Reino Unido" },
  { valor: "DE", texto: "Alemanha" },
  { valor: "BR", texto: "Brasil" },
  { valor: "AO", texto: "Angola" },
  { valor: "MZ", texto: "Moçambique" },
  { valor: "CV", texto: "Cabo Verde" },
  { valor: "US", texto: "Estados Unidos" },
];

const DOCUMENTOS = [
  { valor: "cartao_cidadao", texto: "Cartão de Cidadão" },
  { valor: "passaporte", texto: "Passaporte" },
  { valor: "titulo_residencia", texto: "Título de residência" },
  { valor: "outro", texto: "Outro" },
];

// Valores vistos nos screenshots. A lista completa está por confirmar (A21).
const AREAS = [
  { valor: "administrativo", texto: "Administrativo e Contratação Pública" },
  { valor: "penal", texto: "Penal e Contraordenacional" },
  { valor: "pi_privacidade", texto: "Propriedade Intelectual e Privacidade" },
  { valor: "comercial", texto: "Comercial e Contratos" },
  { valor: "laboral", texto: "Laboral" },
];

const bool = (fd: FormData, k: string) => fd.get(k) === "true";
const txt = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const lista = (fd: FormData, k: string) => fd.getAll(k).map(String).filter(Boolean);

function carga(n: number, fd: FormData): unknown {
  const morada = {
    morada: txt(fd, "morada"),
    pais: txt(fd, "pais"),
    localidade: txt(fd, "localidade"),
    codigoPostal: txt(fd, "codigoPostal"),
    freguesia: txt(fd, "freguesia"),
    concelho: txt(fd, "concelho"),
    distrito: txt(fd, "distrito"),
  };

  switch (n) {
    case 1:
      return {
        tipoCliente: txt(fd, "tipoCliente"),
        nome: txt(fd, "nome"),
        profissao: txt(fd, "profissao") || undefined,
        entidadePatronal: txt(fd, "entidadePatronal") || undefined,
        dataNascimento: txt(fd, "dataNascimento") || undefined,
        naturezaJuridica: txt(fd, "naturezaJuridica") || undefined,
        dataConstituicao: txt(fd, "dataConstituicao") || undefined,
        nacionalidades: lista(fd, "nacionalidades"),
        telefone: txt(fd, "telefone"),
        email: txt(fd, "email"),
        ...morada,
        representadoPorProcurador: bool(fd, "representadoPorProcurador"),
      };
    case 2:
      return {
        nifPortugues: bool(fd, "nifPortugues"),
        resideEmPortugal: bool(fd, "resideEmPortugal"),
        nif: txt(fd, "nif"),
        docTipo: txt(fd, "docTipo"),
        docNumero: txt(fd, "docNumero"),
        docValidade: txt(fd, "docValidade"),
        cae: txt(fd, "cae") || undefined,
        codigoCertidaoPermanente: txt(fd, "codigoCertidaoPermanente") || undefined,
        regimeIva: txt(fd, "regimeIva") || undefined,
      };
    case 3:
      return {
        eRepresentante: bool(fd, "eRepresentante"),
        relacao: txt(fd, "relacao") || undefined,
        nome: txt(fd, "nome") || undefined,
        dataNascimento: txt(fd, "dataNascimento") || undefined,
        profissao: txt(fd, "profissao") || undefined,
        telefone: txt(fd, "telefone") || undefined,
        email: txt(fd, "email") || undefined,
        ...morada,
        nif: txt(fd, "nif") || undefined,
        docTipo: txt(fd, "docTipo") || undefined,
        docNumero: txt(fd, "docNumero") || undefined,
        docValidade: txt(fd, "docValidade") || undefined,
        codigoRcbe: txt(fd, "codigoRcbe") || undefined,
        ambitoPoderes: txt(fd, "ambitoPoderes") || undefined,
      };
    case 4:
      return {
        ePpe: bool(fd, "ePpe"),
        ppeCargo: txt(fd, "ppeCargo") || undefined,
        ppePais: txt(fd, "ppePais") || undefined,
        ppeEntidade: txt(fd, "ppeEntidade") || undefined,
        ppeInicio: txt(fd, "ppeInicio") || undefined,
        ppeFim: txt(fd, "ppeFim") || undefined,
        eRelacionadoPpe: bool(fd, "eRelacionadoPpe"),
        relacaoPpe: txt(fd, "relacaoPpe") || undefined,
        ppeRelacionadaNome: txt(fd, "ppeRelacionadaNome") || undefined,
        ppeRelacionadaCargo: txt(fd, "ppeRelacionadaCargo") || undefined,
        ppeRelacionadaPais: txt(fd, "ppeRelacionadaPais") || undefined,
        servicos: txt(fd, "servicos"),
        origemFundos: txt(fd, "origemFundos"),
      };
    case 5:
      return {
        origemContacto: txt(fd, "origemContacto") || undefined,
        origemDetalhe: txt(fd, "origemDetalhe") || undefined,
        newsletter: bool(fd, "newsletter"),
        emailsNewsletter: lista(fd, "emailsNewsletter"),
        areasInteresse: lista(fd, "areasInteresse"),
        convitesIniciativas: bool(fd, "convitesIniciativas"),
        convitesNome: txt(fd, "convitesNome") || undefined,
        convitesEmail: txt(fd, "convitesEmail") || undefined,
      };
    case 6:
      return {
        igualAoCliente: bool(fd, "igualAoCliente"),
        nome: txt(fd, "nome"),
        nif: txt(fd, "nif"),
        ...morada,
        email: txt(fd, "email"),
        acIgualAoCliente: bool(fd, "acIgualAoCliente"),
        acNome: txt(fd, "acNome") || undefined,
        acEmail: txt(fd, "acEmail") || undefined,
        acTelefone: txt(fd, "acTelefone") || undefined,
        iban: txt(fd, "iban") || undefined,
      };
    case 7:
      return {
        declaracaoVeracidade: bool(fd, "declaracaoVeracidade"),
        assinatura: txt(fd, "assinatura"),
      };
    default:
      return {};
  }
}

export function Formulario({
  token,
  n,
  seccoes,
  tipoCliente,
  representadoPorProcurador,
}: {
  token: string;
  n: number;
  seccoes: Seccoes;
  tipoCliente: "particular" | "empresa";
  representadoPorProcurador: boolean;
}) {
  const router = useRouter();
  const [erros, setErros] = useState<Erros>({});
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [aGuardar, transicao] = useTransition();

  // estado local para os campos que fazem aparecer outros
  const [tipo, setTipo] = useState(tipoCliente);
  const [ePpe, setEPpe] = useState(seccoes.ppe?.ePpe ?? null);
  const [relPpe, setRelPpe] = useState(seccoes.ppe?.eRelacionadoPpe ?? null);
  const [eRep, setERep] = useState(seccoes.representante?.eRepresentante ?? false);
  const [newsletter, setNewsletter] = useState(seccoes.preferencias?.newsletter ?? false);
  const [convites, setConvites] = useState(seccoes.preferencias?.convitesIniciativas ?? false);
  const [nifPt, setNifPt] = useState(seccoes.fiscais?.nifPortugues ?? true);

  const anterior = passoAnterior(n, { tipoCliente: tipo, representadoPorProcurador });
  const passo = PASSOS.find((p) => p.n === n)!;

  /**
   * `onSubmit` com `preventDefault`, e não `action={}`.
   *
   * O React 19 faz reset ao formulário depois de correr uma Server Action
   * passada em `action`. Num formulário destes, um dígito errado no NIF
   * apagava os outros dezanove campos. Assim o DOM fica intacto e o cliente
   * corrige só o que está errado.
   */
  const enviar = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    setMensagem(null);
    transicao(async () => {
      // No passo 7 são dois momentos: gravar a declaração e só depois submeter.
      // O `submeter` lê a declaração da base de dados — se não a gravarmos
      // primeiro, o cliente fica preso num erro que não consegue resolver.
      let r = await guardarPasso(token, n, carga(n, fd));
      if (r.ok && n === 7 && fd.get("_acao") === "submeter") {
        r = await submeter(token);
      }

      if (!r.ok) {
        setErros(r.erros);
        setMensagem(r.mensagem ?? null);
        // leva o foco para o primeiro erro em vez de o deixar perdido
        const primeiro = Object.keys(r.erros)[0];
        if (primeiro) {
          document
            .querySelector<HTMLElement>(`[name="${primeiro}"]`)
            ?.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        return;
      }

      setErros({});
      // Deixa dito à lombada qual o passo a carimbar quando a página seguinte
      // montar. É por isto que o carimbo aparece já com o passo dado.
      sessionStorage.setItem(CHAVE_CARIMBO, String(n));

      if (n === 7) {
        router.push(`/onboarding/${token}/submetido`);
      } else if (r.proximo) {
        router.push(`/onboarding/${token}/passo/${r.proximo}`);
      } else {
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={enviar} className="flex flex-col gap-6">
      <header>
        <p className="text-2xs font-mono tracking-[0.16em] text-muted-foreground uppercase">
          Passo {String(n).padStart(2, "0")} de 07
        </p>
        <h1 className="mt-1 text-2xl">{passo.titulo}</h1>
      </header>

      <Separator />

      {mensagem && (
        <p className="border-selo/40 bg-selo/10 text-selo rounded-sm border p-3 text-sm" role="alert">
          {mensagem}
        </p>
      )}

      {/* Resumo dos erros. Num formulário longo, ver "3 campos por corrigir" e
          poder saltar para cada um poupa a rolagem às cegas à procura do vermelho. */}
      {Object.keys(erros).length > 0 && (
        <div
          className="border-selo/40 bg-selo/5 rounded-sm border p-3"
          role="alert"
          aria-labelledby="resumo-erros"
        >
          <p id="resumo-erros" className="text-selo text-sm font-medium">
            {Object.keys(erros).length === 1
              ? "Falta corrigir um campo"
              : `Faltam corrigir ${Object.keys(erros).length} campos`}
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {Object.entries(erros).map(([campo, msgs]) => (
              <li key={campo}>
                <button
                  type="button"
                  onClick={() => {
                    const alvo = document.querySelector<HTMLElement>(`[name="${campo}"]`);
                    alvo?.scrollIntoView({ block: "center", behavior: "smooth" });
                    alvo?.focus();
                  }}
                  className="text-selo/90 hover:text-selo text-left text-xs underline underline-offset-2"
                >
                  {msgs[0]}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {n === 1 && (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Quem é o cliente final?</legend>
            <input type="hidden" name="tipoCliente" value={tipo} />
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { v: "particular", t: "Pessoa Singular", d: "Cliente individual ou particular" },
                { v: "empresa", t: "Empresa / Entidade Coletiva", d: "Sociedade comercial ou outra pessoa coletiva" },
              ].map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setTipo(o.v as "particular" | "empresa")}
                  aria-pressed={tipo === o.v}
                  className={
                    "border-linha bg-papel-alto rounded-sm border p-3 text-left transition-colors " +
                    (tipo === o.v ? "border-tinta ring-tinta ring-1" : "hover:border-tinta-suave")
                  }
                >
                  <span className="block text-sm font-medium">{o.t}</span>
                  <span className="block text-xs text-muted-foreground">{o.d}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <CampoTexto
              etiqueta={tipo === "empresa" ? "Denominação social" : "Nome completo"}
              nome="nome"
              erros={erros}
              obrigatorio
              valorInicial={seccoes.identificacao?.nome ?? ""}
              className="sm:col-span-2"
            />

            {tipo === "particular" ? (
              <>
                <CampoTexto etiqueta="Profissão" nome="profissao" erros={erros} obrigatorio valorInicial={seccoes.identificacao?.profissao ?? ""} />
                <CampoTexto etiqueta="Entidade patronal" nome="entidadePatronal" erros={erros} obrigatorio ajuda="Caso não se aplique, preencha com N/A." valorInicial={seccoes.identificacao?.entidadePatronal ?? ""} />
                <CampoTexto etiqueta="Data de nascimento" nome="dataNascimento" tipo="date" erros={erros} obrigatorio valorInicial={seccoes.identificacao?.dataNascimento ?? ""} />
              </>
            ) : (
              <>
                <CampoTexto etiqueta="Natureza jurídica" nome="naturezaJuridica" erros={erros} valorInicial={seccoes.identificacao?.naturezaJuridica ?? ""} />
                <CampoTexto etiqueta="Data de constituição" nome="dataConstituicao" tipo="date" erros={erros} valorInicial={seccoes.identificacao?.dataConstituicao ?? ""} />
              </>
            )}

            <CampoLista etiqueta="Nacionalidade(s)" nome="nacionalidades" erros={erros} obrigatorio sugestoes={PAISES} valorInicial={seccoes.nacionalidades} className="sm:col-span-2" />
            <CampoTexto etiqueta="Contacto telefónico" nome="telefone" erros={erros} obrigatorio ajuda="Com indicativo — por exemplo +351 912 345 678." valorInicial={seccoes.identificacao?.telefone ?? ""} />
            <CampoTexto etiqueta="Email" nome="email" tipo="email" erros={erros} obrigatorio valorInicial={seccoes.identificacao?.email ?? ""} />
          </div>

          <Separator />
          <h2 className="text-lg">Morada</h2>
          <BlocoMorada erros={erros} v={seccoes.identificacao} />

          <CampoCaixa
            etiqueta="Sou representado por procurador"
            nome="representadoPorProcurador"
            valorInicial={representadoPorProcurador}
          />
        </>
      )}

      {n === 2 && (
        <>
          <div className="flex flex-wrap gap-6">
            <CampoCaixa etiqueta="Número de contribuinte português?" nome="nifPortugues" valorInicial={nifPt} onChange={setNifPt} />
            <CampoCaixa etiqueta="Reside em Portugal?" nome="resideEmPortugal" valorInicial={seccoes.fiscais?.resideEmPortugal ?? true} />
          </div>

          <CampoTexto etiqueta="Número de contribuinte" nome="nif" erros={erros} obrigatorio mono ajuda={nifPt ? "Nove dígitos, validado por checksum." : "Número de identificação fiscal do país de residência."} valorInicial={seccoes.fiscais?.nif ?? ""} />

          <p className="border-linha bg-muted rounded-sm border p-3 text-sm text-muted-foreground">
            Anexe um documento comprovativo do seu Número de Identificação Fiscal,
            obtido no portal da Autoridade Tributária, com data de emissão dos
            últimos 6 meses.
          </p>

          <Separator />
          <h2 className="text-lg">Documento de identificação</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <CampoEscolha etiqueta="Tipo de documento" nome="docTipo" erros={erros} obrigatorio opcoes={DOCUMENTOS} valorInicial={seccoes.fiscais?.docTipo ?? ""} />
            <CampoTexto etiqueta="Número do documento" nome="docNumero" erros={erros} obrigatorio mono valorInicial={seccoes.fiscais?.docNumero ?? ""} />
            <CampoTexto etiqueta="Data de validade" nome="docValidade" tipo="date" erros={erros} obrigatorio valorInicial={seccoes.fiscais?.docValidade ?? ""} />
          </div>

          {tipo === "empresa" && (
            <>
              <Separator />
              <h2 className="text-lg">Dados da entidade</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <CampoTexto etiqueta="CAE" nome="cae" erros={erros} mono valorInicial={seccoes.fiscais?.cae ?? ""} />
                <CampoTexto etiqueta="Código da certidão permanente" nome="codigoCertidaoPermanente" erros={erros} mono valorInicial={seccoes.fiscais?.codigoCertidaoPermanente ?? ""} />
                <CampoEscolha etiqueta="Regime de IVA" nome="regimeIva" erros={erros} opcoes={[{ valor: "normal", texto: "Normal" }, { valor: "isento_art53", texto: "Isento — art. 53.º" }, { valor: "isento_art9", texto: "Isento — art. 9.º" }, { valor: "misto", texto: "Misto" }]} valorInicial={seccoes.fiscais?.regimeIva ?? ""} />
              </div>
            </>
          )}
        </>
      )}

      {n === 3 && (
        <>
          <CampoCaixa etiqueta="É representante?" nome="eRepresentante" valorInicial={eRep} onChange={setERep} />

          {eRep && (
            <>
              <Separator />
              <div className="grid gap-4 sm:grid-cols-2">
                <CampoTexto etiqueta="Relação com o cliente final" nome="relacao" erros={erros} valorInicial={seccoes.representante?.relacao ?? ""} className="sm:col-span-2" />
                <CampoTexto etiqueta="Nome completo" nome="nome" erros={erros} obrigatorio valorInicial={seccoes.representante?.nome ?? ""} className="sm:col-span-2" />
                <CampoTexto etiqueta="Data de nascimento" nome="dataNascimento" tipo="date" erros={erros} valorInicial={seccoes.representante?.dataNascimento ?? ""} />
                <CampoTexto etiqueta="Profissão" nome="profissao" erros={erros} valorInicial={seccoes.representante?.profissao ?? ""} />
                <CampoTexto etiqueta="Contacto telefónico" nome="telefone" erros={erros} obrigatorio valorInicial={seccoes.representante?.telefone ?? ""} />
                <CampoTexto etiqueta="Email" nome="email" tipo="email" erros={erros} obrigatorio valorInicial={seccoes.representante?.email ?? ""} />
              </div>

              <Separator />
              <h2 className="text-lg">Morada do representante</h2>
              <BlocoMorada erros={erros} v={seccoes.representante} />

              <Separator />
              <h2 className="text-lg">Identificação fiscal do representante</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <CampoTexto etiqueta="Número de contribuinte" nome="nif" erros={erros} obrigatorio mono valorInicial={seccoes.representante?.nif ?? ""} />
                <CampoEscolha etiqueta="Tipo de documento" nome="docTipo" erros={erros} opcoes={DOCUMENTOS} valorInicial={seccoes.representante?.docTipo ?? ""} />
                <CampoTexto etiqueta="Número do documento" nome="docNumero" erros={erros} obrigatorio mono valorInicial={seccoes.representante?.docNumero ?? ""} />
                <CampoTexto etiqueta="Data de validade" nome="docValidade" tipo="date" erros={erros} obrigatorio valorInicial={seccoes.representante?.docValidade ?? ""} />
              </div>

              {tipo === "empresa" && (
                <>
                  <Separator />
                  <div className="grid gap-4">
                    <CampoTexto etiqueta="Código de acesso ao RCBE" nome="codigoRcbe" erros={erros} mono valorInicial={seccoes.representante?.codigoRcbe ?? ""} />
                    <CampoLongo etiqueta="Âmbito dos poderes de representação" nome="ambitoPoderes" erros={erros} valorInicial={seccoes.representante?.ambitoPoderes ?? ""} />
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {n === 4 && (
        <>
          <h2 className="text-lg">Declaração de Pessoa Politicamente Exposta</h2>

          <CampoSimNao
            pergunta="Ocupa ou ocupou nos últimos 12 meses algum cargo público ou político, em Portugal ou no estrangeiro?"
            nome="ePpe"
            erros={erros}
            valorInicial={ePpe}
            onChange={setEPpe}
          />

          {ePpe === true && (
            <div className="border-latao/40 bg-latao/5 grid gap-4 rounded-sm border p-4 sm:grid-cols-2">
              <CampoTexto etiqueta="Cargo" nome="ppeCargo" erros={erros} obrigatorio valorInicial={seccoes.ppe?.ppeCargo ?? ""} />
              <CampoEscolha etiqueta="País" nome="ppePais" erros={erros} obrigatorio opcoes={PAISES} valorInicial={seccoes.ppe?.ppePais ?? ""} />
              <CampoTexto etiqueta="Entidade" nome="ppeEntidade" erros={erros} obrigatorio valorInicial={seccoes.ppe?.ppeEntidade ?? ""} className="sm:col-span-2" />
              <CampoTexto etiqueta="Início do exercício" nome="ppeInicio" tipo="date" erros={erros} obrigatorio valorInicial={seccoes.ppe?.ppeInicio ?? ""} />
              <CampoTexto etiqueta="Fim do exercício" nome="ppeFim" tipo="date" erros={erros} ajuda="Deixe vazio se ainda estiver em exercício." valorInicial={seccoes.ppe?.ppeFim ?? ""} />
            </div>
          )}

          <CampoSimNao
            pergunta="É membro próximo da família ou é reconhecido como estreitamente associado com alguma pessoa considerada PPE?"
            nome="eRelacionadoPpe"
            erros={erros}
            valorInicial={relPpe}
            onChange={setRelPpe}
          />

          {relPpe === true && (
            <div className="border-latao/40 bg-latao/5 grid gap-4 rounded-sm border p-4 sm:grid-cols-2">
              <CampoTexto etiqueta="Relação" nome="relacaoPpe" erros={erros} obrigatorio valorInicial={seccoes.ppe?.relacaoPpe ?? ""} />
              <CampoTexto etiqueta="Nome da pessoa" nome="ppeRelacionadaNome" erros={erros} obrigatorio valorInicial={seccoes.ppe?.ppeRelacionadaNome ?? ""} />
              <CampoTexto etiqueta="Cargo" nome="ppeRelacionadaCargo" erros={erros} valorInicial={seccoes.ppe?.ppeRelacionadaCargo ?? ""} />
              <CampoEscolha etiqueta="País" nome="ppeRelacionadaPais" erros={erros} opcoes={PAISES} valorInicial={seccoes.ppe?.ppeRelacionadaPais ?? ""} />
            </div>
          )}

          <Separator />
          <h2 className="text-lg">Relação de Negócio</h2>
          <CampoLongo etiqueta="Serviço(s) jurídico(s) que lhe vamos prestar" nome="servicos" erros={erros} obrigatorio ajuda="Ex: Assessoria Jurídica Global / Avença / Alterações Societárias / Constituição de Sociedade / Questões Tributárias / Recuperação de Crédito / Questões Laborais." valorInicial={seccoes.negocio?.servicos ?? ""} />
          <CampoLongo etiqueta="Origem dos fundos" nome="origemFundos" erros={erros} obrigatorio ajuda="Ex: Rendimentos empresariais da própria empresa / Financiamento Bancário / Donativos / Quotas." valorInicial={seccoes.negocio?.origemFundos ?? ""} />
        </>
      )}

      {n === 5 && (
        <>
          <CampoEscolha
            etiqueta="Como chegou até nós?"
            nome="origemContacto"
            erros={erros}
            opcoes={[
              { valor: "recomendacao", texto: "Recomendação" },
              { valor: "pesquisa_online", texto: "Pesquisa Online" },
              { valor: "evento_conferencia", texto: "Evento / Conferência" },
              { valor: "outro", texto: "Outro" },
            ]}
            valorInicial={seccoes.preferencias?.origemContacto ?? ""}
          />
          <CampoTexto etiqueta="Quem?" nome="origemDetalhe" erros={erros} valorInicial={seccoes.preferencias?.origemDetalhe ?? ""} />

          <Separator />
          <CampoCaixa etiqueta="Quero subscrever a newsletter" nome="newsletter" valorInicial={newsletter} onChange={setNewsletter} />

          {newsletter && (
            <div className="grid gap-4">
              <CampoLista etiqueta="Emails para receber novidades" nome="emailsNewsletter" erros={erros} obrigatorio placeholder="nome@empresa.pt" valorInicial={seccoes.emailsNewsletter} />
              <CampoLista etiqueta="Áreas de interesse" nome="areasInteresse" erros={erros} sugestoes={AREAS} valorInicial={seccoes.areasInteresse} />
            </div>
          )}

          <Separator />
          <CampoCaixa etiqueta="Desejo receber convites para iniciativas (formações, webinars, workshops)" nome="convitesIniciativas" valorInicial={convites} onChange={setConvites} />

          {convites && (
            <div className="grid gap-4 sm:grid-cols-2">
              <CampoTexto etiqueta="Nome" nome="convitesNome" erros={erros} obrigatorio valorInicial={seccoes.preferencias?.convitesNome ?? ""} />
              <CampoTexto etiqueta="Email" nome="convitesEmail" tipo="email" erros={erros} obrigatorio valorInicial={seccoes.preferencias?.convitesEmail ?? ""} />
            </div>
          )}
        </>
      )}

      {n === 6 && (
        <>
          <CampoCaixa etiqueta="Os dados de faturação são os mesmos do cliente" nome="igualAoCliente" valorInicial={seccoes.faturacao?.igualAoCliente ?? false} />

          <div className="grid gap-4 sm:grid-cols-2">
            <CampoTexto etiqueta="Nome ou empresa" nome="nome" erros={erros} obrigatorio valorInicial={seccoes.faturacao?.nome ?? ""} className="sm:col-span-2" />
            <CampoTexto etiqueta="NIF / NIPC" nome="nif" erros={erros} obrigatorio mono valorInicial={seccoes.faturacao?.nif ?? ""} />
            <CampoTexto etiqueta="Email para faturas" nome="email" tipo="email" erros={erros} obrigatorio valorInicial={seccoes.faturacao?.email ?? ""} />
          </div>

          <Separator />
          <h2 className="text-lg">Morada de faturação</h2>
          <BlocoMorada erros={erros} v={seccoes.faturacao} />

          <Separator />
          <h2 className="text-lg">Ao cuidado de</h2>
          <CampoCaixa etiqueta="Os dados ao cuidado de são os mesmos do cliente" nome="acIgualAoCliente" valorInicial={seccoes.faturacao?.acIgualAoCliente ?? false} />
          <div className="grid gap-4 sm:grid-cols-3">
            <CampoTexto etiqueta="Nome" nome="acNome" erros={erros} valorInicial={seccoes.faturacao?.acNome ?? ""} />
            <CampoTexto etiqueta="Email" nome="acEmail" tipo="email" erros={erros} valorInicial={seccoes.faturacao?.acEmail ?? ""} />
            <CampoTexto etiqueta="Contacto telefónico" nome="acTelefone" erros={erros} valorInicial={seccoes.faturacao?.acTelefone ?? ""} />
          </div>
        </>
      )}

      {n === 7 && (
        <>
          <Revisao token={token} seccoes={seccoes} tipoCliente={tipo} />

          <div className="border-linha bg-papel-alto flex flex-col gap-4 rounded-sm border p-4">
            <h2 className="text-lg">Declaração Final</h2>
            <CampoCaixa
              etiqueta="Declaro que as informações prestadas são verdadeiras e assumo a responsabilidade pela sua atualização caso se verifiquem alterações."
              nome="declaracaoVeracidade"
              erros={erros}
              valorInicial={seccoes.fecho?.declaracaoVeracidade ?? false}
            />
            <Assinatura nome="assinatura" erros={erros} />
          </div>
          <p className="text-xs text-muted-foreground">
            Depois de submeter, o processo passa a revisão e deixa de ser editável.
          </p>
          <input type="hidden" name="_acao" value="submeter" />
        </>
      )}

      <Separator className="hidden md:block" />

      {/* No telemóvel a barra cola-se ao fundo: com formulários deste tamanho,
          obrigar a rolar até ao fim para carregar em continuar é castigo. Em
          ecrã largo volta a ser uma linha normal no fluxo. */}
      <div
        className={
          "border-linha bg-papel/95 sticky bottom-0 -mx-4 flex flex-wrap items-center " +
          "justify-between gap-3 border-t px-4 py-3 backdrop-blur " +
          "md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none"
        }
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {anterior ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="md:h-9"
            onClick={() => router.push(`/onboarding/${token}/passo/${anterior}`)}
          >
            <ArrowLeft className="size-4" />
            Voltar
          </Button>
        ) : (
          <span />
        )}

        <Button type="submit" disabled={aGuardar} size="lg" className="md:h-9">
          {aGuardar ? "A guardar…" : n === 7 ? "Submeter" : "Guardar e continuar"}
          {n === 7 ? <Check className="size-4" /> : <ArrowRight className="size-4" />}
        </Button>
      </div>
    </form>
  );
}

/**
 * Revisão antes de submeter.
 *
 * Pedir uma declaração de veracidade sem mostrar o que se está a declarar não
 * é razoável — e num processo de KYC é o oposto do que se pretende. Cada
 * secção tem link para voltar atrás e corrigir.
 */
function Revisao({
  token,
  seccoes,
  tipoCliente,
}: {
  token: string;
  seccoes: Seccoes;
  tipoCliente: "particular" | "empresa";
}) {
  const s = seccoes;

  const blocos: { passo: number; titulo: string; linhas: [string, string | null | undefined][] }[] =
    [
      {
        passo: 1,
        titulo: "Identificação",
        linhas: [
          [tipoCliente === "empresa" ? "Denominação" : "Nome", s.identificacao?.nome],
          ["Profissão", s.identificacao?.profissao],
          ["Nacionalidade(s)", s.nacionalidades.join(", ") || null],
          ["Email", s.identificacao?.email],
          ["Telefone", s.identificacao?.telefone],
          [
            "Morada",
            s.identificacao
              ? `${s.identificacao.morada}, ${s.identificacao.codigoPostal} ${s.identificacao.localidade}`
              : null,
          ],
        ],
      },
      {
        passo: 2,
        titulo: "Fiscal",
        linhas: [
          ["NIF", s.fiscais?.nif],
          ["Documento", s.fiscais?.docNumero],
          ["Validade", s.fiscais?.docValidade],
        ],
      },
      ...(s.representante?.eRepresentante
        ? [
            {
              passo: 3,
              titulo: "Representante",
              linhas: [
                ["Nome", s.representante.nome],
                ["NIF", s.representante.nif],
                ["Email", s.representante.email],
              ] as [string, string | null | undefined][],
            },
          ]
        : []),
      {
        passo: 4,
        titulo: "PPE e relação de negócio",
        linhas: [
          ["Pessoa politicamente exposta", s.ppe ? (s.ppe.ePpe ? "Sim" : "Não") : null],
          ...(s.ppe?.ePpe
            ? ([
                ["Cargo", s.ppe.ppeCargo],
                ["Entidade", s.ppe.ppeEntidade],
              ] as [string, string | null | undefined][])
            : []),
          ["Serviços", s.negocio?.servicos],
          ["Origem dos fundos", s.negocio?.origemFundos],
        ],
      },
      {
        passo: 6,
        titulo: "Faturação",
        linhas: [
          ["Nome", s.faturacao?.nome],
          ["NIF", s.faturacao?.nif],
          ["Email", s.faturacao?.email],
        ],
      },
    ];

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg">O que vai submeter</h2>

      {blocos.map((b) => {
        const linhas = b.linhas.filter(([, v]) => v);
        if (!linhas.length) return null;
        return (
          <div key={b.passo} className="border-linha bg-papel-alto rounded-sm border">
            <div className="border-linha flex items-center justify-between gap-2 border-b px-4 py-2">
              <h3 className="text-2xs font-mono tracking-[0.14em] text-muted-foreground uppercase">
                {String(b.passo).padStart(2, "0")} · {b.titulo}
              </h3>
              <Link
                href={`/onboarding/${token}/passo/${b.passo}`}
                className="text-xs underline underline-offset-2 hover:text-selo"
              >
                Corrigir
              </Link>
            </div>
            <dl className="grid gap-x-6 gap-y-1.5 px-4 py-3 text-sm sm:grid-cols-[minmax(0,14rem)_1fr]">
              {linhas.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="break-words">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </section>
  );
}

function BlocoMorada({
  erros,
  v,
}: {
  erros: Erros;
  v: {
    morada?: string | null;
    pais?: string | null;
    localidade?: string | null;
    codigoPostal?: string | null;
    freguesia?: string | null;
    concelho?: string | null;
    distrito?: string | null;
  } | null;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <CampoTexto etiqueta="Morada" nome="morada" erros={erros} obrigatorio valorInicial={v?.morada ?? ""} className="sm:col-span-2" />
      <CampoEscolha etiqueta="País" nome="pais" erros={erros} obrigatorio opcoes={PAISES} valorInicial={v?.pais ?? "PT"} />
      <CampoTexto etiqueta="Código postal" nome="codigoPostal" erros={erros} obrigatorio mono ajuda="Formato 0000-000." valorInicial={v?.codigoPostal ?? ""} />
      <CampoTexto etiqueta="Localidade" nome="localidade" erros={erros} obrigatorio valorInicial={v?.localidade ?? ""} />
      <CampoTexto etiqueta="Freguesia" nome="freguesia" erros={erros} obrigatorio valorInicial={v?.freguesia ?? ""} />
      <CampoTexto etiqueta="Concelho" nome="concelho" erros={erros} obrigatorio valorInicial={v?.concelho ?? ""} />
      <CampoTexto etiqueta="Distrito" nome="distrito" erros={erros} obrigatorio valorInicial={v?.distrito ?? ""} />
    </div>
  );
}
