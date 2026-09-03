"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Copy, Eye, FileEdit, Info, RotateCcw, Save, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  aplicarPlaceholders,
  aplicarPlaceholdersTexto,
  comporHtmlPersonalizado,
  PLACEHOLDERS_DISPONIVEIS,
  sanitizarHtmlEmail,
  type TemplateEditavel,
} from "@/lib/emails/personalizacao";
import { guardarModeloEmail, reverterModeloEmail } from "@/features/emails/acoes";
import type { ModeloEmailItem } from "@/features/emails/consultas";

const DADOS_EXEMPLO = {
  nome_cliente: "Maria Antónia Silva",
  referencia: "PMF-2026-0142",
  nome_sociedade: "PMF Advogados & Associados",
  link_processo: "https://plataforma.exemplo.pt/onboarding/exemplo-token",
  motivo: "Documentação de identificação em falta ou ilegível.",
};

export function EditorModelosEmail({
  modelosIniciais,
  logotipoUrl,
}: {
  modelosIniciais: ModeloEmailItem[];
  logotipoUrl?: string | null;
}) {
  const [modelos, setModelos] = useState<ModeloEmailItem[]>(modelosIniciais);
  const [templateAtivo, setTemplateAtivo] = useState<TemplateEditavel>(
    modelosIniciais[0]?.template ?? "confirmacao_rececao",
  );
  const [abaVisualizacao, setAbaVisualizacao] = useState<"editor" | "preview">("editor");

  const [isPending, startTransition] = useTransition();
  const [erros, setErros] = useState<Record<string, string[]>>({});
  const [copiado, setCopiado] = useState<string | null>(null);

  const modeloAtual =
    modelos.find((m) => m.template === templateAtivo) ?? modelos[0];

  const [assuntoForm, setAssuntoForm] = useState<Record<TemplateEditavel, string>>(() =>
    Object.fromEntries(modelosIniciais.map((m) => [m.template, m.assunto])) as Record<
      TemplateEditavel,
      string
    >,
  );

  const [corpoHtmlForm, setCorpoHtmlForm] = useState<Record<TemplateEditavel, string>>(() =>
    Object.fromEntries(modelosIniciais.map((m) => [m.template, m.corpoHtml])) as Record<
      TemplateEditavel,
      string
    >,
  );

  const assuntoAtual = assuntoForm[templateAtivo] ?? modeloAtual.assunto;
  const corpoAtual = corpoHtmlForm[templateAtivo] ?? modeloAtual.corpoHtml;

  const handleMudarAssunto = (valor: string) => {
    setAssuntoForm((prev) => ({ ...prev, [templateAtivo]: valor }));
    if (erros.assunto) {
      setErros((prev) => {
        const next = { ...prev };
        delete next.assunto;
        return next;
      });
    }
  };

  const handleMudarCorpo = (valor: string) => {
    setCorpoHtmlForm((prev) => ({ ...prev, [templateAtivo]: valor }));
    if (erros.corpoHtml) {
      setErros((prev) => {
        const next = { ...prev };
        delete next.corpoHtml;
        return next;
      });
    }
  };

  const inserirPlaceholder = (chave: string) => {
    const tag = `{{${chave}}}`;
    setCorpoHtmlForm((prev) => ({
      ...prev,
      [templateAtivo]: (prev[templateAtivo] || "") + tag,
    }));
    navigator.clipboard?.writeText(tag).catch(() => {});
    setCopiado(chave);
    setTimeout(() => setCopiado(null), 2000);
    toast.info(`Placeholder ${tag} adicionado ao corpo e copiado.`);
  };

  const reporPadraoNoEditor = () => {
    setAssuntoForm((prev) => ({ ...prev, [templateAtivo]: modeloAtual.assuntoPadrao }));
    setCorpoHtmlForm((prev) => ({ ...prev, [templateAtivo]: modeloAtual.corpoHtmlPadrao }));
    toast.info("Texto padrão do sistema preenchido no editor.");
  };

  const handleGuardar = () => {
    setErros({});
    startTransition(async () => {
      const res = await guardarModeloEmail({
        template: templateAtivo,
        assunto: assuntoAtual,
        corpoHtml: corpoAtual,
      });

      if (res.ok) {
        toast.success("Modelo de email guardado com sucesso.");
        setModelos((prev) =>
          prev.map((m) =>
            m.template === templateAtivo
              ? {
                  ...m,
                  personalizado: true,
                  assunto: assuntoAtual,
                  corpoHtml: corpoAtual,
                  atualizadoEm: new Date(),
                }
              : m,
          ),
        );
      } else {
        if (res.erros) setErros(res.erros);
        toast.error(res.mensagem || "Erro ao guardar modelo.");
      }
    });
  };

  const handleReverter = () => {
    setErros({});
    startTransition(async () => {
      const res = await reverterModeloEmail({ template: templateAtivo });
      if (res.ok) {
        toast.success("Modelo revertido para o padrão do sistema.");
        setAssuntoForm((prev) => ({ ...prev, [templateAtivo]: modeloAtual.assuntoPadrao }));
        setCorpoHtmlForm((prev) => ({ ...prev, [templateAtivo]: modeloAtual.corpoHtmlPadrao }));
        setModelos((prev) =>
          prev.map((m) =>
            m.template === templateAtivo
              ? {
                  ...m,
                  personalizado: false,
                  assunto: modeloAtual.assuntoPadrao,
                  corpoHtml: modeloAtual.corpoHtmlPadrao,
                  atualizadoEm: null,
                }
              : m,
          ),
        );
      } else {
        toast.error(res.mensagem || "Erro ao reverter modelo.");
      }
    });
  };

  // Pré-visualização com dados simulados
  // O assunto não é HTML — a pré-visualização usa a mesma função que o envio
  // (`aplicarPlaceholdersTexto`), senão o que aqui se lê («&amp;») não é o que
  // chega à caixa de correio.
  const assuntoPrevisualizacao = aplicarPlaceholdersTexto(assuntoAtual, DADOS_EXEMPLO);
  const corpoPrevisualizacao = comporHtmlPersonalizado(
    sanitizarHtmlEmail(aplicarPlaceholders(corpoAtual, DADOS_EXEMPLO)),
    modeloAtual.corAcento,
    logotipoUrl,
  );

  const idAssunto = useId();
  const idCorpo = useId();

  return (
    <div className="flex flex-col gap-6">
      {/* Navegação entre templates editáveis */}
      <div className="border-linha bg-papel-alto flex flex-wrap gap-2 rounded-sm border p-2">
        {modelos.map((m) => {
          const selecionado = m.template === templateAtivo;
          return (
            <button
              key={m.template}
              type="button"
              onClick={() => {
                setTemplateAtivo(m.template);
                setErros({});
              }}
              className={cn(
                "flex items-center gap-2 rounded-sm px-3.5 py-2 text-sm font-medium transition-colors",
                selecionado
                  ? "bg-tinta text-papel-alto shadow-xs"
                  : "hover:bg-muted/60 text-muted-foreground",
              )}
            >
              <span>{m.titulo}</span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-2xs font-mono tracking-tight",
                  m.personalizado
                    ? selecionado
                      ? "bg-papel-alto/20 text-papel-alto font-semibold"
                      : "bg-arquivo/15 text-arquivo font-semibold"
                    : selecionado
                      ? "bg-papel-alto/10 text-papel-alto/70"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {m.personalizado ? "Personalizado" : "Padrão"}
              </span>
            </button>
          );
        })}
      </div>

      {/* Painel do template ativo */}
      <div className="border-linha bg-papel-alto flex flex-col gap-5 rounded-sm border p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-medium">{modeloAtual.titulo}</h2>
              <Badge
                variant="outline"
                className={cn(
                  "text-xs font-mono tracking-wide",
                  modeloAtual.personalizado
                    ? "border-arquivo/40 bg-arquivo/10 text-arquivo"
                    : "border-linha text-muted-foreground",
                )}
              >
                {modeloAtual.personalizado ? "Modelo Personalizado" : "Modelo Padrão"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{modeloAtual.descricao}</p>
          </div>

          {/* Alternador Editor / Preview */}
          <div className="border-linha bg-muted/40 flex items-center rounded-sm border p-0.5">
            <button
              type="button"
              onClick={() => setAbaVisualizacao("editor")}
              className={cn(
                "flex items-center gap-1.5 rounded-xs px-3 py-1 text-xs font-medium transition-colors",
                abaVisualizacao === "editor"
                  ? "bg-papel-alto text-tinta shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <FileEdit className="size-3.5" />
              Editor
            </button>
            <button
              type="button"
              onClick={() => setAbaVisualizacao("preview")}
              className={cn(
                "flex items-center gap-1.5 rounded-xs px-3 py-1 text-xs font-medium transition-colors",
                abaVisualizacao === "preview"
                  ? "bg-papel-alto text-tinta shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Eye className="size-3.5" />
              Pré-visualização
            </button>
          </div>
        </div>

        {/* Secção de Placeholders disponíveis */}
        <div className="border-linha/70 bg-muted/30 flex flex-col gap-2 rounded-sm border p-3.5">
          <div className="flex items-center gap-1.5">
            <Sparkles className="text-latao size-4" />
            <span className="text-2xs font-mono tracking-[0.14em] text-muted-foreground uppercase">
              Placeholders suportados (clique para inserir/copiar)
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {PLACEHOLDERS_DISPONIVEIS.map((p) => {
              const foiCopiado = copiado === p.chave;
              return (
                <button
                  key={p.chave}
                  type="button"
                  onClick={() => inserirPlaceholder(p.chave)}
                  title={p.descricao}
                  className="border-linha bg-papel-alto hover:border-tinta-suave inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs font-mono transition-colors"
                >
                  {foiCopiado ? (
                    <Check className="text-arquivo size-3.5" />
                  ) : (
                    <Copy className="text-muted-foreground size-3.5" />
                  )}
                  <span className="text-tinta font-semibold">{p.rotulo}</span>
                  <span className="text-muted-foreground text-2xs">({p.descricao})</span>
                </button>
              );
            })}
          </div>
        </div>

        {abaVisualizacao === "editor" ? (
          <div className="flex flex-col gap-5">
            {/* Campo Assunto */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={idAssunto} className="text-tinta-suave">
                Assunto do email <span className="text-selo">*</span>
              </Label>
              <Input
                id={idAssunto}
                value={assuntoAtual}
                onChange={(e) => handleMudarAssunto(e.target.value)}
                placeholder="Ex: Confirmação de Receção dos seus Dados"
                aria-invalid={Boolean(erros.assunto)}
                className="font-medium"
              />
              {erros.assunto && (
                <p className="text-xs text-selo" role="alert">
                  {erros.assunto[0]}
                </p>
              )}
            </div>

            {/* Campo Corpo HTML */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor={idCorpo} className="text-tinta-suave">
                  Corpo do email (HTML / Parágrafos) <span className="text-selo">*</span>
                </Label>
                <button
                  type="button"
                  onClick={reporPadraoNoEditor}
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  Preencher com texto padrão
                </button>
              </div>
              <Textarea
                id={idCorpo}
                value={corpoAtual}
                onChange={(e) => handleMudarCorpo(e.target.value)}
                rows={12}
                aria-invalid={Boolean(erros.corpoHtml)}
                className="font-mono text-xs leading-relaxed"
              />
              {erros.corpoHtml && (
                <p className="text-xs text-selo" role="alert">
                  {erros.corpoHtml[0]}
                </p>
              )}
            </div>

            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="size-4 shrink-0 text-muted-foreground/80 mt-0.5" />
              <p>
                O conteúdo acima é inserido automaticamente dentro da moldura oficial da
                sociedade, com o logótipo e o rodapé institucional de confidencialidade.
              </p>
            </div>
          </div>
        ) : (
          /* Aba de Pré-visualização */
          <div className="flex flex-col gap-4">
            <div className="border-linha bg-muted/40 rounded-sm border p-3">
              <p className="text-xs text-muted-foreground">
                <strong className="text-foreground">Assunto:</strong> {assuntoPrevisualizacao}
              </p>
            </div>

            <div className="border-linha overflow-hidden rounded-sm border bg-papel p-4">
              <div
                className="email-preview-container max-w-full"
                dangerouslySetInnerHTML={{ __html: corpoPrevisualizacao }}
              />
            </div>
          </div>
        )}

        {/* Botões de Ação */}
        <div className="border-linha/70 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div className="flex items-center gap-2">
            {modeloAtual.personalizado && (
              <Button
                type="button"
                variant="outline"
                onClick={handleReverter}
                disabled={isPending}
                className="border-selo/30 text-selo hover:bg-selo/10 hover:text-selo"
              >
                <RotateCcw className="size-4" />
                Reverter para padrão
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={handleGuardar}
              disabled={isPending}
            >
              <Save className="size-4" />
              {isPending ? "A guardar…" : "Guardar modelo"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
