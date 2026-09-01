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

/**
 * O `<select>` nativo, com a mesma pele do `<Input>`.
 *
 * Tinha altura própria (`h-9` contra os `h-8` do input), cantos próprios e
 * nenhum anel de foco: numa grelha de duas colunas, "Tipo de documento" ficava
 * quatro píxeis mais alto do que "Número do documento" ao lado, e ao navegar
 * por teclado o campo escolhido não se distinguia. São os mesmos estados do
 * input — foco, inválido, desativado — porque é o mesmo tipo de campo.
 */
export const classeSelect =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-papel-alto px-2.5 py-1 text-base " +
  "transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 " +
  "focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed " +
  "disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 " +
  "aria-invalid:ring-destructive/20 md:text-sm";

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
  placeholder,
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
  placeholder?: string;
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
          placeholder={placeholder}
          aria-invalid={invalido}
          aria-describedby={descrito || undefined}
          className={cn(mono && "font-mono tracking-tight tabular-nums")}
        />
      )}
    </Campo>
  );
}

/**
 * Caixa de texto livre, com sugestões clicáveis por baixo.
 *
 * As sugestões existem porque estas duas perguntas — que serviços e de onde
 * vêm os fundos — são as que o cliente menos sabe responder por palavras
 * dele, e uma lista de exemplos escondida numa linha de ajuda não se usa.
 * Clicar acrescenta ao que já lá está em vez de substituir: quase nunca é uma
 * escolha única ("Avença" *e* "Questões Laborais").
 */
export function CampoLongo({
  etiqueta,
  nome,
  erros,
  ajuda,
  obrigatorio,
  valorInicial = "",
  sugestoes,
}: {
  etiqueta: string;
  nome: string;
  erros?: Record<string, string[]>;
  ajuda?: string;
  obrigatorio?: boolean;
  valorInicial?: string;
  sugestoes?: string[];
}) {
  const [valor, setValor] = useState(valorInicial);

  const juntar = (sugestao: string) => {
    setValor((atual) => {
      const limpo = atual.trim();
      // Já lá está: clicar outra vez tira-a, que é o que quem se enganou espera.
      const partes = limpo
        ? limpo.split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean)
        : [];
      const seguintes = partes.includes(sugestao)
        ? partes.filter((p) => p !== sugestao)
        : [...partes, sugestao];
      return seguintes.join(" / ");
    });
  };

  return (
    <Campo etiqueta={etiqueta} nome={nome} erros={erros} ajuda={ajuda} obrigatorio={obrigatorio}>
      {({ id, descrito, invalido }) => (
        <>
          <Textarea
            id={id}
            name={nome}
            rows={3}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            aria-invalid={invalido}
            aria-describedby={descrito || undefined}
          />
          {sugestoes && sugestoes.length > 0 && (
            <div className="mt-2 flex flex-col gap-1.5">
              <p className="text-2xs font-mono tracking-[0.14em] text-muted-foreground uppercase">
                Sugestões
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {sugestoes.map((s) => {
                  const escolhida = valor
                    .split(/\s*\/\s*/)
                    .map((p) => p.trim())
                    .includes(s);
                  return (
                    <li key={s}>
                      <button
                        type="button"
                        onClick={() => juntar(s)}
                        aria-pressed={escolhida}
                        className={cn(
                          "border-linha rounded-sm border px-2 py-1 text-xs transition-colors",
                          escolhida
                            ? "border-tinta bg-tinta text-papel-alto"
                            : "bg-papel-alto hover:border-tinta-suave",
                        )}
                      >
                        {s}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
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
  onChange,
}: {
  etiqueta: string;
  nome: string;
  erros?: Record<string, string[]>;
  obrigatorio?: boolean;
  opcoes: { valor: string; texto: string }[];
  valorInicial?: string;
  className?: string;
  onChange?: (v: string) => void;
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
          onChange={(e) => onChange?.(e.target.value)}
          aria-invalid={invalido}
          aria-describedby={descrito || undefined}
          className={classeSelect}
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

/** Escolha única entre opções nomeadas — mesmo padrão visual do CampoSimNao. */
export function CampoRadio({
  etiqueta,
  nome,
  erros,
  obrigatorio,
  opcoes,
  valorInicial = "",
  onChange,
}: {
  etiqueta: string;
  nome: string;
  erros?: Record<string, string[]>;
  obrigatorio?: boolean;
  opcoes: { valor: string; texto: string }[];
  valorInicial?: string;
  onChange?: (v: string) => void;
}) {
  const [valor, setValor] = useState(valorInicial);
  const erro = erros?.[nome]?.[0];

  const escolher = (v: string) => {
    setValor(v);
    onChange?.(v);
  };

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">
        {etiqueta}
        {obrigatorio && <span className="text-selo"> *</span>}
      </legend>
      <input type="hidden" name={nome} value={valor} />
      <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap">
        {opcoes.map((o) => (
          <button
            key={o.valor}
            type="button"
            onClick={() => escolher(o.valor)}
            aria-pressed={valor === o.valor}
            className={cn(
              "border-linha rounded-sm border px-3 py-1.5 text-left text-sm transition-colors",
              valor === o.valor
                ? "border-tinta bg-tinta text-papel-alto"
                : "bg-papel-alto hover:border-tinta-suave",
            )}
          >
            {o.texto}
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

/**
 * Multi-seleção — áreas de interesse e afins. Cada escolha é um input próprio.
 *
 * Com `permitirOutro`, junta-se uma última caixa com um campo de texto ao lado.
 * O que lá for escrito entra na lista como mais um valor, sem coluna nem
 * tabela própria: a lista já é de texto livre, e o que interessa guardar é a
 * área que o cliente indicou, não o facto de ela ter vindo de uma caixa
 * diferente. Ao recarregar, o valor que não corresponde a nenhuma opção
 * conhecida é, por definição, o "outro".
 */
export function CampoCaixas({
  etiqueta,
  nome,
  erros,
  opcoes,
  valorInicial = [],
  permitirOutro,
  etiquetaOutro = "Outro",
  placeholderOutro,
}: {
  etiqueta: string;
  nome: string;
  erros?: Record<string, string[]>;
  opcoes: { valor: string; texto: string }[];
  valorInicial?: string[];
  permitirOutro?: boolean;
  etiquetaOutro?: string;
  placeholderOutro?: string;
}) {
  const conhecidas = opcoes.map((o) => o.valor);
  const outroInicial = permitirOutro
    ? (valorInicial.find((v) => !conhecidas.includes(v)) ?? "")
    : "";

  const [itens, setItens] = useState<string[]>(
    valorInicial.filter((v) => conhecidas.includes(v)),
  );
  const [querOutro, setQuerOutro] = useState(Boolean(outroInicial));
  const [outro, setOutro] = useState(outroInicial);
  const erro = erros?.[nome]?.[0];

  const alternar = (v: string) => {
    setItens((atual) => (atual.includes(v) ? atual.filter((x) => x !== v) : [...atual, v]));
  };

  const idOutro = `${nome}-outro`;
  const outroLimpo = outro.trim();

  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="mb-0.5 text-sm font-medium">{etiqueta}</legend>
      {itens.map((v) => (
        <input key={v} type="hidden" name={nome} value={v} />
      ))}
      {querOutro && outroLimpo && !itens.includes(outroLimpo) && (
        <input type="hidden" name={nome} value={outroLimpo} />
      )}
      <div className="flex flex-col gap-2.5">
        {opcoes.map((o) => {
          const id = `${nome}-${o.valor}`;
          return (
            <div key={o.valor} className="flex items-start gap-2.5">
              <Checkbox
                id={id}
                checked={itens.includes(o.valor)}
                onCheckedChange={() => alternar(o.valor)}
                className="mt-0.5 size-5 md:size-4"
              />
              <Label htmlFor={id} className="py-0.5 text-sm leading-snug font-normal">
                {o.texto}
              </Label>
            </div>
          );
        })}

        {permitirOutro && (
          <div className="flex flex-col gap-2">
            <div className="flex items-start gap-2.5">
              <Checkbox
                id={idOutro}
                checked={querOutro}
                onCheckedChange={(v) => setQuerOutro(v === true)}
                className="mt-0.5 size-5 md:size-4"
              />
              <Label htmlFor={idOutro} className="py-0.5 text-sm leading-snug font-normal">
                {etiquetaOutro}
              </Label>
            </div>
            {querOutro && (
              // Sem `name`: quem leva o valor ao servidor é o input escondido
              // acima, já dentro da lista. Dois nomes para o mesmo texto davam
              // duas versões dele no corpo do pedido.
              <Input
                value={outro}
                placeholder={placeholderOutro}
                onChange={(e) => setOutro(e.target.value)}
                aria-label={etiquetaOutro}
                className="sm:max-w-md"
              />
            )}
          </div>
        )}
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
  desativado,
  ajudaDesativado,
}: {
  etiqueta: ReactNode;
  nome: string;
  erros?: Record<string, string[]>;
  valorInicial?: boolean;
  onChange?: (v: boolean) => void;
  /** Trancada até uma condição ser cumprida — a leitura dos T&C, por exemplo. */
  desativado?: boolean;
  /** O que falta fazer para a destrancar. Só aparece enquanto estiver trancada. */
  ajudaDesativado?: string;
}) {
  const id = useId();
  const [ligado, setLigado] = useState(valorInicial);
  const erro = erros?.[nome]?.[0];

  // Uma caixa que ficou marcada e passou a estar trancada não pode continuar a
  // valer como aceitação: o valor submetido segue o estado visível.
  const marcado = ligado && !desativado;

  return (
    <div className="flex flex-col gap-1.5">
      <div className={cn("flex items-start gap-2.5", desativado && "opacity-55")}>
        <input type="hidden" name={nome} value={String(marcado)} />
        <Checkbox
          id={id}
          checked={marcado}
          disabled={desativado}
          onCheckedChange={(v) => {
            const b = v === true;
            setLigado(b);
            onChange?.(b);
          }}
          aria-invalid={Boolean(erro)}
          aria-describedby={desativado && ajudaDesativado ? `${id}-tranca` : undefined}
          // Alvo maior no telemóvel: 16px de caixa é pouco para acertar com o
          // dedo, e estas caixas são declarações que não se querem falhadas.
          className="mt-0.5 size-5 md:size-4"
        />
        <Label htmlFor={id} className="py-0.5 text-sm leading-snug font-normal">
          {etiqueta}
        </Label>
      </div>
      {desativado && ajudaDesativado && (
        <p id={`${id}-tranca`} className="text-xs text-muted-foreground">
          {ajudaDesativado}
        </p>
      )}
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
      {/* `text-tinta-suave` como no `Campo`: sem isto, a etiqueta de
          "Nacionalidade(s)" saía a tinta cheia ao lado de "Nome completo" em
          cinzento, na mesma grelha. */}
      <Label htmlFor={id} className="text-tinta-suave">
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
            aria-invalid={Boolean(erro)}
            aria-describedby={erro ? `${id}-erro` : undefined}
            className={cn(classeSelect, "flex-1")}
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
