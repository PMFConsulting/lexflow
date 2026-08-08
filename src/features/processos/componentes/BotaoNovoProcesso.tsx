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
import { cn } from "@/lib/utils";
import { criarProcesso } from "../acoes";

/**
 * Cria um processo e mostra o link mágico uma única vez.
 *
 * Uma única vez a sério: o token só existe em claro aqui. Se a página for
 * recarregada, ele desaparece — na base de dados só há o hash.
 *
 * Com o email do cliente preenchido, o link segue também na mensagem
 * "JMASSANO | Registro". O campo é opcional de propósito: continua a haver
 * casos em que o link se entrega por outra via, e obrigar a um email para
 * poder criar o processo era trocar uma comodidade por um bloqueio.
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
  link: string;
  emailEnviado: boolean;
  para: string;
};

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
  const idEmail = useId();
  const [aCriar, transicao] = useTransition();
  const [tipoCliente, setTipoCliente] = useState<TipoCliente>("particular");
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [erroEmail, setErroEmail] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const criar = () => {
    const destinatario = email.trim().toLowerCase();

    // Um endereço mal escrito chegava ao servidor, o envio falhava em silêncio
    // e o processo nascia sem que ninguém percebesse porquê. Vale mais dizê-lo
    // aqui, antes de haver processo criado.
    if (destinatario && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destinatario)) {
      setErroEmail("Falta o @ ou o domínio — por exemplo nome@empresa.pt.");
      return;
    }
    setErroEmail(null);

    transicao(async () => {
      setErro(null);
      const r = await criarProcesso(tipoCliente, destinatario || undefined, nome.trim() || undefined);
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      setResultado({
        referencia: r.referencia,
        link: `${window.location.origin}/onboarding/${r.token}`,
        emailEnviado: r.emailEnviado,
        para: destinatario,
      });
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
            <Ref>{resultado.referencia}</Ref> · {tipoCliente === "empresa" ? "Empresa" : "Pessoa Singular"}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {resultado.para && (
            <p
              className={cn(
                "flex items-start gap-2 rounded-sm border p-3 text-xs",
                resultado.emailEnviado
                  ? "border-arquivo/40 bg-arquivo/5 text-arquivo"
                  : "border-selo/40 bg-selo/5 text-selo",
              )}
            >
              {resultado.emailEnviado ? (
                <Mail className="mt-px size-3.5 shrink-0" />
              ) : (
                <TriangleAlert className="mt-px size-3.5 shrink-0" />
              )}
              <span>
                {resultado.emailEnviado
                  ? `Email «JMASSANO | Registro» enviado para ${resultado.para}.`
                  : `Não foi possível enviar o email para ${resultado.para}. Copie o link e envie-o à mão.`}
              </span>
            </p>
          )}

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
                onClick={() => setTipoCliente(o.v)}
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
              Nome do cliente <span className="text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              id={idNome}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Maria Silva"
              className="h-9"
            />
          </div>

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
                setErroEmail(null);
              }}
              placeholder="maria@exemplo.pt"
              className="h-9"
              aria-invalid={Boolean(erroEmail)}
              aria-describedby={erroEmail ? `${idEmail}-erro` : `${idEmail}-ajuda`}
            />
            {erroEmail ? (
              <p id={`${idEmail}-erro`} className="text-selo text-xs" role="alert">
                {erroEmail}
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
