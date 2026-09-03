"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { Anexos } from "@/components/anexos";
import { alvoDoErro } from "@/components/formulario-erros";
import { CHAVE_CARIMBO } from "@/components/lombada";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Ref } from "@/components/ref-processo";
import { formatarDataCurta } from "@/lib/datas";
import {
  CampoCaixa,
  CampoEscolha,
  CampoTexto,
} from "@/features/onboarding/componentes/Campo";
import { PAISES } from "@/features/onboarding/componentes/paises";
import { LogotipoOnboarding } from "./LogotipoOnboarding";
import { guardarPassoSociedade, submeterSociedade } from "../acoes";
import { carregarDocumentoSociedade, removerDocumentoSociedade } from "../documentos";
import {
  PASSOS_SOCIEDADE,
  passoAnteriorSociedade,
  TOTAL_PASSOS_SOCIEDADE,
} from "../passos";

type Erros = Record<string, string[]>;

type Anexo = { id: string; nome: string; tipo: string; bytes: number };

export type DadosSociedade = {
  nome: string;
  nif: string;
  naturezaJuridica: string | null;
  numeroOrdem: string | null;
  prefixoReferencia: string;
  emailGeral: string | null;
  telefone: string | null;
  website: string | null;
  morada: string | null;
  pais: string | null;
  localidade: string | null;
  codigoPostal: string | null;
  freguesia: string | null;
  concelho: string | null;
  distrito: string | null;
  termosVersao: string | null;
  termosAtualizadoEm: Date | null;
  adminNome: string | null;
  adminEmail: string | null;
  adminTelefone: string | null;
  declaracaoNome: string | null;
  declaracaoCargo: string | null;
  declaracaoVinculo: boolean;
  /** `true` quando o consentimento de privacidade já foi dado (tem data gravada). */
  consentimentoPrivacidade: boolean;
  logotipoNome: string | null;
};

const txt = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const bool = (fd: FormData, k: string) => fd.get(k) === "true";

/**
 * O que se envia ao servidor em cada passo.
 *
 * `|| undefined` nos campos opcionais, e não a string vazia: um campo por
 * preencher chega como `""`, e um `z.string().optional()` que receba `""`
 * recusa-o com uma mensagem sobre uma caixa que ninguém abriu — a forma mais
 * difícil de reconhecer de «falta corrigir um campo», e a mesma que o
 * `regimeIva` já tinha mostrado no passo 2 do cliente.
 */
function carga(n: number, fd: FormData): Record<string, unknown> {
  switch (n) {
    case 1:
      return {
        nome: txt(fd, "nome"),
        nipc: txt(fd, "nipc"),
        naturezaJuridica: txt(fd, "naturezaJuridica"),
        numeroOrdem: txt(fd, "numeroOrdem"),
        prefixoReferencia: txt(fd, "prefixoReferencia"),
      };
    case 2:
      return {
        morada: txt(fd, "morada"),
        pais: txt(fd, "pais"),
        localidade: txt(fd, "localidade"),
        codigoPostal: txt(fd, "codigoPostal"),
        freguesia: txt(fd, "freguesia"),
        concelho: txt(fd, "concelho"),
        distrito: txt(fd, "distrito"),
        emailGeral: txt(fd, "emailGeral"),
        telefone: txt(fd, "telefone"),
        website: txt(fd, "website") || undefined,
      };
    case 3:
      // O anexo não é campo do passo: sobe pela sua própria Server Action e o
      // input nem `name` tem. A lista de documentos é lida no servidor.
      return {};
    case 4:
      return { termosVersao: txt(fd, "termosVersao") };
    case 5:
      return {
        adminNome: txt(fd, "adminNome"),
        adminEmail: txt(fd, "adminEmail"),
        adminTelefone: txt(fd, "adminTelefone"),
      };
    case 6:
      return {
        declaracaoNome: txt(fd, "declaracaoNome"),
        declaracaoCargo: txt(fd, "declaracaoCargo"),
        declaracaoVinculo: bool(fd, "declaracaoVinculo"),
        consentimentoPrivacidade: bool(fd, "consentimentoPrivacidade"),
      };
    default:
      return {};
  }
}

const FORMAS_JURIDICAS = [
  { valor: "Sociedade de Advogados, SP, RL", texto: "Sociedade de Advogados, SP, RL" },
  { valor: "Sociedade de Advogados, RL", texto: "Sociedade de Advogados, RL" },
  { valor: "Sociedade Unipessoal de Advogados", texto: "Sociedade Unipessoal de Advogados" },
  { valor: "Advogado em prática individual", texto: "Advogado em prática individual" },
  { valor: "Outra", texto: "Outra" },
];

function Bloco({ titulo, children }: { titulo?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      {titulo && <h2 className="text-lg">{titulo}</h2>}
      {children}
    </section>
  );
}

function Linha({ etiqueta, valor }: { etiqueta: string; valor: string | null | undefined }) {
  return (
    <div className="border-linha flex items-baseline justify-between gap-4 border-b py-2 last:border-0">
      <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
      <dd className="text-right text-sm break-all">{valor || "—"}</dd>
    </div>
  );
}

export function FormularioSociedade({
  token,
  n,
  dados,
  anexos,
}: {
  token: string;
  n: number;
  dados: DadosSociedade;
  anexos: Anexo[];
}) {
  const router = useRouter();
  const [erros, setErros] = useState<Erros>({});
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [aGuardar, transicao] = useTransition();
  /**
   * O convite do administrador, quando o email não saiu.
   *
   * É o único convite da plataforma que não se pode reenviar: nasce antes de
   * existir conta nenhuma na sociedade, por isso não há ninguém que possa
   * entrar no portal e carregar em «Reenviar». Deixar o link morrer dentro de
   * um email que falhou punha o registo inteiro num beco — submetido, com o
   * convite pendente e nenhuma forma de o abrir (D48).
   */
  const [convitePerdido, setConvitePerdido] = useState<{
    email: string;
    link: string;
    erro?: string;
  } | null>(null);

  const passo = PASSOS_SOCIEDADE.find((p) => p.n === n)!;
  const anterior = passoAnteriorSociedade(n);
  const eUltimo = n === TOTAL_PASSOS_SOCIEDADE;

  const carregar = useCallback(
    (fd: FormData) => carregarDocumentoSociedade(token, fd),
    [token],
  );
  const remover = useCallback((id: string) => removerDocumentoSociedade(token, id), [token]);

  /**
   * `onSubmit` com `preventDefault`, e não `action={}`.
   *
   * O React 19 faz reset ao formulário depois de correr uma Server Action
   * passada em `action`: um dígito errado no NIPC apagava os outros campos
   * todos. Assim o DOM fica intacto e corrige-se só o que está errado.
   */
  const enviar = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    setMensagem(null);

    transicao(async () => {
      try {
        const r = await guardarPassoSociedade(token, n, carga(n, fd));

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

        if (eUltimo) {
          const s = await submeterSociedade(token);
          if (!s.ok) {
            setMensagem(s.mensagem);
            return;
          }
          // Com o email entregue ao fornecedor, o link já está no destino certo
          // e não tem de aparecer no ecrã de quem submeteu — que não é
          // necessariamente a pessoa convidada.
          if (s.emailEnviado) {
            router.push(`/sociedade/${token}/submetido`);
            return;
          }
          setConvitePerdido({
            email: s.adminEmail,
            link: s.linkConvite,
            erro: s.erroEmail,
          });
          return;
        }

        if (r.proximo) router.push(`/sociedade/${token}/passo/${r.proximo}`);
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

  /*
   * Registo submetido e convite por entregar.
   *
   * Substitui o formulário inteiro em vez de aparecer por cima dele: o registo
   * já foi submetido e os campos por baixo deixaram de poder ser gravados —
   * mantê-los à vista convidava a carregar outra vez em Submeter e a receber
   * um erro sobre um registo que está correto.
   */
  if (convitePerdido) {
    return (
      <div className="flex flex-col gap-4">
        <header>
          <h1 className="text-2xl">Registo submetido.</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Faltou uma coisa: não foi possível enviar o convite por email.
          </p>
        </header>

        <div className="border-latao/40 bg-latao/5 flex flex-col gap-3 rounded-sm border p-4">
          <p className="text-sm">
            O convite para <strong>{convitePerdido.email}</strong> foi criado, mas o email não
            saiu. <strong>Copie o link abaixo e faça-o chegar a essa pessoa por outra via</strong> —
            é a única vez que ele aparece, e sem conta na plataforma ainda não há forma de o
            reenviar.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <code className="border-linha bg-papel-alto min-w-0 flex-1 truncate rounded-sm border px-2 py-1.5 font-mono text-xs">
              {convitePerdido.link}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigator.clipboard?.writeText(convitePerdido.link)}
            >
              Copiar
            </Button>
          </div>

          {convitePerdido.erro && (
            <p className="text-xs text-muted-foreground">
              Razão do fornecedor de email:{" "}
              <span className="font-mono">{convitePerdido.erro}</span>
            </p>
          )}
        </div>

        <Button
          type="button"
          onClick={() => router.push(`/sociedade/${token}/submetido`)}
          className="self-start"
        >
          Continuar
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-6">
      <header>
        <p className="text-2xs font-mono tracking-[0.16em] text-muted-foreground uppercase">
          Passo {String(n).padStart(2, "0")} de{" "}
          {String(TOTAL_PASSOS_SOCIEDADE).padStart(2, "0")}
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
            {campos.length === 1 ? "Falta corrigir um campo" : `Faltam corrigir ${campos.length} campos`}
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
        <Bloco>
          <CampoTexto
            etiqueta="Nome da sociedade"
            nome="nome"
            erros={erros}
            obrigatorio
            valorInicial={dados.nome}
            ajuda="O nome pelo qual a sociedade contrata — o que consta da certidão."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <CampoTexto
              etiqueta="NIPC"
              nome="nipc"
              erros={erros}
              obrigatorio
              mono
              valorInicial={dados.nif}
              ajuda="Nove dígitos, começados por 5, 6, 8 ou 9."
            />
            <CampoTexto
              etiqueta="N.º na Ordem dos Advogados"
              nome="numeroOrdem"
              erros={erros}
              obrigatorio
              mono
              valorInicial={dados.numeroOrdem ?? ""}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <CampoEscolha
              etiqueta="Forma jurídica"
              nome="naturezaJuridica"
              erros={erros}
              obrigatorio
              opcoes={FORMAS_JURIDICAS}
              valorInicial={dados.naturezaJuridica ?? ""}
            />
            <CampoTexto
              etiqueta="Prefixo das referências"
              nome="prefixoReferencia"
              erros={erros}
              obrigatorio
              mono
              valorInicial={dados.prefixoReferencia}
              ajuda="Entra em cada referência de processo — «JM» dá JM-2026-0142."
            />
          </div>

          <Separator />

          <LogotipoOnboarding
            token={token}
            temLogotipo={Boolean(dados.logotipoNome)}
            nomeLogotipo={dados.logotipoNome}
          />
        </Bloco>
      )}

      {n === 2 && (
        <>
          <Bloco titulo="Sede">
            <CampoTexto
              etiqueta="Morada"
              nome="morada"
              erros={erros}
              obrigatorio
              valorInicial={dados.morada ?? ""}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <CampoTexto
                etiqueta="Código postal"
                nome="codigoPostal"
                erros={erros}
                obrigatorio
                mono
                valorInicial={dados.codigoPostal ?? ""}
              />
              <CampoTexto
                etiqueta="Localidade"
                nome="localidade"
                erros={erros}
                obrigatorio
                valorInicial={dados.localidade ?? ""}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <CampoTexto
                etiqueta="Freguesia"
                nome="freguesia"
                erros={erros}
                obrigatorio
                valorInicial={dados.freguesia ?? ""}
              />
              <CampoTexto
                etiqueta="Concelho"
                nome="concelho"
                erros={erros}
                obrigatorio
                valorInicial={dados.concelho ?? ""}
              />
              <CampoTexto
                etiqueta="Distrito"
                nome="distrito"
                erros={erros}
                obrigatorio
                valorInicial={dados.distrito ?? ""}
              />
            </div>
            <CampoEscolha
              etiqueta="País"
              nome="pais"
              erros={erros}
              obrigatorio
              opcoes={PAISES}
              valorInicial={dados.pais ?? "PT"}
            />
          </Bloco>

          <Bloco titulo="Contactos">
            <div className="grid gap-4 sm:grid-cols-2">
              <CampoTexto
                etiqueta="Email geral"
                nome="emailGeral"
                tipo="email"
                erros={erros}
                obrigatorio
                valorInicial={dados.emailGeral ?? ""}
              />
              <CampoTexto
                etiqueta="Telefone"
                nome="telefone"
                erros={erros}
                obrigatorio
                mono
                valorInicial={dados.telefone ?? ""}
                ajuda="Nove dígitos, com ou sem o indicativo +351."
              />
            </div>
            <CampoTexto
              etiqueta="Website"
              nome="website"
              erros={erros}
              valorInicial={dados.website ?? ""}
              ajuda="Opcional. Endereço completo, começado por https://."
            />
          </Bloco>
        </>
      )}

      {n === 3 && (
        <Anexos
          carregar={carregar}
          remover={remover}
          tipos={["certidao_sociedade", "outro"]}
          iniciais={anexos.filter((a) => a.tipo !== "termos_sociedade")}
          titulo="Certidão permanente"
          ajuda="A certidão permanente permite confirmar a identificação e a forma jurídica da sociedade."
          obrigatorios={["certidao_sociedade"]}
          erros={erros}
        />
      )}

      {n === 4 && (
        <>
          <Anexos
            carregar={carregar}
            remover={remover}
            tipos={["termos_sociedade"]}
            iniciais={anexos.filter((a) => a.tipo === "termos_sociedade")}
            titulo="Documento em PDF"
            ajuda="É este documento que a plataforma passa a apresentar aos clientes no fecho do registo e à equipa no primeiro acesso."
            erros={erros}
          />

          <Bloco>
            <CampoTexto
              etiqueta="Versão dos Termos e Condições"
              nome="termosVersao"
              placeholder="ex: 2026.08.1"
              erros={erros}
              obrigatorio
              mono
              valorInicial={dados.termosVersao ?? ""}
              ajuda="Cada aceitação fica gravada com esta versão. Ao atualizar o documento no futuro, deverá indicar uma nova versão."
            />
            {dados.termosVersao && dados.termosAtualizadoEm && (
              <p className="text-xs text-muted-foreground">
                Versão em vigor: <Ref>{dados.termosVersao}</Ref>, submetida em{" "}
                {formatarDataCurta(dados.termosAtualizadoEm)}
                .
              </p>
            )}
          </Bloco>
        </>
      )}

      {n === 5 && (
        <Bloco>
          <p className="border-linha bg-muted rounded-sm border p-3 text-sm text-muted-foreground">
            Esta pessoa recebe um convite por email para criar a sua conta de administração da sociedade.
          </p>
          <CampoTexto
            etiqueta="Nome"
            nome="adminNome"
            erros={erros}
            obrigatorio
            valorInicial={dados.adminNome ?? ""}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <CampoTexto
              etiqueta="Email"
              nome="adminEmail"
              tipo="email"
              erros={erros}
              obrigatorio
              valorInicial={dados.adminEmail ?? ""}
              ajuda="É para aqui que vai o convite. Confirme-o antes de continuar."
            />
            <CampoTexto
              etiqueta="Telefone"
              nome="adminTelefone"
              erros={erros}
              obrigatorio
              mono
              valorInicial={dados.adminTelefone ?? ""}
            />
          </div>
        </Bloco>
      )}

      {n === 6 && (
        <>
          <Bloco titulo="Revisão">
            <dl className="border-linha bg-papel-alto rounded-sm border p-4">
              <Linha etiqueta="Sociedade" valor={dados.nome} />
              <Linha etiqueta="NIPC" valor={dados.nif} />
              <Linha etiqueta="Forma jurídica" valor={dados.naturezaJuridica} />
              <Linha etiqueta="N.º na Ordem" valor={dados.numeroOrdem} />
              <Linha etiqueta="Sede" valor={dados.morada} />
              <Linha etiqueta="Email geral" valor={dados.emailGeral} />
              <Linha
                etiqueta="Termos e Condições"
                valor={dados.termosVersao ? `versão ${dados.termosVersao}` : null}
              />
              <Linha etiqueta="Administrador" valor={dados.adminNome} />
              <Linha etiqueta="Email do administrador" valor={dados.adminEmail} />
            </dl>
            <p className="text-xs text-muted-foreground">
              Para corrigir alguma coisa, use os passos na lombada — o que já está gravado não se
              perde.
            </p>
          </Bloco>

          <Bloco titulo="Declaração">
            <div className="grid gap-4 sm:grid-cols-2">
              <CampoTexto
                etiqueta="O seu nome"
                nome="declaracaoNome"
                erros={erros}
                obrigatorio
                valorInicial={dados.declaracaoNome ?? ""}
              />
              <CampoTexto
                etiqueta="O seu cargo na sociedade"
                nome="declaracaoCargo"
                erros={erros}
                obrigatorio
                valorInicial={dados.declaracaoCargo ?? ""}
              />
            </div>
            <CampoCaixa
              nome="declaracaoVinculo"
              erros={erros}
              valorInicial={dados.declaracaoVinculo}
              etiqueta={
                <>
                  Declaro que tenho poderes para vincular a sociedade, que os dados indicados são
                  verdadeiros e que o documento anexado no passo 4 corresponde aos Termos e
                  Condições em vigor da sociedade.
                </>
              }
            />
          </Bloco>

          <Bloco titulo="Privacidade e dados pessoais">
            <p className="text-sm text-muted-foreground">
              Os dados indicados neste registo — da sociedade e da pessoa que o submete — são
              tratados pela plataforma LexFlow para criar e gerir a conta. O consentimento fica
              registado com data e hora no momento da submissão.
            </p>
            <CampoCaixa
              nome="consentimentoPrivacidade"
              erros={erros}
              valorInicial={dados.consentimentoPrivacidade}
              etiqueta={
                <>
                  Li e aceito a{" "}
                  <Link
                    href="/privacidade"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2"
                  >
                    Política de Privacidade
                  </Link>{" "}
                  e os{" "}
                  <Link
                    href="/termos"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2"
                  >
                    Termos de Utilização
                  </Link>{" "}
                  da plataforma e autorizo o tratamento dos dados pessoais indicados para a criação
                  e gestão da conta da sociedade.
                </>
              }
            />
          </Bloco>
        </>
      )}

      <Separator />

      <div className="flex flex-wrap items-center justify-between gap-3">
        {anterior ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push(`/sociedade/${token}/passo/${anterior}`)}
          >
            Voltar
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={aGuardar}>
          {aGuardar ? "A guardar…" : eUltimo ? "Submeter registo" : "Guardar e continuar"}
        </Button>
      </div>
    </form>
  );
}
