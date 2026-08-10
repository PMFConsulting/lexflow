"use client";

import { useId, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import {
  Building2,
  Check,
  CircleCheck,
  Copy,
  ExternalLink,
  FilePlus,
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
import { validarNif } from "@/lib/validacao-pt";
import { cn } from "@/lib/utils";
import { criarProcesso } from "../acoes";
import type { NovoProcesso } from "../schemas";

/**
 * Cria um processo e mostra o link mágico uma única vez.
 *
 * Uma única vez a sério: o token só existe em claro aqui. Se a página for
 * recarregada, ele desaparece — na base de dados só há o hash.
 *
 * **Os campos mudam com o tipo de cliente.** Perguntar "Nome do cliente" a uma
 * sociedade comercial era perguntar a coisa errada e ficar sem a certa: uma
 * entidade coletiva identifica-se pela denominação social e pelo NIPC, e são
 * esses dois que a sociedade tem à frente quando abre o dossier. Numa pessoa
 * singular mantém-se o que estava — nome e email, os dois opcionais, porque
 * quem cria o processo pode ter à frente só um endereço.
 *
 * Com o email preenchido, o link segue também na mensagem "JMASSANO | Registro".
 * O campo é opcional nos dois percursos de propósito: continua a haver casos em
 * que o link se entrega por outra via, e obrigar a um email para poder criar o
 * processo era trocar uma comodidade por um bloqueio.
 *
 * É uma janela e não um bloco no meio da página: aberto em linha, o formulário
 * empurrava o cabeçalho do painel para baixo e ficava com a largura do sítio
 * onde calhasse estar — encostado à direita no painel, centrado dentro do
 * cartão vazio. Numa janela, o mesmo formulário tem sempre a mesma forma.
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
   * O link **que o servidor montou**, o mesmo que seguiu no email.
   *
   * Era construído aqui, com `window.location.origin`, enquanto o do email saía
   * dos cabeçalhos do pedido. Coincidem quase sempre — e quando não coincidem
   * (back-office aberto por `localhost`, por um túnel, por um IP, por um
   * segundo domínio a apontar à mesma instalação) passam a existir dois links
   * para o mesmo processo, e o que a sociedade copia do ecrã não é o que o
   * cliente consegue abrir.
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
   * O que o **servidor** recebeu. Não é o mesmo que `para`, e é por não ser o
   * mesmo que esta propriedade existe: um endereço escrito na caixa que não
   * chega à Server Action produz exatamente o ecrã de um envio falhado, e não
   * se resolve no mesmo sítio — um é recarregar a página, o outro é ir ao
   * Resend. Ver a nota do banner.
   */
  paraServidor: string | null;
};

/** Os erros por campo, para o aviso ficar por baixo da caixa que o causou. */
type Erros = Partial<Record<"nome" | "nif" | "email", string>>;

export function BotaoNovoProcesso({ tamanho = "default" }: { tamanho?: "default" | "sm" }) {
  const [aberto, setAberto] = useState(false);

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button size={tamanho}>
          <Plus className="size-4" />
          Novo processo
        </Button>
      </DialogTrigger>

      {/* Montado só enquanto está aberto: é o que garante que a janela volta a
          abrir limpa depois de um processo criado, em vez de ficar presa no
          ecrã do link anterior. */}
      {aberto && <Conteudo aoFechar={() => setAberto(false)} />}
    </Dialog>
  );
}

/**
 * O cabeçalho da janela: emblema, título e uma linha que diz o que vai
 * acontecer ao carregar no botão.
 *
 * O emblema não é decoração — é o que dá à janela uma âncora visual à esquerda
 * do título e o que distingue de relance o ecrã do formulário do ecrã do
 * processo criado, que partilham a mesma moldura. O tom carrega o sentido: a
 * terracota da marca no formulário, o verde-arquivo no processo já criado.
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
 * Um campo da janela: etiqueta, caixa, e por baixo o erro *ou* a ajuda.
 *
 * Os três campos escreviam este mesmo bloco à mão, e divergiam — um tinha linha
 * de ajuda, os outros não, e a marca de obrigatório era um "(opcional)" em
 * texto corrido só num deles. Aqui a etiqueta diz sempre o mesmo tipo de coisa
 * no mesmo sítio: `*` a carmim quando é obrigatório, uma pastilha cinzenta
 * "Opcional" quando não é.
 *
 * A pastilha é cinzenta e em caixa de frase de propósito. O que aqui estava —
 * `OPCIONAL` em versalete, mono e espaçado — tinha o peso de um aviso e lia-se
 * com mais força do que o próprio nome do campo, quando a coisa que anuncia é
 * precisamente a menos importante da linha. O versalete continua a ser a voz
 * dos rótulos de arquivo (Carimbos, cabeçalhos de tabela); dentro de um
 * formulário não é.
 *
 * Sem `placeholder` nos campos: a linha de ajuda é o único texto de apoio. Com
 * os dois, "Nome do cliente" tinha por baixo "Nome completo do cliente" dentro
 * da caixa e uma terceira frase por baixo dela — três maneiras de dizer o
 * mesmo, e a única que carrega informação a sério é a de baixo, que é também a
 * única que não desaparece ao começar a escrever e a única que um leitor de
 * ecrã anuncia como ajuda (`aria-describedby`).
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

function Conteudo({ aoFechar }: { aoFechar: () => void }) {
  const idNome = useId();
  const idNif = useId();
  const idEmail = useId();
  const [aCriar, transicao] = useTransition();
  const [tipoCliente, setTipoCliente] = useState<TipoCliente>("particular");
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [nif, setNif] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [erros, setErros] = useState<Erros>({});
  const [copiado, setCopiado] = useState(false);
  /** As duas fichas, para as setas do teclado poderem levar o foco com elas. */
  const fichas = useRef<(HTMLButtonElement | null)[]>([]);

  const empresa = tipoCliente === "empresa";

  /**
   * Trocar de tipo apaga os erros, não os valores.
   *
   * Os erros são do percurso anterior — um "O NIPC é obrigatório" a ficar por
   * baixo de um formulário que já não pede NIPC é um bloqueio inventado. Os
   * valores ficam: quem se enganou no tipo e volta atrás não tem de reescrever
   * o nome nem o email, que são a mesma pergunta nos dois percursos.
   */
  const trocarTipo = (v: TipoCliente) => {
    setTipoCliente(v);
    setErros({});
    setErro(null);
  };

  /**
   * Setas a mudar de ficha, e o foco a ir com a escolha.
   *
   * Um `role="radiogroup"` promete isto a quem navega por teclado: `Tab` entra
   * no grupo uma vez e as setas percorrem-no. Sem o `tabIndex` móvel e sem este
   * `onKeyDown`, o grupo anunciava-se como radiogroup e comportava-se como dois
   * botões soltos — que é a forma de acessibilidade que engana quem confia nela.
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

    // A validação daqui é conforto — a decisão é do servidor, no mesmo schema.
    // Vale a pena mesmo assim: um endereço mal escrito chegava ao servidor, o
    // envio falhava em silêncio e o processo nascia sem que ninguém percebesse
    // porquê. Um NIPC com um dígito trocado seria pior, porque fica gravado.
    const novos: Erros = {};

    if (empresa) {
      if (nomeLimpo.length < 2) {
        novos.nome = "Indique a denominação social da entidade.";
      }
      const r = validarNif(nifLimpo);
      if (!r.valido) novos.nif = r.mensagem;
    }
    if (destinatario && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destinatario)) {
      novos.email = "Falta o @ ou o domínio — por exemplo nome@empresa.pt.";
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
        const r = await criarProcesso(entrada);
        if (!r.ok) {
          // O servidor diz qual foi o campo quando o problema é de um campo. Sem
          // isso, o aviso ia todo para o fundo da janela e obrigava a procurar.
          if (r.campo === "nome" || r.campo === "nif" || r.campo === "email") {
            setErros({ [r.campo]: r.erro });
          } else {
            setErro(r.erro);
          }
          return;
        }
        setResultado({
          referencia: r.referencia,
          nome: nomeLimpo,
          nif: empresa ? nifLimpo : "",
          // Só se completa o que o servidor não conseguiu apurar: quando ele
          // não chegou ao anfitrião, o link vem relativo (`/onboarding/…`) e a
          // origem desta janela é o melhor palpite que resta. Nos outros casos
          // usa-se o dele à letra, que é o que o cliente tem na caixa.
          link: r.link.startsWith("/") ? `${window.location.origin}${r.link}` : r.link,
          linkVerificado: r.linkVerificado,
          emailEnviado: r.emailEnviado,
          erroEmail: r.erroEmail,
          para: destinatario,
          paraServidor: r.paraServidor,
        });
      } catch (e) {
        // Uma Server Action que rebenta rejeita esta promessa, e sem `catch` a
        // rejeição ficava por tratar dentro da transição: o botão saía de
        // "A criar…" e não acontecia mais nada — nem link, nem aviso. É este o
        // silêncio que faz uma falha de servidor parecer um clique perdido.
        //
        // O caso mais comum não é sequer um defeito nosso: um separador aberto
        // de antes de um deploy manda um identificador de ação que o servidor
        // já não conhece ("Failed to find Server Action…"), e a única saída é
        // recarregar a página.
        console.error("[novo processo] a Server Action falhou", e);
        setErro(
          "O servidor não respondeu ao pedido. Recarregue a página e tente outra vez — " +
            "se a aplicação foi atualizada há pouco, é isso.",
        );
      }
    });
  };

  /**
   * `Enter` numa caixa cria o processo.
   *
   * Isto não é um `<form>` — os campos são controlados e a criação passa por uma
   * Server Action chamada à mão —, e sem este atalho o `Enter` não fazia
   * absolutamente nada, que é o comportamento que faz um formulário parecer
   * avariado a quem preenche sem tirar as mãos do teclado.
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

          {/* Primeiro que tudo, porque desmente o resto do ecrã: se o link não
              abre, a referência e o email por baixo dele são detalhes. */}
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
        {/* Escolha única, e não dois interruptores: `role="radiogroup"` com
            setas do teclado é o que um leitor de ecrã espera aqui. As duas
            fichas repetem o padrão do passo 1 do onboarding — mesma pergunta,
            mesma forma. */}
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
                  // A borda é `tinta/15` e não `linha`: sobre o branco da janela
                  // o cinzento-régua do dossier quase não se vê, e uma ficha
                  // sem contorno não se lê como coisa em que se carrega. A
                  // escolhida é a terracota da marca — a tinta que aqui estava
                  // é a cor do texto à volta, e um contorno da cor do texto diz
                  // "moldura", não "escolhido".
                  className={cn(
                    "group bg-papel-alto relative flex h-full items-start gap-3 rounded-sm border p-3.5 pr-9 text-left transition-all duration-150 outline-none",
                    "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3",
                    escolhido
                      ? "border-marca bg-marca/5 ring-marca/25 shadow-xs ring-2"
                      : "border-tinta/15 hover:border-tinta-suave/60 hover:bg-muted/40 hover:shadow-xs",
                  )}
                >
                  {/* `mt-px` e não alinhamento ao centro: o emblema encosta à
                      linha do título, como no cabeçalho da janela. */}
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

        {/* `Enter` em qualquer caixa cria o processo — ver `aoTeclarNoCampo`.
            A régua por cima separa a escolha do tipo dos campos que ela
            comanda: sem ela, o "Denominação social" que aparece e desaparece ao
            trocar de ficha lia-se como parte do mesmo bloco. */}
        <div
          className="border-linha flex flex-col gap-4 border-t pt-5"
          onKeyDown={aoTeclarNoCampo}
        >
          <Campo
            id={idNome}
            etiqueta={empresa ? "Denominação social" : "Nome do cliente"}
            opcional={!empresa}
            erro={erros.nome}
            // Duas frases inteiras, e não um travessão adentro: a segunda
            // metade caía sozinha para a linha de baixo e lia-se como um texto
            // cortado a começar em minúscula.
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

          {/* Só à pessoa coletiva, e obrigatório: é pelo NIPC que a sociedade
              identifica a entidade antes de o cliente tocar no formulário. A
              uma pessoa singular não se pergunta — o NIF dela vem no passo 2,
              declarado por ela. */}
          {empresa && (
            <Campo
              id={idNif}
              etiqueta="NIPC"
              erro={erros.nif}
              ajuda="Nove dígitos, sem espaços. O dígito de controlo é verificado aqui."
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

      {/* No telemóvel os dois botões empilham-se a largura inteira (alvo de
          toque de 44px+), com o "Criar processo" no fundo — é a ação que se
          quer alcançar com o polegar. Em ecrãs maiores voltam a ficar lado a
          lado à direita. */}
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
          // A ação principal da janela pesa mais do que o "Cancelar" ao lado:
          // mais alta do que a `size="lg"` de série, largura fixa (que não
          // encolhe ao trocar o rótulo por "A criar…"), respiro nos lados e a
          // sombra que a levanta do rodapé. Os dois à mesma altura, senão o
          // rodapé fica com dois patamares.
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
 * O que aconteceu ao email, em três estados e não em dois.
 *
 * Os dois estados que aqui estavam — enviado / não enviado — juntavam num só
 * ecrã duas avarias que não se resolvem no mesmo sítio, e foi essa confusão
 * que custou a investigação de 09/08:
 *
 *   · **o servidor não recebeu endereço nenhum.** A caixa tinha um endereço,
 *     a Server Action recebeu `undefined`, o `if (emailCliente)` de
 *     `criarProcesso` nem chegou a abrir e por isso não há linha nenhuma em
 *     `email_log` — o `/emails` fica a «0 mensagens» *com toda a razão*. A
 *     causa é do lado do pedido (quase sempre um separador aberto de antes de
 *     um deploy, que manda uma ação que o servidor já não conhece), e a saída
 *     é recarregar a página. Ir procurar isto no painel do Resend é procurar
 *     no sítio errado durante horas;
 *   · **o servidor recebeu o endereço e o envio falhou.** Há linha no
 *     `/emails`, com o motivo, e é lá e no Resend que se resolve.
 *
 * A comparação é entre o que se escreveu na caixa e o que o servidor devolve
 * ter recebido, e não entre `emailEnviado` e nada — é a única maneira de a
 * janela saber de que lado da linha a mensagem se perdeu.
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
            {/* O motivo à vista, e não só nos logs do contentor. Um domínio por
                verificar no Resend, uma chave em falta e uma saída para a
                Internet fechada dizem-se todos "não foi possível enviar", e são
                três coisas diferentes de resolver. */}
            {r.erroEmail && (
              <span className="font-mono break-all opacity-80">{r.erroEmail}</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
