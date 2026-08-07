"use client";

import { useState, useTransition } from "react";
import { Copy, Mail, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Ref } from "@/components/ref-processo";
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
 */
export function BotaoNovoProcesso({ tamanho = "default" }: { tamanho?: "default" | "sm" }) {
  const [aCriar, transicao] = useTransition();
  const [aberto, setAberto] = useState(false);
  const [tipoCliente, setTipoCliente] = useState<"particular" | "empresa">("particular");
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [resultado, setResultado] = useState<{
    referencia: string;
    link: string;
    emailEnviado: boolean;
    para: string;
  } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const criar = () =>
    transicao(async () => {
      setErro(null);
      const destinatario = email.trim().toLowerCase();
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

  const copiar = async () => {
    if (!resultado) return;
    await navigator.clipboard.writeText(resultado.link);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1800);
  };

  if (resultado) {
    return (
      <div className="border-arquivo/40 bg-arquivo/5 flex w-full flex-col gap-3 rounded-sm border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">
            Processo <Ref>{resultado.referencia}</Ref> criado
          </p>
          <a
            href={resultado.link}
            className="text-arquivo text-sm underline underline-offset-4"
            target="_blank"
            rel="noopener"
          >
            Abrir o formulário
          </a>
        </div>

        {resultado.para && (
          <p
            className={
              "flex items-center gap-1.5 text-xs " +
              (resultado.emailEnviado ? "text-arquivo" : "text-selo")
            }
          >
            <Mail className="size-3.5" />
            {resultado.emailEnviado
              ? `Email "JMASSANO | Registro" enviado para ${resultado.para}.`
              : `Não foi possível enviar o email para ${resultado.para}. Copie o link e envie-o à mão.`}
          </p>
        )}

        <div className="flex gap-2">
          <input
            readOnly
            value={resultado.link}
            onFocus={(e) => e.currentTarget.select()}
            className="border-linha bg-papel-alto min-w-0 flex-1 rounded-sm border px-2 py-1.5 font-mono text-xs"
            aria-label="Link de preenchimento"
          />
          <Button type="button" variant="outline" size="sm" onClick={copiar}>
            <Copy className="size-3.5" />
            {copiado ? "Copiado" : "Copiar"}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Envie este link ao cliente. Não volta a ser mostrado — na base de dados
          fica só o resumo criptográfico. Expira em 30 dias.
        </p>
      </div>
    );
  }

  if (!aberto) {
    return (
      <div className="flex flex-col items-end gap-2">
        <Button onClick={() => setAberto(true)} size={tamanho}>
          <Plus className="size-4" />
          Novo processo
        </Button>
      </div>
    );
  }

  return (
    <div className="border-linha bg-papel-alto flex w-full flex-col gap-4 rounded-sm border p-4">
      <p className="text-sm font-medium">Novo processo</p>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs text-muted-foreground">Tipo de cliente</legend>
        <div className="flex gap-2">
          {[
            { v: "particular", t: "Pessoa Singular" },
            { v: "empresa", t: "Empresa" },
          ].map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => setTipoCliente(o.v as "particular" | "empresa")}
              aria-pressed={tipoCliente === o.v}
              className={
                "border-linha rounded-sm border px-3 py-1.5 text-sm transition-colors " +
                (tipoCliente === o.v
                  ? "border-tinta bg-tinta text-papel-alto"
                  : "bg-papel-alto hover:border-tinta-suave")
              }
            >
              {o.t}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="np-nome">Nome do cliente (opcional)</Label>
          <Input
            id="np-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Maria Silva"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="np-email">Email para enviar o link (opcional)</Label>
          <Input
            id="np-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="maria@exemplo.pt"
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Com email preenchido, o link segue na mensagem &laquo;JMASSANO | Registro&raquo;.
        Sem email, fica só no ecrã para copiar.
      </p>

      {erro && <p className="text-selo text-xs">{erro}</p>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setAberto(false)}>
          Cancelar
        </Button>
        <Button type="button" onClick={criar} disabled={aCriar} size="sm">
          <Plus className="size-4" />
          {aCriar ? "A criar…" : "Criar processo"}
        </Button>
      </div>
    </div>
  );
}
