"use client";

import Link from "next/link";
import { unstable_rethrow, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, Check, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { guardarPasso, submeter, type EstadoOtp, type Resultado } from "../acoes";
import { CHAVE_CARIMBO } from "./Lombada";
import { alvoDoErro } from "@/components/formulario-erros";
import { DOCUMENTOS_ID, PAISES } from "./paises";
import type { TermosParaLer } from "@/components/leitor-termos";
import {
  PASSOS,
  passoAnterior,
  passoAplicavel,
  passosDoProcesso,
  ultimoPasso,
} from "../passos";
import type { Seccoes } from "../dados";
import { ANEXOS_OBRIGATORIOS } from "../schemas";
import { Anexos } from "./Anexos";
import { Assinatura } from "./Assinatura";
import { CodigoOtp } from "./CodigoOtp";
import { LeitorTermos } from "./LeitorTermos";
import { LeitorProposta } from "./LeitorProposta";
import { Ref } from "@/components/ref-processo";
import {
  CampoCaixa,
  CampoCaixas,
  CampoEscolha,
  CampoLista,
  CampoLongo,
  CampoRadio,
  CampoSimNao,
  CampoTexto,
} from "./Campo";

type Erros = Record<string, string[]>;

// `PAISES` e `DOCUMENTOS_ID` mudaram-se para `./paises`: o registo da sociedade
// pede a morada da sede pelo mesmo campo, e duas listas de países é como se tem
// um país escolhível num formulário e não no outro.
const DOCUMENTOS = DOCUMENTOS_ID;

const ORIGEM_CONTACTO = [
  { valor: "evento_conferencia", texto: "Evento / Conferência" },
  { valor: "recomendacao", texto: "Recomendação de cliente anterior" },
  { valor: "pesquisa_online", texto: "Pesquisa Online" },
  { valor: "outro", texto: "Outro" },
];

/**
 * As sugestões das duas caixas do passo 4, tal como vinham na linha de ajuda do
 * formulário em papel. Passaram a botões: eram exemplos que ninguém lia.
 */
const SUGESTOES_SERVICOS = [
  "Assessoria Jurídica Global",
  "Avença",
  "Alterações Societárias",
  "Constituição de Sociedade",
  "Questões Tributárias",
  "Recuperação de Crédito",
  "Questões Laborais",
];

const SUGESTOES_ORIGEM_FUNDOS = [
  "Rendimentos empresariais da própria empresa",
  "Rendimentos do trabalho",
  "Financiamento Bancário",
  "Donativos",
  "Quotas",
  "Poupanças",
];

const AREAS_INTERESSE = [
  { valor: "Administrativo e Contratação Pública", texto: "Administrativo e Contratação Pública" },
  { valor: "Penal e Contraordenacional", texto: "Penal e Contraordenacional" },
  { valor: "Comercial e Contratos", texto: "Comercial e Contratos" },
  { valor: "Laboral", texto: "Laboral" },
  { valor: "Propriedade Intelectual e Privacidade", texto: "Propriedade Intelectual e Privacidade" },
];

const bool = (fd: FormData, k: string) => fd.get(k) === "true";
const txt = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const lista = (fd: FormData, k: string) => fd.getAll(k).map(String).filter(Boolean);

/**
 * Sim/Não que ainda não foi respondido é `undefined`, não `false`.
 *
 * O `CampoSimNao` sem resposta manda uma string vazia, e o `bool` acima
 * lê-a como `false` — "não respondeu" e "respondeu Não" chegavam ao servidor
 * indistinguíveis. Numa declaração isso não é um default benigno: é gravar uma
 * resposta que o cliente nunca deu. Os schemas destas perguntas pedem um
 * `z.boolean()` sem `.default()` precisamente para a exigirem; era esta
 * conversão que lhes tirava a hipótese de o fazer.
 *
 * Não se aplica aos consentimentos do passo 6, que têm `.default(false)` de
 * propósito: aí a ausência de resposta *é* a resposta, e é a que o RGPD manda
 * assumir.
 */
const simNao = (fd: FormData, k: string) => (fd.get(k) ? bool(fd, k) : undefined);

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
        eRepresentante: simNao(fd, "eRepresentante"),
        relacao: txt(fd, "relacao") || undefined,
        nome: txt(fd, "nome") || undefined,
        dataNascimento: txt(fd, "dataNascimento") || undefined,
        nacionalidades: lista(fd, "nacionalidades"),
        profissao: txt(fd, "profissao") || undefined,
        telefone: txt(fd, "telefone") || undefined,
        email: txt(fd, "email") || undefined,
        ...morada,
      };
    case 4:
      return {
        // Declarações, não consentimentos: sem resposta explícita o passo tem
        // de parar. Ficar gravado `ePpe = false` porque ninguém carregou em
        // nada é um falso negativo numa declaração da Lei 83/2017 — e, com o
        // motor de risco a ler daqui, um processo que devia estar em risco
        // elevado a passar por normal sem ninguém ter respondido nada.
        ePpe: simNao(fd, "ePpe"),
        ppeCargo: txt(fd, "ppeCargo") || undefined,
        ppePais: txt(fd, "ppePais") || undefined,
        ppeEntidade: txt(fd, "ppeEntidade") || undefined,
        ppeInicio: txt(fd, "ppeInicio") || undefined,
        ppeFim: txt(fd, "ppeFim") || undefined,
        eRelacionadoPpe: simNao(fd, "eRelacionadoPpe"),
        relacaoPpe: txt(fd, "relacaoPpe") || undefined,
        ppeRelacionadaNome: txt(fd, "ppeRelacionadaNome") || undefined,
        ppeRelacionadaCargo: txt(fd, "ppeRelacionadaCargo") || undefined,
        ppeRelacionadaPais: txt(fd, "ppeRelacionadaPais") || undefined,
        servicos: txt(fd, "servicos"),
        origemFundos: txt(fd, "origemFundos"),
      };
    case 5:
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
    case 6:
      return {
        origemContacto: txt(fd, "origemContacto"),
        origemDetalhe: txt(fd, "origemDetalhe") || undefined,
        newsletter: bool(fd, "newsletter"),
        emailsNewsletter: lista(fd, "emailsNewsletter"),
        areasInteresse: lista(fd, "areasInteresse"),
        convitesIniciativas: bool(fd, "convitesIniciativas"),
        convitesNome: txt(fd, "convitesNome") || undefined,
        convitesEmail: txt(fd, "convitesEmail") || undefined,
      };
    case 7:
      return {
        declaracaoVeracidade: bool(fd, "declaracaoVeracidade"),
        tcAceitacao: bool(fd, "tcAceitacao"),
        propostaAceitacao: bool(fd, "propostaAceitacao"),
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
  referencia,
  termos,
  otp,
  voltarAoFecho = false,
}: {
  token: string;
  n: number;
  seccoes: Seccoes;
  tipoCliente: "particular" | "empresa";
  referencia: string;
  /**
   * Os Termos e Condições em vigor para esta sociedade, resolvidos no servidor.
   *
   * É o ponto 2 da revisão do cliente, e chega aqui já decidido: `plataforma`
   * enquanto a sociedade não tiver entregado o articulado dela, `documento`
   * assim que tiver. O ecrã não escolhe — só sabe desenhar as duas formas, e
   * sobretudo dizer qual das duas medições de leitura está a aplicar.
   */
  termos: TermosParaLer;
  /** O estado do código de verificação, lido no servidor ao montar o passo 7. */
  otp: EstadoOtp;
  /**
   * O cliente veio da revisão do fecho para corrigir este passo.
   *
   * Ligado pelo `?regresso=fecho` dos links "Corrigir", e **confirmado no
   * servidor**: a página só o passa a `true` quando o fecho é de facto
   * alcançável (todos os passos anteriores gravados). Sem essa confirmação,
   * bastava escrever o parâmetro à mão no primeiro passo para ser atirado para
   * um ecrã de revisão de um formulário vazio.
   */
  voltarAoFecho?: boolean;
}) {
  const router = useRouter();
  const [erros, setErros] = useState<Erros>({});
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [aGuardar, transicao] = useTransition();

  /**
   * Etiqueta de cada campo em erro, para o resumo lá em cima poder dizer qual.
   *
   * Num efeito e não no próprio render porque sai do DOM: durante o render do
   * servidor não há `document`, e durante o do cliente os campos deste render
   * ainda não foram aplicados. Depois do commit estão lá os certos — incluindo
   * os que só aparecem consoante as respostas dadas.
   */
  const [rotulos, setRotulos] = useState<Record<string, string>>({});

  useEffect(() => {
    const campos = Object.keys(erros);
    if (!campos.length) {
      // Sem `{}` novo quando já estava vazio, senão o primeiro render de cada
      // passo pedia um segundo sem nada ter mudado.
      setRotulos((atuais) => (Object.keys(atuais).length ? {} : atuais));
      return;
    }
    const novos: Record<string, string> = {};
    for (const campo of campos) {
      const rotulo = alvoDoErro(campo)?.rotulo;
      if (rotulo) novos[campo] = rotulo;
    }
    setRotulos(novos);
  }, [erros]);

  // O tipo de cliente não tem estado local: vem do processo que o escritório
  // criou e é imutável durante o onboarding. Era `useState`, com dois botões a
  // mudá-lo, o que deixava o cliente final trocar um particular por uma empresa
  // a meio do preenchimento — e com isso o percurso de passos, os campos
  // obrigatórios e os documentos pedidos deixavam de ser os do processo que
  // está gravado do outro lado. Lê-se a prop `tipoCliente` diretamente.

  // estado local para os campos que fazem aparecer outros
  //
  // Sem resposta de partida: é uma declaração sobre quem age em nome de quem.
  // "Sim" fecha o passo num clique, "Não" abre os dados do representante.
  const [eRepresentante, setERepresentante] = useState<boolean | null>(
    seccoes.representante?.eRepresentante ?? null,
  );
  const [ePpe, setEPpe] = useState(seccoes.ppe?.ePpe ?? null);
  const [relPpe, setRelPpe] = useState(seccoes.ppe?.eRelacionadoPpe ?? null);
  const [nifPt, setNifPt] = useState(seccoes.fiscais?.nifPortugues ?? true);
  const [origem, setOrigem] = useState(seccoes.preferencias?.origemContacto ?? "");
  // Quem já tinha aceitado os T&C (ou a proposta) não volta a ser mandado ler
  // o documento — a caixa marcada na base de dados é prova de que já passou
  // por aqui. São dois documentos e duas leituras: aceitar um não vale pelo
  // outro.
  const [termosLidos, setTermosLidos] = useState(seccoes.fecho?.tcAceitacao ?? false);
  const [propostaLida, setPropostaLida] = useState(seccoes.fecho?.propostaAceitacao ?? false);
  const [newsletter, setNewsletter] = useState(seccoes.preferencias?.newsletter ?? null);
  const [convites, setConvites] = useState(seccoes.preferencias?.convitesIniciativas ?? null);
  const [otpVerificado, setOtpVerificado] = useState(otp.verificado);

  const anterior = passoAnterior(n, tipoCliente);
  const passo = PASSOS.find((p) => p.n === n)!;

  /**
   * A proposta comercial que a sociedade anexou ao processo.
   *
   * Sai dos documentos do processo — não é preciso consulta nenhuma nova, o
   * `seccoesDoProcesso` já os traz — e o URL é a rota autorizada pelo mesmo
   * token que abriu esta página. Sem anexo fica `null`, e o cliente fica bloqueado.
   */
  const anexo = seccoes.documentos.find((d) => d.tipo === "proposta_comercial");
  const propostaAnexada = anexo
    ? {
        nome: anexo.nome,
        bytes: anexo.bytes,
        url: `/onboarding/${token}/proposta`,
        criadoEm: anexo.criadoEm,
      }
    : null;

  // A contagem do cabeçalho é a do percurso deste cliente, não a dos sete
  // passos que existem: uma pessoa singular não passa pelo Representante Legal
  // e prometer-lhe "de 07" é prometer um ecrã que nunca vai ver.
  const percurso = passosDoProcesso(tipoCliente);
  const posicao = percurso.findIndex((p) => p.n === n) + 1;
  const eUltimo = n === ultimoPasso(tipoCliente);

  /**
   * Marcar "os dados de faturação são os mesmos do cliente" devia preencher
   * os campos, não ser só uma declaração. Sem isto o cliente marca a caixa e
   * vê tudo vazio — foi o que a reunião de 06/08 apanhou.
   */
  const preencherFaturacao = (marcado: boolean) => {
    if (!marcado) return;
    const id = seccoes.identificacao;
    const fis = seccoes.fiscais;
    const mapa: Record<string, string | null | undefined> = {
      nome: id?.nome,
      // O NIF estrangeiro passou a ser copiado como qualquer outro: o campo de
      // destino já não impõe o mod-11 português a um número que nunca o podia
      // cumprir. Antes ficava de fora, e o cliente que marcava "são os mesmos"
      // via tudo preenchido menos o NIF, sem explicação nenhuma.
      nif: fis?.nif,
      email: id?.email,
      morada: id?.morada,
      pais: id?.pais,
      codigoPostal: id?.codigoPostal,
      localidade: id?.localidade,
      freguesia: id?.freguesia,
      concelho: id?.concelho,
      distrito: id?.distrito,
    };
    for (const [name, valor] of Object.entries(mapa)) {
      if (!valor) continue;
      const el = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
      if (el) el.value = valor;
    }
  };

  const preencherAoCuidado = (marcado: boolean) => {
    if (!marcado) return;
    const id = seccoes.identificacao;
    const mapa: Record<string, string | null | undefined> = {
      acNome: id?.nome,
      acEmail: id?.email,
      acTelefone: id?.telefone,
    };
    for (const [name, valor] of Object.entries(mapa)) {
      if (!valor) continue;
      const el = document.querySelector<HTMLInputElement>(`[name="${name}"]`);
      if (el) el.value = valor;
    }
  };

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
      // No último passo são dois momentos: gravar a declaração e só depois
      // submeter. O `submeter` lê a declaração da base de dados — se não a
      // gravarmos primeiro, o cliente fica preso num erro que não consegue
      // resolver.
      let r: Resultado;
      try {
        r = await guardarPasso(token, n, carga(n, fd));
        if (r.ok && eUltimo && fd.get("_acao") === "submeter") {
          r = await submeter(token);
        }
      } catch (erro) {
        // O `revalidatePath` dentro do `guardarPasso`/`submeter` força a
        // Next a voltar a renderizar a página ou o layout do passo a meio
        // desta chamada — e essa re-renderização pode conter um
        // `redirect()` (a página do passo manda para `/submetido` assim
        // que o estado muda) ou um `notFound()` (o link expirou a meio do
        // preenchimento). Isso chega aqui como uma exceção com "digest"
        // próprio do Next, não como um erro nosso: tem de continuar a
        // propagar-se para a navegação acontecer. Um `catch` genérico que a
        // engolisse deixava o processo submetido na BD com o cliente preso
        // no último passo, ou o passo por gravar apesar de os dados já lá
        // estarem.
        unstable_rethrow(erro);

        // Uma Server Action que rebenta a sério — limite de corpo, rede a
        // cair — não pode deixar o botão preso em "A guardar…" sem
        // explicação. Silêncio é pior do que uma falha visível.
        setMensagem("Não foi possível guardar. Verifique a ligação e tente de novo.");
        return;
      }

      if (!r.ok) {
        setErros(r.erros);
        setMensagem(r.mensagem ?? null);
        // O servidor a recusar por falta de verificação desmente o que este
        // ecrã está a mostrar: a validade de uma hora pode ter-se esgotado
        // entre validar o código e carregar em Submeter. Repor o estado é o que
        // devolve o bloco do código ao ecrã — sem isto ficava o visto verde a
        // dizer que estava tudo bem e um botão apagado sem saída nenhuma.
        if (r.erros.otp) setOtpVerificado(false);
        // leva o foco para o primeiro erro em vez de o deixar perdido
        const primeiro = Object.keys(r.erros)[0];
        if (primeiro) {
          alvoDoErro(primeiro)?.rolar.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        return;
      }

      setErros({});
      // Deixa dito à lombada qual o passo a carimbar quando a página seguinte
      // montar. É por isto que o carimbo aparece já com o passo dado.
      sessionStorage.setItem(CHAVE_CARIMBO, String(n));

      if (eUltimo) {
        router.push(`/onboarding/${token}/submetido`);
      } else if (voltarAoFecho) {
        /*
         * Veio da revisão para corrigir: volta lá, e não ao passo seguinte.
         *
         * O que aqui estava mandava-o sempre para a frente, um passo de cada
         * vez, e obrigava-o a atravessar de novo três ou quatro ecrãs já
         * corretos só para chegar ao botão de submeter — com um "Guardar e
         * continuar" a gravar outra vez, em cada um, dados que ninguém tocou.
         * Quem vai corrigir uma vírgula no NIF quer voltar ao sítio de onde
         * saiu.
         */
        router.push(`/onboarding/${token}/passo/${ultimoPasso(tipoCliente)}`);
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
          Passo {String(posicao).padStart(2, "0")} de {String(percurso.length).padStart(2, "0")}
        </p>
        <h1 className="mt-1 text-2xl">{passo.titulo}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{passo.descricao}</p>
      </header>

      <Separator />

      {/* Quem veio corrigir tem de saber para onde vai a seguir. Sem esta
          linha, o botão de baixo dizer "Guardar e voltar ao fecho" quando na
          visita anterior dizia "Guardar e continuar" lê-se como um salto que a
          plataforma decidiu sozinha. */}
      {voltarAoFecho && (
        <div className="border-latao/40 bg-latao/5 flex flex-wrap items-center justify-between gap-2 rounded-sm border p-3 text-sm">
          <span className="text-tinta-suave">
            Está a corrigir este passo. Ao guardar, volta à revisão final.
          </span>
          <Link
            href={`/onboarding/${token}/passo/${ultimoPasso(tipoCliente)}`}
            className="hover:text-selo shrink-0 text-xs underline underline-offset-2"
          >
            Voltar sem guardar
          </Link>
        </div>
      )}

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
                    const alvo = alvoDoErro(campo);
                    alvo?.rolar.scrollIntoView({ block: "center", behavior: "smooth" });
                    // `preventScroll` senão o foco salta lá de imediato e come
                    // a rolagem suave que acabámos de pedir.
                    alvo?.focar?.focus({ preventScroll: true });
                  }}
                  className="text-selo/90 hover:text-selo text-left text-xs underline underline-offset-2"
                >
                  {rotulos[campo] ? `${rotulos[campo]} — ${msgs[0]}` : msgs[0]}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {n === 1 && (
        <>
          {/* Informação, não escolha. O tipo de cliente é fixado quando o
              escritório abre o processo e vem na prop; o que estava aqui eram
              dois botões que o deixavam ser trocado a meio do onboarding, com
              o percurso de passos, os campos obrigatórios e os documentos
              pedidos a mudarem por baixo de um processo já criado. O `input`
              escondido fica: o `passo1` continua a exigir o campo, e agora
              leva sempre o valor da prop. */}
          <div className="border-linha bg-papel-alto flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-sm border px-3 py-2">
            <input type="hidden" name="tipoCliente" value={tipoCliente} />
            <span className="text-2xs font-mono tracking-[0.16em] text-muted-foreground uppercase">
              Cliente
            </span>
            <span className="text-sm font-medium">
              {tipoCliente === "empresa" ? "Empresa / Entidade Coletiva" : "Pessoa Singular"}
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <CampoTexto
              etiqueta={tipoCliente === "empresa" ? "Denominação social" : "Nome completo"}
              nome="nome"
              erros={erros}
              obrigatorio
              valorInicial={seccoes.identificacao?.nome ?? ""}
              className="sm:col-span-2"
            />

            {tipoCliente === "particular" ? (
              <>
                <CampoTexto etiqueta="Profissão" nome="profissao" erros={erros} obrigatorio valorInicial={seccoes.identificacao?.profissao ?? ""} />
                <CampoTexto etiqueta="Entidade patronal" nome="entidadePatronal" erros={erros} obrigatorio ajuda="Caso não se aplique, preencha com N/A." valorInicial={seccoes.identificacao?.entidadePatronal ?? ""} />
                <CampoTexto etiqueta="Data de nascimento" nome="dataNascimento" tipo="date" erros={erros} obrigatorio valorInicial={seccoes.identificacao?.dataNascimento ?? ""} />
              </>
            ) : (
              <>
                <CampoTexto etiqueta="Natureza jurídica" nome="naturezaJuridica" erros={erros} obrigatorio ajuda="Forma jurídica da entidade — por exemplo Lda., S.A., Unipessoal Lda." valorInicial={seccoes.identificacao?.naturezaJuridica ?? ""} />
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
        </>
      )}

      {n === 2 && (
        <>
          <div className="flex flex-wrap gap-6">
            {/* `erros` também aqui: sem ele, um erro nestes campos ia parar ao
                resumo lá em cima sem nada ficar marcado no ecrã — que é
                exatamente o "falta corrigir um campo" que não diz qual. */}
            <CampoCaixa etiqueta="Número de contribuinte português?" nome="nifPortugues" erros={erros} valorInicial={nifPt} onChange={setNifPt} />
            <CampoCaixa etiqueta="Reside em Portugal?" nome="resideEmPortugal" erros={erros} valorInicial={seccoes.fiscais?.resideEmPortugal ?? true} />
          </div>

          <CampoTexto
            etiqueta={tipoCliente === "empresa" ? "NIPC" : "Número de contribuinte"}
            nome="nif"
            erros={erros}
            obrigatorio
            mono
            ajuda={
              !nifPt
                ? "Número de identificação fiscal do país de residência."
                : tipoCliente === "empresa"
                  ? "Nove dígitos, a começar por 5, 6, 8 ou 9. O dígito de controlo é verificado."
                  : "Nove dígitos, validado por checksum."
            }
            valorInicial={seccoes.fiscais?.nif ?? ""}
          />

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

          <Separator />
          <Anexos
            token={token}
            titulo="Documentação"
            ajuda="Anexe a cópia do documento de identificação válido e legível, e o comprovativo de NIF obtido no portal da Autoridade Tributária com emissão dos últimos 6 meses."
            tipos={
              tipoCliente === "empresa"
                ? ["identificacao", "comprovativo_nif", "certidao_permanente", "outro"]
                : ["identificacao", "comprovativo_nif", "outro"]
            }
            obrigatorios={ANEXOS_OBRIGATORIOS[tipoCliente]}
            erros={erros}
            iniciais={seccoes.documentos.filter((d) =>
              ["identificacao", "comprovativo_nif", "certidao_permanente", "outro"].includes(d.tipo),
            )}
          />

          {tipoCliente === "empresa" && (
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
          <CampoSimNao
            pergunta="É o representante legal desta entidade?"
            nome="eRepresentante"
            erros={erros}
            valorInicial={eRepresentante}
            onChange={setERepresentante}
          />

          {eRepresentante !== false ? (
            <p className="border-linha bg-muted flex items-start gap-2 rounded-sm border p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Se é o próprio a representar legalmente a entidade — como gerente,
                administrador ou procurador —, responda Sim. Responda Não para
                identificar outra pessoa como representante legal.
              </span>
            </p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <CampoTexto
                  etiqueta="Cargo"
                  nome="relacao"
                  erros={erros}
                  obrigatorio
                  ajuda="Por exemplo: Gerente, Administrador, Procurador."
                  valorInicial={seccoes.representante?.relacao ?? ""}
                  className="sm:col-span-2"
                />
                <CampoTexto
                  etiqueta="Nome completo"
                  nome="nome"
                  erros={erros}
                  obrigatorio
                  valorInicial={seccoes.representante?.nome ?? ""}
                  className="sm:col-span-2"
                />
                <CampoTexto
                  etiqueta="Data de nascimento"
                  nome="dataNascimento"
                  tipo="date"
                  erros={erros}
                  obrigatorio
                  valorInicial={seccoes.representante?.dataNascimento ?? ""}
                />
                <CampoTexto
                  etiqueta="Profissão"
                  nome="profissao"
                  erros={erros}
                  obrigatorio
                  valorInicial={seccoes.representante?.profissao ?? ""}
                />
                <CampoLista
                  etiqueta="Nacionalidade(s)"
                  nome="nacionalidades"
                  erros={erros}
                  obrigatorio
                  sugestoes={PAISES}
                  valorInicial={seccoes.nacionalidadesRepresentante}
                  className="sm:col-span-2"
                />
                <CampoTexto
                  etiqueta="Contacto telefónico"
                  nome="telefone"
                  erros={erros}
                  obrigatorio
                  ajuda="Com indicativo — por exemplo +351 912 345 678."
                  valorInicial={seccoes.representante?.telefone ?? ""}
                />
                <CampoTexto
                  etiqueta="Email"
                  nome="email"
                  tipo="email"
                  erros={erros}
                  obrigatorio
                  valorInicial={seccoes.representante?.email ?? ""}
                />
              </div>

              <Separator />
              <h2 className="text-lg">Morada do representante</h2>
              <BlocoMorada erros={erros} v={seccoes.representante} />
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

          {/* Sem falar de níveis de risco nem de aprovações: a aprovação foi
              apagada da POC (D20) e o risco não é mostrado a ninguém (D21) —
              muito menos ao próprio cliente. O que ele precisa de saber é
              porque lhe estamos a fazer a pergunta e o que muda ao responder
              Sim. */}
          <p className="border-linha bg-muted flex items-start gap-2 rounded-sm border p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Pessoa politicamente exposta (PPE) é quem exerce ou exerceu funções públicas
              de relevo — cargos governativos, parlamentares, judiciais, de direção em
              empresas públicas ou em organizações internacionais. A pergunta é obrigatória
              pela Lei 83/2017 e aplica-se a todos os clientes. Responder Sim não impede
              nada: leva apenas à recolha dos dados do cargo, nos campos que se abrem
              a seguir.
            </span>
          </p>

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
          <CampoLongo
            etiqueta="Serviço(s) jurídico(s) que lhe vamos prestar"
            nome="servicos"
            erros={erros}
            obrigatorio
            ajuda="Escreva pelas suas palavras, ou escolha das sugestões e ajuste."
            sugestoes={SUGESTOES_SERVICOS}
            valorInicial={seccoes.negocio?.servicos ?? ""}
          />
          <CampoLongo
            etiqueta="Origem dos fundos"
            nome="origemFundos"
            erros={erros}
            obrigatorio
            ajuda="De onde vem o dinheiro com que os honorários vão ser pagos."
            sugestoes={SUGESTOES_ORIGEM_FUNDOS}
            valorInicial={seccoes.negocio?.origemFundos ?? ""}
          />
        </>
      )}

      {n === 5 && (
        <>
          <CampoCaixa etiqueta="Os dados de faturação são os mesmos do cliente" nome="igualAoCliente" erros={erros} valorInicial={seccoes.faturacao?.igualAoCliente ?? false} onChange={preencherFaturacao} />

          <div className="grid gap-4 sm:grid-cols-2">
            <CampoTexto etiqueta="Nome ou empresa" nome="nome" erros={erros} obrigatorio valorInicial={seccoes.faturacao?.nome ?? ""} className="sm:col-span-2" />
            <CampoTexto etiqueta="NIF / NIPC" nome="nif" erros={erros} obrigatorio mono ajuda="Português ou do país de residência." valorInicial={seccoes.faturacao?.nif ?? ""} />
            <CampoTexto etiqueta="Email para faturas" nome="email" tipo="email" erros={erros} obrigatorio valorInicial={seccoes.faturacao?.email ?? ""} />
          </div>

          <Separator />
          <h2 className="text-lg">Morada de faturação</h2>
          <BlocoMorada erros={erros} v={seccoes.faturacao} />

          <Separator />
          <h2 className="text-lg">Ao cuidado de</h2>
          <CampoCaixa etiqueta="Os dados ao cuidado de são os mesmos do cliente" nome="acIgualAoCliente" erros={erros} valorInicial={seccoes.faturacao?.acIgualAoCliente ?? false} onChange={preencherAoCuidado} />
          <div className="grid gap-4 sm:grid-cols-3">
            <CampoTexto etiqueta="Nome" nome="acNome" erros={erros} valorInicial={seccoes.faturacao?.acNome ?? ""} />
            <CampoTexto etiqueta="Email" nome="acEmail" tipo="email" erros={erros} valorInicial={seccoes.faturacao?.acEmail ?? ""} />
            <CampoTexto etiqueta="Contacto telefónico" nome="acTelefone" erros={erros} valorInicial={seccoes.faturacao?.acTelefone ?? ""} />
          </div>
        </>
      )}

      {n === 6 && (
        <>
          <CampoRadio
            etiqueta="Como chegou até nós?"
            nome="origemContacto"
            erros={erros}
            obrigatorio
            opcoes={ORIGEM_CONTACTO}
            valorInicial={origem}
            onChange={setOrigem}
          />

          {/* O detalhe partilha a mesma coluna (`origem_detalhe`) nos dois
              casos: é sempre "o resto da resposta a esta pergunta", e duas
              colunas para o mesmo pedaço de texto só dariam duas maneiras de
              ficar vazio. */}
          {(origem === "recomendacao" || origem === "outro") && (
            <CampoTexto
              etiqueta={origem === "recomendacao" ? "Quem?" : "Como chegou até nós?"}
              nome="origemDetalhe"
              erros={erros}
              obrigatorio
              ajuda={
                origem === "outro" ? "Descreva por palavras suas como nos conheceu." : undefined
              }
              valorInicial={seccoes.preferencias?.origemDetalhe ?? ""}
            />
          )}

          <Separator />

          <CampoSimNao
            pergunta="Quer subscrever a nossa newsletter?"
            nome="newsletter"
            erros={erros}
            valorInicial={newsletter}
            onChange={setNewsletter}
          />

          {newsletter === true && (
            <CampoLista
              etiqueta="Adicione um ou mais emails para receber novidades"
              nome="emailsNewsletter"
              erros={erros}
              obrigatorio
              placeholder="nome@empresa.pt"
              valorInicial={seccoes.emailsNewsletter}
            />
          )}

          <Separator />

          <CampoCaixas
            etiqueta="Selecione as suas áreas de interesse"
            nome="areasInteresse"
            erros={erros}
            opcoes={AREAS_INTERESSE}
            permitirOutro
            etiquetaOutro="Outra área"
            placeholderOutro="Ex: Direito da Família e Sucessões"
            valorInicial={seccoes.areasInteresse}
          />

          <Separator />

          <CampoSimNao
            pergunta="Deseja receber convites para iniciativas (Formações, Webinars, Workshops, outros)?"
            nome="convitesIniciativas"
            erros={erros}
            valorInicial={convites}
            onChange={setConvites}
          />

          {convites === true && (
            <>
              {/* Já demos o nome e o email no passo 1: pedi-los outra vez para
                  receber um convite é fazer trabalho que a plataforma já tem
                  feito. Vêm preenchidos e continuam editáveis — os convites
                  podem ir para outra pessoa da mesma empresa. Os campos só
                  montam depois do "Sim", por isso o valor de partida basta;
                  não é preciso ir mexer no DOM como na faturação. */}
              <div className="grid gap-4 sm:grid-cols-2">
                <CampoTexto
                  etiqueta="Nome"
                  nome="convitesNome"
                  erros={erros}
                  obrigatorio
                  valorInicial={
                    seccoes.preferencias?.convitesNome ?? seccoes.identificacao?.nome ?? ""
                  }
                />
                <CampoTexto
                  etiqueta="Email"
                  nome="convitesEmail"
                  tipo="email"
                  erros={erros}
                  obrigatorio
                  valorInicial={
                    seccoes.preferencias?.convitesEmail ?? seccoes.identificacao?.email ?? ""
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Preenchido com os dados do primeiro passo. Altere se os convites forem
                para outra pessoa.
              </p>
            </>
          )}
        </>
      )}

      {n === 7 && (
        <>
          <Revisao
            token={token}
            seccoes={seccoes}
            tipoCliente={tipoCliente}
            referencia={referencia}
          />

          <div className="border-linha bg-papel-alto flex flex-col gap-5 rounded-sm border p-4">
            <div>
              <h2 className="text-lg">Termos e Condições</h2>
              <p className="text-sm text-muted-foreground">
                Ao aceitar, confirma que leu os Termos e Condições de prestação de
                serviços.
              </p>
            </div>

            <LeitorTermos
              termos={termos}
              lido={termosLidos}
              aoLer={() => setTermosLidos(true)}
              hrefExterno={
                termos.forma === "documento" ? termos.url : "/termos-condicoes"
              }
            />

            {/* Um processo já submetido uma vez traz a caixa marcada da base de
                dados; nesse caso o documento já foi lido, e voltar a trancá-la
                era pedir a leitura outra vez a quem só voltou atrás para
                corrigir uma vírgula noutro passo. */}
            <CampoCaixa
              etiqueta="Aceito os Termos e Condições."
              nome="tcAceitacao"
              erros={erros}
              desativado={!termosLidos}
              ajudaDesativado={
                termos.forma === "documento"
                  ? "Abra o documento acima para poder aceitar."
                  : "Abra o documento acima e percorra-o até ao fim para poder aceitar."
              }
              valorInicial={seccoes.fecho?.tcAceitacao ?? false}
            />

            <Separator />

            <div>
              <h2 className="text-lg">Proposta de Honorários</h2>
              <p className="text-sm text-muted-foreground">
                Ao aceitar, confirma que leu e aceita os serviços e as condições descritos na proposta comercial que a sociedade lhe enviou.
              </p>
            </div>

            <LeitorProposta
              lido={propostaLida}
              aoLer={() => setPropostaLida(true)}
              anexada={propostaAnexada}
            />

            <CampoCaixa
              etiqueta="Aceito a proposta de honorários."
              nome="propostaAceitacao"
              erros={erros}
              desativado={!propostaAnexada || !propostaLida}
              ajudaDesativado={
                !propostaAnexada
                  ? "A sociedade ainda não anexou a proposta deste processo. Para continuar, contacte-a."
                  : "Abra o documento acima para poder aceitar."
              }
              valorInicial={seccoes.fecho?.propostaAceitacao ?? false}
            />

            <Separator />

            <h2 className="text-lg">Declaração final</h2>
            <CampoCaixa
              etiqueta="Declaro que as informações prestadas são verdadeiras e assumo a responsabilidade pela sua atualização caso se verifiquem alterações."
              nome="declaracaoVeracidade"
              erros={erros}
              valorInicial={seccoes.fecho?.declaracaoVeracidade ?? false}
            />

            <Separator />

            <div>
              <h2 className="text-lg">Verificação por email</h2>
              <p className="text-sm text-muted-foreground">
                O último passo antes de assinar: confirmamos que é o senhor(a) quem
                está a submeter.
              </p>
            </div>

            <CodigoOtp
              token={token}
              inicial={otp}
              verificado={otpVerificado}
              erros={erros}
              aoVerificar={setOtpVerificado}
            />

            <Separator />

            <div>
              <h2 className="text-lg">Assinatura digital</h2>
              <p className="text-sm text-muted-foreground">
                A sua rubrica fecha e confirma tudo o que aceitou acima.
              </p>
            </div>

            {/* O quadro só monta depois da verificação, e não fica desativado
                por cima: um canvas de assinatura semitransparente convida na
                mesma a desenhar, e desenhar sem que nada aconteça é a pior
                forma de dizer que falta um passo. O servidor faz a mesma
                pergunta antes de escrever a rubrica — ver `guardarPasso`. */}
            {otpVerificado ? (
              <Assinatura nome="assinatura" erros={erros} />
            ) : (
              <p className="border-linha bg-muted flex items-start gap-2 rounded-sm border p-3 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  O quadro de assinatura abre assim que validar o código enviado por
                  email.
                </span>
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Ao submeter, o processo fica a aguardar aprovação da equipa — deixa
            de ser editável e recebe um email com a decisão.
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

        {/* No fecho, o botão só acorda depois do código verificado — a mesma
            condição que o servidor impõe antes de escrever a rubrica. Um botão
            que se pode carregar e devolve sempre o mesmo erro é pior do que um
            botão que diz porque está apagado. */}
        <Button
          type="submit"
          disabled={aGuardar || (eUltimo && !otpVerificado)}
          size="lg"
          className="md:h-9"
          title={
            eUltimo && !otpVerificado
              ? "Valide o código enviado por email para poder submeter."
              : undefined
          }
        >
          {aGuardar
            ? "A guardar…"
            : eUltimo
              ? "Submeter"
              : voltarAoFecho
                ? "Guardar e voltar ao fecho"
                : "Guardar e continuar"}
          {eUltimo ? <Check className="size-4" /> : <ArrowRight className="size-4" />}
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
  referencia,
}: {
  token: string;
  seccoes: Seccoes;
  tipoCliente: "particular" | "empresa";
  referencia: string;
}) {
  const s = seccoes;

  const morada = (v: {
    morada?: string | null;
    codigoPostal?: string | null;
    localidade?: string | null;
  } | null) => (v?.morada ? `${v.morada}, ${v.codigoPostal} ${v.localidade}` : null);

  const resumo: { etiqueta: string; valor: React.ReactNode }[] = [
    { etiqueta: "Referência", valor: <Ref>{referencia}</Ref> },
    { etiqueta: "Tipo de cliente", valor: tipoCliente === "empresa" ? "Empresa / Entidade Coletiva" : "Pessoa Singular" },
    { etiqueta: tipoCliente === "empresa" ? "Denominação social" : "Nome", valor: s.identificacao?.nome },
    { etiqueta: "NIF", valor: s.fiscais?.nif ? <Ref>{s.fiscais.nif}</Ref> : null },
    { etiqueta: "Email", valor: s.identificacao?.email },
    { etiqueta: "Telefone", valor: s.identificacao?.telefone ? <Ref>{s.identificacao.telefone}</Ref> : null },
    { etiqueta: "Morada", valor: morada(s.identificacao) },
  ].filter((c) => c.valor);

  type Bloco = {
    passo: number;
    titulo: string;
    linhas: [string, string | null | undefined][];
  };

  const todosOsBlocos: Bloco[] = [
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
      {
        passo: 3,
        titulo: "Representante Legal",
        linhas: [
          [
            "É o representante legal",
            s.representante ? (s.representante.eRepresentante ? "Sim" : "Não") : null,
          ],
          // Os campos abrem-se com o "Não": quem responde Sim é o próprio
          // representante e já se identificou no passo 1.
          ...(s.representante && !s.representante.eRepresentante
            ? ([
                ["Cargo", s.representante.relacao],
                ["Nome", s.representante.nome],
                ["Data de nascimento", s.representante.dataNascimento],
                ["Nacionalidade(s)", s.nacionalidadesRepresentante.join(", ") || null],
                ["Profissão", s.representante.profissao],
                ["Email", s.representante.email],
                ["Telefone", s.representante.telefone],
                [
                  "Morada",
                  s.representante.morada
                    ? `${s.representante.morada}, ${s.representante.codigoPostal} ${s.representante.localidade}`
                    : null,
                ],
              ] as [string, string | null | undefined][])
            : []),
        ],
      },
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
        passo: 5,
        titulo: "Faturação",
        linhas: [
          ["Nome", s.faturacao?.nome],
          ["NIF", s.faturacao?.nif],
          ["Email", s.faturacao?.email],
        ],
      },
      {
        passo: 6,
        titulo: "RGPD — consentimentos",
        linhas: [
          [
            "Como chegou até nós",
            (() => {
              const texto = ORIGEM_CONTACTO.find(
                (o) => o.valor === s.preferencias?.origemContacto,
              )?.texto;
              if (!texto) return null;
              // "Outro" sozinho não diz nada a quem revê: o detalhe é a resposta.
              return s.preferencias?.origemDetalhe
                ? `${texto} — ${s.preferencias.origemDetalhe}`
                : texto;
            })(),
          ],
          ["Newsletter", s.preferencias ? (s.preferencias.newsletter ? "Sim" : "Não") : null],
          ["Áreas de interesse", s.areasInteresse.join(", ") || null],
          [
            "Convites para iniciativas",
            s.preferencias ? (s.preferencias.convitesIniciativas ? "Sim" : "Não") : null,
          ],
        ],
      },
    ];

  // Um particular não passa pelo Representante Legal: mostrar-lhe o bloco na
  // revisão era mostrar-lhe um passo que nunca lhe apareceu, com um link
  // "Corrigir" que o mandava de volta para aqui.
  const blocos = todosOsBlocos.filter((b) => passoAplicavel(b.passo, tipoCliente));

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg">O que vai submeter</h2>

      <div className="border-tinta/25 bg-papel-alto relative overflow-hidden rounded-sm border-2 p-5">
        <span className="bg-latao absolute top-0 left-0 h-1 w-full" aria-hidden="true" />
        <p className="text-2xs text-latao font-mono tracking-[0.18em] uppercase">
          Resumo do processo
        </p>
        <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {resumo.map((c) => (
            <div key={c.etiqueta} className="flex flex-col gap-0.5">
              <dt className="text-2xs font-mono tracking-[0.14em] text-muted-foreground uppercase">
                {c.etiqueta}
              </dt>
              <dd className="text-lg leading-snug break-words">{c.valor}</dd>
            </div>
          ))}
        </dl>
      </div>

      {blocos.map((b) => {
        const linhas = b.linhas.filter(([, v]) => v);
        if (!linhas.length) return null;
        return (
          <div key={b.passo} className="border-linha bg-papel-alto rounded-sm border">
            <div className="border-linha flex items-center justify-between gap-2 border-b px-4 py-2">
              <h3 className="text-2xs font-mono tracking-[0.14em] text-muted-foreground uppercase">
                {String(b.passo).padStart(2, "0")} · {b.titulo}
              </h3>
              {/* `?regresso=fecho` é o que diz ao passo de destino que este
                  cliente veio corrigir e não veio preencher — e é o que faz o
                  "Guardar" de lá trazê-lo de volta aqui em vez de o atirar para
                  o passo seguinte. A página valida-o contra o estado real do
                  processo antes de o acreditar. */}
              <Link
                href={`/onboarding/${token}/passo/${b.passo}?regresso=fecho`}
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
