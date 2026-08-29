"use client";

import { useId, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import {
  Building2,
  Check,
  CircleCheck,
  Copy,
  ExternalLink,
  FilePlus,
  FileText,
  LoaderCircle,
  Mail,
  Plus,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Ref } from "@/components/ref-processo";
import { validarNipc } from "@/lib/validacao-pt";
import { cn } from "@/lib/utils";
import { criarProcesso } from "../acoes";
import { carregarPropostaComercial } from "../proposta";
import type { NovoProcesso } from "../schemas";

/**
 * Cria um processo e mostra o link mágico uma única vez — o token só existe em
 * claro aqui; recarregar a página perde-o, porque só o hash fica na BD.
 *
 * Os campos variam com o tipo de cliente: pessoa coletiva pede denominação
 * social e NIPC, pessoa singular mantém nome e email, os dois opcionais.
 *
 * O email é opcional nos dois casos — o link pode ser entregue por outra via.
 * Com email preenchido, segue também por "JMASSANO | Registro".
 *
 * Dialog e não bloco inline (D36): aberto em linha, o formulário herdava a
 * largura e o alinhamento de onde calhasse estar.
 */

const TIPOS = [
  {
    v: "particular",
    t: "Pessoa Singular",
    d: "Cliente individual, identificado pelo NIF.",
    icone: UserRound,
  },
  {
    v: "empresa",
    t: "Empresa",
    d: "Sociedade ou outra pessoa coletiva, com NIPC.",
    icone: Building2,
  },
] as const;

type TipoCliente = (typeof TIPOS)[number]["v"];

type Resultado = {
  referencia: string;
  nome: string;
  nif: string;
  /**
   * O link devolvido pelo servidor (D48), não reconstruído aqui com
   * `window.location.origin` — que diverge quando o back-office abre por
   * localhost, túnel ou outro domínio.
   */
  link: string;
  /** A falso, o processo existe mas o link não resolve. Ver o aviso. */
  linkVerificado: boolean;
  emailEnviado: boolean;
  /** O motivo, quando o email não saiu. Vem do servidor. */
  erroEmail?: string;
  /** O que se escreveu na caixa. */
  para: string;
  /**
   * O endereço que o servidor recebeu (D44), para comparar com `para`: um
   * email escrito na caixa que não chega à Server Action dá o mesmo ecrã de
   * envio falhado, mas resolve-se de forma diferente. Ver `AvisoEmail`.
   */
  paraServidor: string | null;
  /**
   * A proposta comercial obrigatória do processo.
   */
  proposta: { nome: string; ok: boolean; erro?: string } | null;
};

/** Os erros por campo, para o aviso ficar por baixo da caixa que o causou. */
type Erros = Partial<Record<"nome" | "nif" | "email" | "proposta", string>>;

/** O mesmo limite do servidor (`carregarPropostaComercial`), para o dizer antes da subida. */
const MAX_PROPOSTA = 4 * 1024 * 1024;

export function BotaoNovoProcesso({
  tamanho = "default",
  organizacaoId,
}: {
  tamanho?: "default" | "sm";
  organizacaoId?: string;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button size={tamanho}>
          <Plus className="size-4" />
          Novo processo
        </Button>
      </DialogTrigger>

      {/* Montado só quando aberto: garante que reabre limpo, em vez de ficar
          preso no ecrã do link anterior. */}
      {aberto && (
        <Conteudo
          organizacaoId={organizacaoId}
          aoFechar={() => setAberto(false)}
        />
      )}
    </Dialog>
  );
}

/**
 * Cabeçalho da janela: emblema, título e uma linha de contexto.
 *
 * O tom distingue de relance o ecrã do formulário do ecrã do processo criado —
 * terracota da marca (D45) num, verde-arquivo no outro.
 */
function Cabecalho({
  icone: Icone,
  tom = "marca",
  titulo,
  children,
}: {
  icone: typeof FilePlus;
  tom?: "marca" | "arquivo";
  titulo: string;
  children: ReactNode;
}) {
  return (
    <DialogHeader className="flex-row items-start gap-3 py-4.5">
      <span
        aria-hidden="true"
        className={cn(
          "mt-px flex size-9 shrink-0 items-center justify-center rounded-sm border",
          tom === "arquivo"
            ? "border-arquivo/30 bg-arquivo/10 text-arquivo"
            : "border-marca/30 bg-marca/10 text-marca",
        )}
      >
        <Icone className="size-4.5" />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <DialogTitle className="text-lg leading-6 tracking-tight">{titulo}</DialogTitle>
        <DialogDescription className="text-xs leading-relaxed">{children}</DialogDescription>
      </div>
    </DialogHeader>
  );
}

/**
 * Um campo da janela: etiqueta, caixa e por baixo o erro ou a ajuda.
 *
 * Substitui três blocos escritos à mão que divergiam entre si. Pastilha
 * "Opcional" em vez de "(opcional)" em texto corrido, e caixa de frase em vez
 * de versalete — dentro de um formulário, versalete lê-se como aviso, não
 * como rótulo.
 *
 * Sem `placeholder`: a linha de ajuda é o único texto de apoio, e é a única
 * que um leitor de ecrã anuncia via `aria-describedby`.
 */
function Campo({
  id,
  etiqueta,
  opcional,
  erro,
  ajuda,
  children,
}: {
  id: string;
  etiqueta: string;
  opcional?: boolean;
  erro?: string;
  ajuda?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-tinta gap-1.5 text-sm font-medium">
        {etiqueta}
        {opcional ? (
          <span className="border-linha bg-muted/60 text-2xs rounded-full border px-1.5 py-px font-normal text-muted-foreground">
            Opcional
          </span>
        ) : (
          <>
            <span className="text-selo" aria-hidden="true">
              *
            </span>
            <span className="sr-only">obrigatório</span>
          </>
        )}
      </Label>

      {children}

      {erro ? (
        <p id={`${id}-erro`} className="text-selo flex items-start gap-1.5 text-xs" role="alert">
          <TriangleAlert className="mt-px size-3 shrink-0" />
          <span>{erro}</span>
        </p>
      ) : (
        ajuda && (
          <p id={`${id}-ajuda`} className="text-xs leading-relaxed text-muted-foreground">
            {ajuda}
          </p>
        )
      )}
    </div>
  );
}

function Conteudo({
  aoFechar,
  organizacaoId,
}: {
  aoFechar: () => void;
  organizacaoId?: string;
}) {
  const idNome = useId();
  const idNif = useId();
  const idEmail = useId();
  const idProposta = useId();
  const [aCriar, transicao] = useTransition();
  const [tipoCliente, setTipoCliente] = useState<TipoCliente>("particular");
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [nif, setNif] = useState("");
  const [proposta, setProposta] = useState<File | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [erros, setErros] = useState<Erros>({});
  const [copiado, setCopiado] = useState(false);
  /** As duas fichas, para as setas do teclado poderem levar o foco com elas. */
  const fichas = useRef<(HTMLButtonElement | null)[]>([]);

  const empresa = tipoCliente === "empresa";

  /**
   * Trocar de tipo limpa os erros do percurso anterior, não os valores —
   * quem se enganou no tipo não tem de reescrever nome e email.
   */
  const trocarTipo = (v: TipoCliente) => {
    setTipoCliente(v);
    setErros({});
    setErro(null);
  };

  /**
   * Setas movem entre fichas e levam o foco com elas — o que um
   * `role="radiogroup"` promete a quem navega por teclado.
   */
  const navegar = (e: KeyboardEvent<HTMLButtonElement>, indice: number) => {
    const avanca = e.key === "ArrowRight" || e.key === "ArrowDown";
    const recua = e.key === "ArrowLeft" || e.key === "ArrowUp";
    if (!avanca && !recua) return;
    e.preventDefault();
    const seguinte = (indice + (avanca ? 1 : -1) + TIPOS.length) % TIPOS.length;
    trocarTipo(TIPOS[seguinte].v);
    fichas.current[seguinte]?.focus();
  };

  const criar = () => {
    const destinatario = email.trim().toLowerCase();
    const nomeLimpo = nome.trim();
    const nifLimpo = nif.trim();

    // Validação de conforto — a decisão fica no schema do servidor. Evita um
    // envio que falha em silêncio por email mal escrito, e um NIPC com um
    // dígito trocado, que é pior porque fica gravado.
    const novos: Erros = {};

    if (empresa) {
      if (nomeLimpo.length < 2) {
        novos.nome = "Indique a denominação social da entidade.";
      }
      const r = validarNipc(nifLimpo);
      if (!r.valido) novos.nif = r.mensagem;
    }
    if (destinatario && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destinatario)) {
      novos.email = "Falta o @ ou o domínio — por exemplo nome@empresa.pt.";
    }
    // A proposta comercial é obrigatória: sem ela o processo não pode ser criado.
    if (!proposta) {
      novos.proposta = "Anexe a proposta comercial em PDF para criar o processo.";
    } else if (proposta.size > MAX_PROPOSTA) {
      novos.proposta = `A proposta tem ${(proposta.size / 1024 / 1024).toFixed(1)} MB. O máximo são 4 MB.`;
    } else if (!proposta.name.toLowerCase().endsWith(".pdf")) {
      novos.proposta = `«${proposta.name}» não é um PDF. A proposta comercial tem de ser um ficheiro PDF.`;
    }

    setErros(novos);
    if (Object.keys(novos).length) return;

    const entrada: NovoProcesso = empresa
      ? {
          tipoCliente: "empresa",
          nome: nomeLimpo,
          nif: nifLimpo,
          email: destinatario || undefined,
        }
      : {
          tipoCliente: "particular",
          nome: nomeLimpo || undefined,
          email: destinatario || undefined,
        };

    transicao(async () => {
      setErro(null);
      try {
        const r = await criarProcesso({ ...entrada, organizacaoId });
        if (!r.ok) {
          // O servidor diz o campo quando o erro é de um campo específico.
          if (r.campo === "nome" || r.campo === "nif" || r.campo === "email") {
            setErros({ [r.campo]: r.erro });
          } else {
            setErro(r.erro);
          }
          return;
        }

        /*
         * A proposta sobe depois de o processo existir — sem processo não há
         * onde a pendurar. Uma falha aqui não desfaz a criação (D52): o ecrã
         * seguinte mostra o link válido e diz separadamente se a proposta
         * entrou ou não.
         */
        let estadoProposta: Resultado["proposta"] = null;
        if (proposta) {
          const fd = new FormData();
          fd.set("ficheiro", proposta);
          try {
            const p = await carregarPropostaComercial(r.processoId, fd);
            estadoProposta = p.ok
              ? { nome: proposta.name, ok: true }
              : { nome: proposta.name, ok: false, erro: p.erro };
          } catch (e) {
            console.error("[novo processo] o upload da proposta rebentou", e);
            estadoProposta = {
              nome: proposta.name,
              ok: false,
              erro: "O servidor não respondeu ao envio do ficheiro.",
            };
          }
        }

        setResultado({
          referencia: r.referencia,
          nome: nomeLimpo,
          nif: empresa ? nifLimpo : "",
          // Só completa quando o link vem relativo: o servidor não apurou o
          // anfitrião e esta janela usa o melhor palpite. Nos outros casos usa
          // o link do servidor tal e qual (D48).
          link: r.link.startsWith("/") ? `${window.location.origin}${r.link}` : r.link,
          linkVerificado: r.linkVerificado,
          emailEnviado: r.emailEnviado,
          erroEmail: r.erroEmail,
          para: destinatario,
          paraServidor: r.paraServidor,
          proposta: estadoProposta,
        });
      } catch (e) {
        // Sem catch, a rejeição ficava por tratar dentro da transição: o botão
        // saía de "A criar…" sem link nem aviso. Causa mais comum: um
        // separador aberto de antes de um deploy, com um id de ação que o
        // servidor já não conhece ("Failed to find Server Action…").
        console.error("[novo processo] a Server Action falhou", e);
        setErro(
          "O servidor não respondeu ao pedido. Recarregue a página e tente outra vez — " +
            "se a aplicação foi atualizada há pouco, é isso.",
        );
      }
    });
  };

  /**
   * `Enter` numa caixa cria o processo — não é um `<form>`, os campos são
   * controlados e a criação passa por Server Action chamada à mão.
   */
  const aoTeclarNoCampo = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" || aCriar) return;
    e.preventDefault();
    criar();
  };

  const copiar = async () => {
    if (!resultado) return;
    await navigator.clipboard.writeText(resultado.link);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1800);
  };

  if (resultado) {
    return (
      <DialogContent>
        <Cabecalho icone={CircleCheck} tom="arquivo" titulo="Processo criado">
          O dossier está aberto e à espera do cliente. Guarde o link antes de fechar.
        </Cabecalho>

        <DialogBody>
          <dl className="border-linha bg-muted/40 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-sm border p-3 text-xs">
            <dt className="text-muted-foreground">Referência</dt>
            <dd>
              <Ref>{resultado.referencia}</Ref>
            </dd>
            <dt className="text-muted-foreground">Tipo</dt>
            <dd>{tipoCliente === "empresa" ? "Empresa" : "Pessoa Singular"}</dd>
            {resultado.nome && (
              <>
                <dt className="text-muted-foreground">
                  {tipoCliente === "empresa" ? "Denominação" : "Nome"}
                </dt>
                <dd className="min-w-0 break-words">{resultado.nome}</dd>
              </>
            )}
            {resultado.nif && (
              <>
                <dt className="text-muted-foreground">NIPC</dt>
                <dd>
                  <Ref>{resultado.nif}</Ref>
                </dd>
              </>
            )}
          </dl>

          {/* Vem primeiro porque desmente o resto do ecrã: se o link não abre,
              o resto são detalhes. */}
          {!resultado.linkVerificado && (
            <div
              className="border-selo/40 bg-selo/5 text-selo flex items-start gap-2 rounded-sm border p-3 text-xs"
              role="alert"
            >
              <TriangleAlert className="mt-px size-3.5 shrink-0" />
              <div className="flex min-w-0 flex-col gap-1">
                <span>
                  O processo foi criado, mas o link em baixo <strong>não abre</strong> — foi
                  experimentado contra a base de dados e não encontrou o dossier.
                </span>
                <span className="opacity-80">
                  Não o envie ao cliente. Crie o processo outra vez; se voltar a acontecer, o
                  problema é da base de dados e fica registado na auditoria deste processo.
                </span>
              </div>
            </div>
          )}

          {resultado.para && <AvisoEmail r={resultado} />}

          {resultado.proposta && (
            <div
              className={cn(
                "flex items-start gap-2 rounded-sm border p-3 text-xs",
                resultado.proposta.ok
                  ? "border-arquivo/40 bg-arquivo/5 text-arquivo"
                  : "border-selo/40 bg-selo/5 text-selo",
              )}
              role={resultado.proposta.ok ? undefined : "alert"}
            >
              {resultado.proposta.ok ? (
                <FileText className="mt-px size-3.5 shrink-0" />
              ) : (
                <TriangleAlert className="mt-px size-3.5 shrink-0" />
              )}
              <div className="flex min-w-0 flex-col gap-1">
                {resultado.proposta.ok ? (
                  <span>
                    Proposta comercial anexada ({resultado.proposta.nome}). É esta que o cliente
                    lê e aceita no último passo.
                  </span>
                ) : (
                  <>
                    <span>
                      O processo foi criado, mas a proposta <strong>não ficou anexada</strong>.
                      Falta anexar a proposta no detalhe do processo para o cliente poder continuar.
                    </span>
                    <span className="font-mono break-all opacity-80">
                      {resultado.proposta.erro}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="np-link" className="text-tinta text-sm font-medium">
              Link de preenchimento
            </Label>
            <div className="flex flex-wrap gap-2">
              <input
                id="np-link"
                readOnly
                value={resultado.link}
                onFocus={(e) => e.currentTarget.select()}
                className="border-linha bg-muted focus-visible:border-ring focus-visible:ring-ring/50 h-9 min-w-0 flex-1 rounded-sm border px-2.5 font-mono text-xs outline-none focus-visible:ring-3"
              />
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={copiar}
                className="min-w-24"
              >
                {copiado ? (
                  <Check className="text-arquivo size-3.5" />
                ) : (
                  <Copy className="size-3.5" />
                )}
                {copiado ? "Copiado" : "Copiar"}
              </Button>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Envie este link ao cliente. Não volta a ser mostrado — na base de dados fica
              só o resumo criptográfico. Expira em 30 dias.
            </p>
          </div>

          <a
            href={resultado.link}
            className="text-arquivo hover:text-arquivo/80 inline-flex w-fit items-center gap-1.5 text-sm underline underline-offset-4 transition-colors"
            target="_blank"
            rel="noopener"
          >
            Abrir o formulário
            <ExternalLink className="size-3.5" />
          </a>
        </DialogBody>

        <DialogFooter className="py-4">
          <Button
            type="button"
            size="lg"
            className="h-10 min-w-32 px-5 font-semibold shadow-sm"
            onClick={aoFechar}
          >
            Concluir
          </Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent>
      <Cabecalho icone={FilePlus} titulo="Novo processo">
        Abre o dossier e gera o link de preenchimento que o cliente usa para se identificar.
      </Cabecalho>

      <DialogBody>
        {/* `role="radiogroup"` com setas do teclado — mesmo padrão do passo 1
            do onboarding. */}
        <fieldset className="flex flex-col">
          <legend className="text-tinta mb-2.5 text-sm font-medium">
            Quem é o cliente final?
          </legend>
          <div
            className="grid gap-3 sm:grid-cols-2"
            role="radiogroup"
            aria-label="Tipo de cliente"
          >
            {TIPOS.map((o, i) => {
              const escolhido = tipoCliente === o.v;
              const Icone = o.icone;
              return (
                <button
                  key={o.v}
                  ref={(el) => {
                    fichas.current[i] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={escolhido}
                  tabIndex={escolhido ? 0 : -1}
                  onClick={() => trocarTipo(o.v)}
                  onKeyDown={(e) => navegar(e, i)}
                  // border-tinta/15 e não `linha`: sobre branco, o cinzento do
                  // dossier quase não se vê. Escolhido usa a marca (D45).
                  className={cn(
                    "group bg-papel-alto relative flex h-full items-start gap-3 rounded-sm border p-3.5 pr-9 text-left transition-all duration-150 outline-none",
                    "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3",
                    escolhido
                      ? "border-marca bg-marca/5 ring-marca/25 shadow-xs ring-2"
                      : "border-tinta/15 hover:border-tinta-suave/60 hover:bg-muted/40 hover:shadow-xs",
                  )}
                >
                  {/* `mt-px`: o emblema encosta à linha do título, como no
                      cabeçalho da janela. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-px flex size-8 shrink-0 items-center justify-center rounded-sm border transition-colors",
                      escolhido
                        ? "border-marca bg-marca text-papel-alto"
                        : "border-tinta/15 text-tinta-suave group-hover:border-tinta-suave/60 group-hover:text-tinta",
                    )}
                  >
                    <Icone className="size-4" />
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-tinta text-sm leading-5 font-medium">{o.t}</span>
                    <span className="text-xs leading-snug text-muted-foreground">{o.d}</span>
                  </span>
                  {escolhido && (
                    <Check
                      className="text-marca absolute top-3.5 right-3 size-4"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* `Enter` em qualquer caixa cria o processo (`aoTeclarNoCampo`). A
            régua separa a escolha do tipo dos campos que ela comanda. */}
        <div
          className="border-linha flex flex-col gap-4 border-t pt-5"
          onKeyDown={aoTeclarNoCampo}
        >
          <Campo
            id={idNome}
            etiqueta={empresa ? "Denominação social" : "Nome do cliente"}
            opcional={!empresa}
            erro={erros.nome}
            // Duas frases completas: a metade cortada caía sozinha para a
            // linha de baixo e lia-se como texto truncado.
            ajuda={
              empresa
                ? "Como consta na certidão permanente, com a forma jurídica incluída."
                : "Se ainda não souber, deixe em branco. O cliente identifica-se no passo 1."
            }
          >
            <Input
              id={idNome}
              value={nome}
              onChange={(e) => {
                setNome(e.target.value);
                setErros((s) => ({ ...s, nome: undefined }));
              }}
              className="h-9"
              aria-invalid={Boolean(erros.nome)}
              aria-describedby={erros.nome ? `${idNome}-erro` : `${idNome}-ajuda`}
            />
          </Campo>

          {/* Só para pessoa coletiva: é pelo NIPC que a sociedade identifica a
              entidade antes de o cliente tocar no formulário. */}
          {empresa && (
            <Campo
              id={idNif}
              etiqueta="NIPC"
              erro={erros.nif}
              ajuda="Nove dígitos, a começar por 5, 6, 8 ou 9. O dígito de controlo é verificado aqui."
            >
              <Input
                id={idNif}
                inputMode="numeric"
                value={nif}
                onChange={(e) => {
                  setNif(e.target.value);
                  setErros((s) => ({ ...s, nif: undefined }));
                }}
                className="h-9 font-mono tracking-tight tabular-nums"
                aria-invalid={Boolean(erros.nif)}
                aria-describedby={erros.nif ? `${idNif}-erro` : `${idNif}-ajuda`}
              />
            </Campo>
          )}

          <Campo
            id={idEmail}
            etiqueta="Email para enviar o link"
            opcional
            erro={erros.email}
            ajuda="Com email, o link segue na mensagem «JMASSANO | Registro». Sem email, fica só neste ecrã para copiar."
          >
            <Input
              id={idEmail}
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setErros((s) => ({ ...s, email: undefined }));
              }}
              className="h-9"
              aria-invalid={Boolean(erros.email)}
              aria-describedby={erros.email ? `${idEmail}-erro` : `${idEmail}-ajuda`}
            />
          </Campo>

          {/* A proposta comercial deste cliente. Obrigatória: é o documento que ele lê e aceita. */}
          <Campo
            id={idProposta}
            etiqueta="Proposta comercial"
            erro={erros.proposta}
            ajuda="PDF, até 4 MB. É o documento que o cliente lê e aceita no último passo."
          >
            <input
              id={idProposta}
              type="file"
              accept=".pdf,application/pdf"
              onChange={(e) => {
                setProposta(e.target.files?.[0] ?? null);
                setErros((s) => ({ ...s, proposta: undefined }));
              }}
              aria-invalid={Boolean(erros.proposta)}
              aria-describedby={erros.proposta ? `${idProposta}-erro` : `${idProposta}-ajuda`}
              className="file:bg-tinta file:text-papel-alto text-sm file:mr-3 file:rounded-sm file:border-0 file:px-3 file:py-1.5 file:text-sm"
            />
          </Campo>
        </div>

        {erro && (
          <p
            className="border-selo/40 bg-selo/5 text-selo flex items-start gap-2 rounded-sm border p-3 text-sm"
            role="alert"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{erro}</span>
          </p>
        )}
      </DialogBody>

      {/* No telemóvel os botões empilham a largura inteira (alvo de toque
          44px+), com "Criar processo" no fundo, ao alcance do polegar. */}
      <DialogFooter className="flex-col py-4 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={aoFechar}
          className="h-11 min-w-24 px-4 sm:h-10 sm:w-auto"
        >
          Cancelar
        </Button>
        <Button
          type="button"
          size="lg"
          onClick={criar}
          disabled={aCriar}
          // Ação principal mais alta e com largura fixa, para não encolher ao
          // trocar o rótulo por "A criar…".
          className="h-11 min-w-40 px-5 font-semibold shadow-sm sm:h-10 sm:w-auto"
        >
          {aCriar ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="size-4" aria-hidden="true" />
          )}
          {aCriar ? "A criar…" : "Criar processo"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/**
 * O que aconteceu ao email, em três estados.
 *
 * Servidor sem endereço nenhum (o `if` de `criarProcesso` nem abriu) e
 * servidor com endereço que falhou a enviar são avarias diferentes, com
 * resoluções diferentes — juntá-las custou a investigação de 09/08 (D44). A
 * comparação é entre o que se escreveu na caixa e o que o servidor diz ter
 * recebido (`paraServidor`).
 */
function AvisoEmail({ r }: { r: Resultado }) {
  const naoChegouAoServidor = Boolean(r.para) && !r.paraServidor;
  const bom = r.emailEnviado;

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-sm border p-3 text-xs",
        bom
          ? "border-arquivo/40 bg-arquivo/5 text-arquivo"
          : "border-selo/40 bg-selo/5 text-selo",
      )}
      role={bom ? undefined : "alert"}
    >
      {bom ? (
        <Mail className="mt-px size-3.5 shrink-0" />
      ) : (
        <TriangleAlert className="mt-px size-3.5 shrink-0" />
      )}
      <div className="flex min-w-0 flex-col gap-1">
        {bom && <span>Email «JMASSANO | Registro» enviado para {r.para}.</span>}

        {!bom && naoChegouAoServidor && (
          <>
            <span>
              O endereço <span className="font-mono">{r.para}</span> não chegou ao servidor —
              o envio nem foi tentado, e por isso não aparece nada em Emails.
            </span>
            <span className="opacity-80">
              Recarregue a página e crie o processo outra vez; se a aplicação foi atualizada
              há pouco, é isso. O processo em baixo já existe: copie o link e envie-o à mão.
            </span>
          </>
        )}

        {!bom && !naoChegouAoServidor && (
          <>
            <span>
              Não foi possível enviar o email para {r.paraServidor ?? r.para}. Copie o link e
              envie-o à mão — a tentativa fica registada em Emails, com o motivo.
            </span>
            {/* Motivo à vista, não só nos logs — domínio por verificar, chave
                em falta e saída fechada dizem-se todos "não foi possível
                enviar". */}
            {r.erroEmail && (
              <span className="font-mono break-all opacity-80">{r.erroEmail}</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
