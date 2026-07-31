"use client";

import { useId, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/**
 * Campos do formulário.
 *
 * O componente `form` do shadcn não existe no preset instalado, por isso isto
 * é um invólucro fino sobre inputs normais — sem biblioteca de formulários a
 * mais, e com o erro sempre ligado ao campo por `aria-describedby`.
 */

export function Campo({
  etiqueta,
  nome,
  erros,
  ajuda,
  obrigatorio,
  children,
  className,
}: {
  etiqueta: string;
  nome: string;
  erros?: Record<string, string[]>;
  ajuda?: string;
  obrigatorio?: boolean;
  children: (props: { id: string; descrito: string; invalido: boolean }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const erro = erros?.[nome]?.[0];
  const idErro = `${id}-erro`;
  const idAjuda = `${id}-ajuda`;
  const descrito = [erro ? idErro : null, ajuda ? idAjuda : null].filter(Boolean).join(" ");

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id} className="text-tinta-suave">
        {etiqueta}
        {obrigatorio && <span className="text-selo"> *</span>}
      </Label>

      {children({ id, descrito, invalido: Boolean(erro) })}

      {ajuda && !erro && (
        <p id={idAjuda} className="text-xs text-muted-foreground">
          {ajuda}
        </p>
      )}
      {erro && (
        <p id={idErro} className="text-xs text-selo" role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}

export function CampoTexto({
  etiqueta,
  nome,
  erros,
  ajuda,
  obrigatorio,
  tipo = "text",
  valorInicial = "",
  mono,
  className,
}: {
  etiqueta: string;
  nome: string;
  erros?: Record<string, string[]>;
  ajuda?: string;
  obrigatorio?: boolean;
  tipo?: string;
  valorInicial?: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <Campo
      etiqueta={etiqueta}
      nome={nome}
      erros={erros}
      ajuda={ajuda}
      obrigatorio={obrigatorio}
      className={className}
    >
      {({ id, descrito, invalido }) => (
        <Input
          id={id}
          name={nome}
          type={tipo}
          defaultValue={valorInicial}
          aria-invalid={invalido}
          aria-describedby={descrito || undefined}
          className={cn(mono && "font-mono tracking-tight tabular-nums")}
        />
      )}
    </Campo>
  );
}

export function CampoLongo({
  etiqueta,
  nome,
  erros,
  ajuda,
  obrigatorio,
  valorInicial = "",
}: {
  etiqueta: string;
  nome: string;
  erros?: Record<string, string[]>;
  ajuda?: string;
  obrigatorio?: boolean;
  valorInicial?: string;
}) {
  return (
    <Campo etiqueta={etiqueta} nome={nome} erros={erros} ajuda={ajuda} obrigatorio={obrigatorio}>
      {({ id, descrito, invalido }) => (
        <Textarea
          id={id}
          name={nome}
          rows={3}
          defaultValue={valorInicial}
          aria-invalid={invalido}
          aria-describedby={descrito || undefined}
        />
      )}
    </Campo>
  );
}

export function CampoEscolha({
  etiqueta,
  nome,
  erros,
  obrigatorio,
  opcoes,
  valorInicial = "",
  className,
}: {
  etiqueta: string;
  nome: string;
  erros?: Record<string, string[]>;
  obrigatorio?: boolean;
  opcoes: { valor: string; texto: string }[];
  valorInicial?: string;
  className?: string;
}) {
  return (
    <Campo
      etiqueta={etiqueta}
      nome={nome}
      erros={erros}
      obrigatorio={obrigatorio}
      className={className}
    >
      {({ id, descrito, invalido }) => (
        <select
          id={id}
          name={nome}
          defaultValue={valorInicial}
          aria-invalid={invalido}
          aria-describedby={descrito || undefined}
          className="border-input bg-papel-alto h-9 rounded-sm border px-3 text-sm"
        >
          <option value="">Selecione…</option>
          {opcoes.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.texto}
            </option>
          ))}
        </select>
      )}
    </Campo>
  );
}

/** Sim/Não explícito, sem opção pré-escolhida — é uma declaração, não um default. */
export function CampoSimNao({
  pergunta,
  nome,
  erros,
  valorInicial,
  onChange,
}: {
  pergunta: string;
  nome: string;
  erros?: Record<string, string[]>;
  valorInicial?: boolean | null;
  onChange?: (v: boolean) => void;
}) {
  const [valor, setValor] = useState<boolean | null>(valorInicial ?? null);
  const erro = erros?.[nome]?.[0];

  const escolher = (v: boolean) => {
    setValor(v);
    onChange?.(v);
  };

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{pergunta}</legend>
      <input type="hidden" name={nome} value={valor === null ? "" : String(valor)} />
      <div className="flex gap-2">
        {[
          { v: true, t: "Sim" },
          { v: false, t: "Não" },
        ].map((o) => (
          <button
            key={o.t}
            type="button"
            onClick={() => escolher(o.v)}
            aria-pressed={valor === o.v}
            className={cn(
              "border-linha min-w-20 rounded-sm border px-4 py-1.5 text-sm transition-colors",
              valor === o.v
                ? "border-tinta bg-tinta text-papel-alto"
                : "bg-papel-alto hover:border-tinta-suave",
            )}
          >
            {o.t}
          </button>
        ))}
      </div>
      {erro && (
        <p className="text-xs text-selo" role="alert">
          {erro}
        </p>
      )}
    </fieldset>
  );
}

export function CampoCaixa({
  etiqueta,
  nome,
  erros,
  valorInicial = false,
  onChange,
}: {
  etiqueta: ReactNode;
  nome: string;
  erros?: Record<string, string[]>;
  valorInicial?: boolean;
  onChange?: (v: boolean) => void;
}) {
  const id = useId();
  const [ligado, setLigado] = useState(valorInicial);
  const erro = erros?.[nome]?.[0];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-2.5">
        <input type="hidden" name={nome} value={String(ligado)} />
        <Checkbox
          id={id}
          checked={ligado}
          onCheckedChange={(v) => {
            const b = v === true;
            setLigado(b);
            onChange?.(b);
          }}
          aria-invalid={Boolean(erro)}
          className="mt-0.5"
        />
        <Label htmlFor={id} className="text-sm leading-snug font-normal">
          {etiqueta}
        </Label>
      </div>
      {erro && (
        <p className="text-xs text-selo" role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}

/** Lista de valores livres — nacionalidades, emails, áreas de interesse. */
export function CampoLista({
  etiqueta,
  nome,
  erros,
  ajuda,
  obrigatorio,
  valorInicial = [],
  sugestoes,
  placeholder,
  className,
}: {
  etiqueta: string;
  nome: string;
  erros?: Record<string, string[]>;
  ajuda?: string;
  obrigatorio?: boolean;
  valorInicial?: string[];
  sugestoes?: { valor: string; texto: string }[];
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  const [itens, setItens] = useState<string[]>(valorInicial);
  const [rascunho, setRascunho] = useState("");
  const erro = erros?.[nome]?.[0];

  const juntar = (v: string) => {
    const limpo = v.trim();
    if (!limpo || itens.includes(limpo)) return;
    setItens([...itens, limpo]);
    setRascunho("");
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>
        {etiqueta}
        {obrigatorio && <span className="text-selo"> *</span>}
      </Label>

      {itens.map((v) => (
        <input key={v} type="hidden" name={nome} value={v} />
      ))}

      {itens.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {itens.map((v) => (
            <li key={v}>
              <button
                type="button"
                onClick={() => setItens(itens.filter((x) => x !== v))}
                className="border-linha bg-muted hover:border-selo hover:text-selo inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-xs transition-colors"
                aria-label={`Remover ${v}`}
              >
                {sugestoes?.find((s) => s.valor === v)?.texto ?? v}
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-1.5">
        {sugestoes ? (
          <select
            id={id}
            value=""
            onChange={(e) => juntar(e.target.value)}
            className="border-input bg-papel-alto h-9 flex-1 rounded-sm border px-3 text-sm"
          >
            <option value="">Adicionar…</option>
            {sugestoes
              .filter((s) => !itens.includes(s.valor))
              .map((s) => (
                <option key={s.valor} value={s.valor}>
                  {s.texto}
                </option>
              ))}
          </select>
        ) : (
          <>
            <Input
              id={id}
              value={rascunho}
              placeholder={placeholder}
              onChange={(e) => setRascunho(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  juntar(rascunho);
                }
              }}
              aria-describedby={erro ? `${id}-erro` : undefined}
            />
            <button
              type="button"
              onClick={() => juntar(rascunho)}
              className="border-linha bg-papel-alto hover:border-tinta rounded-sm border px-3 text-sm"
            >
              Adicionar
            </button>
          </>
        )}
      </div>

      {ajuda && !erro && <p className="text-xs text-muted-foreground">{ajuda}</p>}
      {erro && (
        <p id={`${id}-erro`} className="text-xs text-selo" role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}
