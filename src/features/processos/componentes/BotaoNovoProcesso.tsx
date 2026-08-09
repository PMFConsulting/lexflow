"use client";

import { useId, useState, useTransition } from "react";
import { Check, Copy, ExternalLink, Mail, Plus, TriangleAlert } from "lucide-react";
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
    d: "Cliente individual ou particular",
  },
  {
    v: "empresa",
    t: "Empresa / Entidade Coletiva",
    d: "Sociedade comercial ou outra pessoa coletiva",
  },
] as const;

type TipoCliente = (typeof TIPOS)[number]["v"];

type Resultado = {
  referencia: string;
  nome: string;
  nif: string;
  link: string;
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
          link: `${window.location.origin}/onboarding/${r.token}`,
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

  const copiar = async () => {
    if (!resultado) return;
    await navigator.clipboard.writeText(resultado.link);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1800);
  };

  if (resultado) {
    return (
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Processo criado</DialogTitle>
          <DialogDescription>
            <Ref>{resultado.referencia}</Ref> ·{" "}
            {tipoCliente === "empresa" ? "Empresa" : "Pessoa Singular"}
            {resultado.nome && ` · ${resultado.nome}`}
            {resultado.nif && (
              <>
                {" · "}
                <Ref>{resultado.nif}</Ref>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {resultado.para && <AvisoEmail r={resultado} />}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="np-link" className="text-tinta-suave">
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
              <Button type="button" variant="outline" size="lg" onClick={copiar}>
                {copiado ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copiado ? "Copiado" : "Copiar"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Envie este link ao cliente. Não volta a ser mostrado — na base de dados fica
              só o resumo criptográfico. Expira em 30 dias.
            </p>
          </div>

          <a
            href={resultado.link}
            className="text-arquivo inline-flex w-fit items-center gap-1.5 text-sm underline underline-offset-4"
            target="_blank"
            rel="noopener"
          >
            Abrir o formulário
            <ExternalLink className="size-3.5" />
          </a>
        </DialogBody>

        <DialogFooter>
          <Button type="button" size="lg" onClick={aoFechar}>
            Concluir
          </Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Novo processo</DialogTitle>
        <DialogDescription>
          Cria o processo e gera o link de preenchimento para o cliente.
        </DialogDescription>
      </DialogHeader>

      <DialogBody>
        {/* Escolha única, e não dois interruptores: `role="radiogroup"` com
            setas do teclado é o que um leitor de ecrã espera aqui. As duas
            fichas repetem o padrão do passo 1 do onboarding — mesma pergunta,
            mesma forma. */}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Quem é o cliente final?</legend>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Tipo de cliente">
            {TIPOS.map((o) => (
              <button
                key={o.v}
                type="button"
                role="radio"
                aria-checked={tipoCliente === o.v}
                onClick={() => trocarTipo(o.v)}
                className={cn(
                  "border-linha bg-papel-alto rounded-sm border p-3 text-left transition-colors",
                  tipoCliente === o.v
                    ? "border-tinta ring-tinta ring-1"
                    : "hover:border-tinta-suave",
                )}
              >
                <span className="block text-sm font-medium">{o.t}</span>
                <span className="block text-xs text-muted-foreground">{o.d}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={idNome} className="text-tinta-suave">
              {empresa ? (
                "Denominação social"
              ) : (
                <>
                  Nome do cliente <span className="text-muted-foreground">(opcional)</span>
                </>
              )}
            </Label>
            <Input
              id={idNome}
              value={nome}
              onChange={(e) => {
                setNome(e.target.value);
                setErros((s) => ({ ...s, nome: undefined }));
              }}
              placeholder={empresa ? "Silva & Costa, Lda." : "Maria Silva"}
              className="h-9"
              aria-invalid={Boolean(erros.nome)}
              aria-describedby={erros.nome ? `${idNome}-erro` : undefined}
            />
            {erros.nome && (
              <p id={`${idNome}-erro`} className="text-selo text-xs" role="alert">
                {erros.nome}
              </p>
            )}
          </div>

          {/* Só à pessoa coletiva, e obrigatório: é pelo NIPC que a sociedade
              identifica a entidade antes de o cliente tocar no formulário. A
              uma pessoa singular não se pergunta — o NIF dela vem no passo 2,
              declarado por ela. */}
          {empresa && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={idNif} className="text-tinta-suave">
                NIPC
              </Label>
              <Input
                id={idNif}
                inputMode="numeric"
                value={nif}
                onChange={(e) => {
                  setNif(e.target.value);
                  setErros((s) => ({ ...s, nif: undefined }));
                }}
                placeholder="500000000"
                className="h-9 font-mono"
                aria-invalid={Boolean(erros.nif)}
                aria-describedby={erros.nif ? `${idNif}-erro` : undefined}
              />
              {erros.nif && (
                <p id={`${idNif}-erro`} className="text-selo text-xs" role="alert">
                  {erros.nif}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={idEmail} className="text-tinta-suave">
              Email para enviar o link <span className="text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              id={idEmail}
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setErros((s) => ({ ...s, email: undefined }));
              }}
              placeholder="maria@exemplo.pt"
              className="h-9"
              aria-invalid={Boolean(erros.email)}
              aria-describedby={erros.email ? `${idEmail}-erro` : `${idEmail}-ajuda`}
            />
            {erros.email ? (
              <p id={`${idEmail}-erro`} className="text-selo text-xs" role="alert">
                {erros.email}
              </p>
            ) : (
              <p id={`${idEmail}-ajuda`} className="text-xs text-muted-foreground">
                Com email preenchido, o link segue na mensagem «JMASSANO | Registro». Sem
                email, fica só no ecrã para copiar.
              </p>
            )}
          </div>
        </div>

        {erro && (
          <p
            className="border-selo/40 bg-selo/5 text-selo rounded-sm border p-3 text-sm"
            role="alert"
          >
            {erro}
          </p>
        )}
      </DialogBody>

      <DialogFooter>
        <Button type="button" variant="outline" size="lg" onClick={aoFechar}>
          Cancelar
        </Button>
        <Button type="button" size="lg" onClick={criar} disabled={aCriar}>
          <Plus className="size-4" />
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
