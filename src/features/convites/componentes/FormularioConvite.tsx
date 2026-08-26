"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter, unstable_rethrow } from "next/navigation";
import { Anexos } from "@/components/anexos";
import { alvoDoErro } from "@/components/formulario-erros";
import { LeitorTermos, type TermosParaLer } from "@/components/leitor-termos";
import { CHAVE_CARIMBO } from "@/components/lombada";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  CampoCaixa,
  CampoEscolha,
  CampoTexto,
} from "@/features/onboarding/componentes/Campo";
import { DOCUMENTOS_ID, PAISES } from "@/features/onboarding/componentes/paises";
import { concluirConvite, guardarPassoConvite } from "../acoes";
import { carregarDocumentoConvite, removerDocumentoConvite } from "../documentos";
import {
  PASSOS_CONVITE,
  passoAnteriorConvite,
  TOTAL_PASSOS_CONVITE,
} from "../passos";
import { INFORMACAO_RGPD, TEXTO_SIGILO } from "../textos";

type Erros = Record<string, string[]>;
type Anexo = { id: string; nome: string; tipo: string; bytes: number };

export type DadosConvite = {
  email: string;
  nome: string;
  papel: "super_admin" | "society_admin" | "utilizador";
  exerce: boolean;
  sociedade: string;
  perfil: {
    nomeCompleto: string | null;
    dataNascimento: string | null;
    nif: string | null;
    telefone: string | null;
    docTipo: string | null;
    docNumero: string | null;
    docValidade: string | null;
    morada: string | null;
    pais: string | null;
    localidade: string | null;
    codigoPostal: string | null;
    freguesia: string | null;
    concelho: string | null;
    distrito: string | null;
    cedulaProfissional: string | null;
    conselhoRegional: string | null;
    dataInscricaoOa: string | null;
    cargo: string | null;
    areasPratica: string | null;
    informacaoRgpdEm: Date | null;
    sigiloProfissional: boolean;
    comunicacoesInternas: boolean;
  } | null;
  termosAceites: boolean;
};

const txt = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const bool = (fd: FormData, k: string) => fd.get(k) === "true";

/**
 * O que se envia ao servidor em cada passo.
 *
 * `|| undefined` nos opcionais e não a string vazia: um `z.string().optional()`
 * que receba `""` recusa-o com uma mensagem sobre uma caixa que ninguém abriu —
 * a forma mais difícil de reconhecer de «falta corrigir um campo».
 */
function carga(n: number, fd: FormData): Record<string, unknown> {
  switch (n) {
    case 1:
      return {
        nomeCompleto: txt(fd, "nomeCompleto"),
        dataNascimento: txt(fd, "dataNascimento"),
        nif: txt(fd, "nif"),
        telefone: txt(fd, "telefone"),
        docTipo: txt(fd, "docTipo"),
        docNumero: txt(fd, "docNumero"),
        docValidade: txt(fd, "docValidade"),
        morada: txt(fd, "morada"),
        pais: txt(fd, "pais"),
        localidade: txt(fd, "localidade"),
        codigoPostal: txt(fd, "codigoPostal"),
        freguesia: txt(fd, "freguesia"),
        concelho: txt(fd, "concelho"),
        distrito: txt(fd, "distrito"),
      };
    case 2:
      return {
        cargo: txt(fd, "cargo"),
        cedulaProfissional: txt(fd, "cedulaProfissional") || undefined,
        conselhoRegional: txt(fd, "conselhoRegional") || undefined,
        dataInscricaoOa: txt(fd, "dataInscricaoOa") || undefined,
        areasPratica: txt(fd, "areasPratica") || undefined,
      };
    case 3:
      // O anexo não é campo do passo: sobe pela sua própria Server Action e a
      // lista é lida no servidor.
      return {};
    case 4:
      return {
        informacaoRgpd: bool(fd, "informacaoRgpd"),
        sigiloProfissional: bool(fd, "sigiloProfissional"),
        comunicacoesInternas: bool(fd, "comunicacoesInternas"),
      };
    case 5:
      return { aceitaTermos: bool(fd, "aceitaTermos") };
    case 6:
      return {
        password: String(fd.get("password") ?? ""),
        confirmacao: String(fd.get("confirmacao") ?? ""),
      };
    default:
      return {};
  }
}

const CONSELHOS = [
  { valor: "Lisboa", texto: "Conselho Regional de Lisboa" },
  { valor: "Porto", texto: "Conselho Regional do Porto" },
  { valor: "Coimbra", texto: "Conselho Regional de Coimbra" },
  { valor: "Évora", texto: "Conselho Regional de Évora" },
  { valor: "Faro", texto: "Conselho Regional de Faro" },
  { valor: "Madeira", texto: "Conselho Regional da Madeira" },
  { valor: "Açores", texto: "Conselho Regional dos Açores" },
];

function Bloco({ titulo, children }: { titulo?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      {titulo && <h2 className="text-lg">{titulo}</h2>}
      {children}
    </section>
  );
}

export function FormularioConvite({
  token,
  n,
  dados,
  anexos,
  termos,
}: {
  token: string;
  n: number;
  dados: DadosConvite;
  anexos: Anexo[];
  termos: TermosParaLer;
}) {
  const router = useRouter();
  const [erros, setErros] = useState<Erros>({});
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [aGuardar, transicao] = useTransition();
  const [termosLidos, setTermosLidos] = useState(dados.termosAceites);

  const passo = PASSOS_CONVITE.find((p) => p.n === n)!;
  const anterior = passoAnteriorConvite(n);
  const eUltimo = n === TOTAL_PASSOS_CONVITE;
  const p = dados.perfil;

  const carregar = useCallback(
    (fd: FormData) => carregarDocumentoConvite(token, fd),
    [token],
  );
  const remover = useCallback((id: string) => removerDocumentoConvite(token, id), [token]);

  const enviar = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    setMensagem(null);

    transicao(async () => {
      try {
        if (eUltimo) {
          // O último passo não grava campos: cria uma conta, e isso é uma
          // transação própria. Passar por `guardarPassoConvite` primeiro só
          // duplicaria a validação da palavra-passe.
          const c = await concluirConvite(token, carga(6, fd));
          if (!c.ok) {
            setErros(c.erros ?? {});
            setMensagem(c.mensagem);
            return;
          }
          router.push(`/convite/${token}/concluido`);
          return;
        }

        const r = await guardarPassoConvite(token, n, carga(n, fd));
        if (!r.ok) {
          setErros(r.erros);
          setMensagem(r.mensagem ?? null);
          const primeiro = Object.keys(r.erros)[0];
          if (primeiro) {
            alvoDoErro(primeiro)?.rolar.scrollIntoView({ block: "center", behavior: "smooth" });
          }
          return;
        }

        setErros({});
        sessionStorage.setItem(CHAVE_CARIMBO, String(n));
        if (r.proximo) router.push(`/convite/${token}/passo/${r.proximo}`);
        else router.refresh();
      } catch (erro) {
        // Um `revalidatePath` dentro da ação pode conter um `redirect()` ou um
        // `notFound()`, e isso chega aqui como exceção com digest próprio da
        // Next: tem de continuar a propagar-se para a navegação acontecer.
        unstable_rethrow(erro);
        setMensagem("Não foi possível guardar. Verifique a ligação e tente de novo.");
      }
    });
  };

  const campos = Object.keys(erros).filter((c) => c !== "documentos");

  return (
    <form onSubmit={enviar} className="flex flex-col gap-6">
      <header>
        <p className="text-2xs font-mono tracking-[0.16em] text-muted-foreground uppercase">
          Passo {String(n).padStart(2, "0")} de{" "}
          {String(TOTAL_PASSOS_CONVITE).padStart(2, "0")}
        </p>
        <h1 className="mt-1 text-2xl">{passo.titulo}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{passo.descricao}</p>
      </header>

      <Separator />

      {mensagem && (
        <p className="border-selo/40 bg-selo/5 text-selo rounded-sm border p-3 text-sm" role="alert">
          {mensagem}
        </p>
      )}

      {campos.length > 0 && (
        <div className="border-selo/40 bg-selo/5 rounded-sm border p-3" role="alert">
          <p className="text-selo text-sm font-medium">
            {campos.length === 1
              ? "Falta corrigir um campo"
              : `Faltam corrigir ${campos.length} campos`}
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {campos.map((c) => (
              <li key={c} className="text-selo text-xs">
                <button
                  type="button"
                  className="text-left underline underline-offset-2"
                  onClick={() => {
                    const alvo = alvoDoErro(c);
                    alvo?.rolar.scrollIntoView({ block: "center", behavior: "smooth" });
                    alvo?.focar?.focus();
                  }}
                >
                  {erros[c][0]}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {n === 1 && (
        <>
          <Bloco>
            <p className="border-linha bg-muted rounded-sm border p-3 text-sm text-muted-foreground">
              Foi convidado por <strong className="text-tinta">{dados.sociedade}</strong>, para o
              endereço <span className="font-mono">{dados.email}</span>. Se algum destes dados
              estiver errado, fale com quem lhe enviou o convite antes de continuar.
            </p>
            <CampoTexto
              etiqueta="Nome completo"
              nome="nomeCompleto"
              erros={erros}
              obrigatorio
              valorInicial={p?.nomeCompleto ?? dados.nome}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <CampoTexto
                etiqueta="Data de nascimento"
                nome="dataNascimento"
                tipo="date"
                erros={erros}
                obrigatorio
                valorInicial={p?.dataNascimento ?? ""}
              />
              <CampoTexto
                etiqueta="NIF"
                nome="nif"
                erros={erros}
                obrigatorio
                mono
                valorInicial={p?.nif ?? ""}
              />
            </div>
            <CampoTexto
              etiqueta="Telefone"
              nome="telefone"
              erros={erros}
              obrigatorio
              mono
              valorInicial={p?.telefone ?? ""}
              ajuda="Nove dígitos, com ou sem o indicativo +351."
            />
          </Bloco>

          <Bloco titulo="Documento de identificação">
            <div className="grid gap-4 sm:grid-cols-3">
              <CampoEscolha
                etiqueta="Tipo"
                nome="docTipo"
                erros={erros}
                obrigatorio
                opcoes={DOCUMENTOS_ID}
                valorInicial={p?.docTipo ?? ""}
              />
              <CampoTexto
                etiqueta="Número"
                nome="docNumero"
                erros={erros}
                obrigatorio
                mono
                valorInicial={p?.docNumero ?? ""}
              />
              <CampoTexto
                etiqueta="Validade"
                nome="docValidade"
                tipo="date"
                erros={erros}
                obrigatorio
                valorInicial={p?.docValidade ?? ""}
              />
            </div>
          </Bloco>

          <Bloco titulo="Morada">
            <CampoTexto
              etiqueta="Morada"
              nome="morada"
              erros={erros}
              obrigatorio
              valorInicial={p?.morada ?? ""}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <CampoTexto
                etiqueta="Código postal"
                nome="codigoPostal"
                erros={erros}
                obrigatorio
                mono
                valorInicial={p?.codigoPostal ?? ""}
              />
              <CampoTexto
                etiqueta="Localidade"
                nome="localidade"
                erros={erros}
                obrigatorio
                valorInicial={p?.localidade ?? ""}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <CampoTexto
                etiqueta="Freguesia"
                nome="freguesia"
                erros={erros}
                obrigatorio
                valorInicial={p?.freguesia ?? ""}
              />
              <CampoTexto
                etiqueta="Concelho"
                nome="concelho"
                erros={erros}
                obrigatorio
                valorInicial={p?.concelho ?? ""}
              />
              <CampoTexto
                etiqueta="Distrito"
                nome="distrito"
                erros={erros}
                obrigatorio
                valorInicial={p?.distrito ?? ""}
              />
            </div>
            <CampoEscolha
              etiqueta="País"
              nome="pais"
              erros={erros}
              obrigatorio
              opcoes={PAISES}
              valorInicial={p?.pais ?? "PT"}
            />
          </Bloco>
        </>
      )}

      {n === 2 && (
        <Bloco>
          <CampoTexto
            etiqueta="Cargo na sociedade"
            nome="cargo"
            erros={erros}
            obrigatorio
            valorInicial={p?.cargo ?? ""}
            ajuda="Por exemplo: Sócio, Advogado associado, Advogado estagiário, Assistente jurídico."
          />

          {dados.exerce ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <CampoTexto
                  etiqueta="Cédula profissional"
                  nome="cedulaProfissional"
                  erros={erros}
                  obrigatorio
                  mono
                  valorInicial={p?.cedulaProfissional ?? ""}
                />
                <CampoTexto
                  etiqueta="Data de inscrição na Ordem"
                  nome="dataInscricaoOa"
                  tipo="date"
                  erros={erros}
                  valorInicial={p?.dataInscricaoOa ?? ""}
                />
              </div>
              <CampoEscolha
                etiqueta="Conselho regional"
                nome="conselhoRegional"
                erros={erros}
                obrigatorio
                opcoes={CONSELHOS}
                valorInicial={p?.conselhoRegional ?? ""}
              />
            </>
          ) : (
            <p className="border-linha bg-muted rounded-sm border p-3 text-sm text-muted-foreground">
              O perfil que lhe foi atribuído não exerce advocacia, por isso não lhe pedimos cédula
              profissional. Se isto estiver errado, fale com quem lhe enviou o convite — o perfil
              muda do lado da sociedade e o campo aparece.
            </p>
          )}

          <CampoTexto
            etiqueta="Áreas de prática"
            nome="areasPratica"
            erros={erros}
            valorInicial={p?.areasPratica ?? ""}
            ajuda="Opcional. Por exemplo: Direito Societário, Contencioso, Laboral."
          />
        </Bloco>
      )}

      {n === 3 && (
        <Anexos
          carregar={carregar}
          remover={remover}
          tipos={
            dados.exerce
              ? ["identificacao", "cedula_profissional", "outro"]
              : ["identificacao", "outro"]
          }
          iniciais={anexos}
          titulo="Os seus documentos"
          ajuda="Ficam guardados no dossier da sociedade e não são visíveis para clientes."
          obrigatorios={
            dados.exerce ? ["identificacao", "cedula_profissional"] : ["identificacao"]
          }
          erros={erros}
        />
      )}

      {n === 4 && (
        <>
          <Bloco titulo="Tratamento dos seus dados">
            {/* Informação, não consentimento. A distinção está no schema e tem
                de estar também no ecrã: dizer "autorizo" onde a base legal é o
                contrato produz um consentimento inválido e faz a pessoa
                acreditar que o pode retirar. */}
            <div className="border-linha bg-papel-alto flex flex-col gap-3 rounded-sm border p-4 text-sm leading-relaxed text-muted-foreground">
              {INFORMACAO_RGPD.map((paragrafo, i) => (
                <p key={i}>{paragrafo}</p>
              ))}
            </div>
            <CampoCaixa
              nome="informacaoRgpd"
              erros={erros}
              valorInicial={Boolean(p?.informacaoRgpdEm)}
              etiqueta="Tomei conhecimento de como os meus dados são tratados pela sociedade."
            />
          </Bloco>

          <Bloco titulo="Sigilo profissional">
            <div className="border-linha bg-papel-alto rounded-sm border p-4 text-sm leading-relaxed text-muted-foreground">
              {TEXTO_SIGILO}
            </div>
            <CampoCaixa
              nome="sigiloProfissional"
              erros={erros}
              valorInicial={p?.sigiloProfissional ?? false}
              etiqueta="Declaro que assumo o dever de sigilo sobre toda a informação a que aceder nesta plataforma."
            />
          </Bloco>

          <Bloco titulo="Comunicações internas">
            <CampoCaixa
              nome="comunicacoesInternas"
              erros={erros}
              valorInicial={p?.comunicacoesInternas ?? false}
              etiqueta="Autorizo o envio de comunicações internas da sociedade — formações, circulares e avisos — para o meu email. Posso retirar esta autorização a qualquer momento."
            />
            <p className="text-xs text-muted-foreground">
              Esta é a única das três respostas desta página que é uma autorização, e por isso a
              única que pode deixar por marcar. As outras duas são, respetivamente, um dever de
              informação da sociedade e uma declaração exigida pelo Estatuto da Ordem dos
              Advogados.
            </p>
          </Bloco>
        </>
      )}

      {n === 5 && (
        <Bloco>
          <p className="border-linha bg-muted rounded-sm border p-3 text-sm text-muted-foreground">
            Este é o mesmo articulado que os clientes da {dados.sociedade} leem e aceitam no
            registo deles. A sua aceitação fica registada com a versão do documento, a data e o
            endereço de onde foi dada.
          </p>

          <LeitorTermos
            termos={termos}
            lido={termosLidos}
            aoLer={() => setTermosLidos(true)}
            hrefExterno={termos.forma === "documento" ? termos.url : "/termos-condicoes"}
          />

          <CampoCaixa
            nome="aceitaTermos"
            erros={erros}
            valorInicial={dados.termosAceites}
            desativado={!termosLidos}
            ajudaDesativado={
              termos.forma === "documento"
                ? "Abra o documento acima para poder aceitar."
                : "Abra o documento acima e percorra-o até ao fim para poder aceitar."
            }
            etiqueta={`Aceito os Termos e Condições da ${dados.sociedade}, na versão ${termos.versao}.`}
          />
        </Bloco>
      )}

      {n === 6 && (
        <Bloco>
          <p className="border-linha bg-muted rounded-sm border p-3 text-sm text-muted-foreground">
            A conta fica criada com o email <span className="font-mono">{dados.email}</span>. A
            palavra-passe é definida por si e a plataforma nunca a conhece — fica guardada apenas o
            suficiente para a poder confirmar quando entrar.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <CampoTexto
              etiqueta="Palavra-passe"
              nome="password"
              tipo="password"
              erros={erros}
              obrigatorio
              ajuda="Pelo menos 12 caracteres."
            />
            <CampoTexto
              etiqueta="Confirmar palavra-passe"
              nome="confirmacao"
              tipo="password"
              erros={erros}
              obrigatorio
            />
          </div>
        </Bloco>
      )}

      <Separator />

      <div className="flex flex-wrap items-center justify-between gap-3">
        {anterior ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push(`/convite/${token}/passo/${anterior}`)}
          >
            Voltar
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={aGuardar}>
          {aGuardar ? "A guardar…" : eUltimo ? "Criar a conta" : "Guardar e continuar"}
        </Button>
      </div>
    </form>
  );
}
