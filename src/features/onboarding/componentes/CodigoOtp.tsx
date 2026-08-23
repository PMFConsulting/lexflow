"use client";

import { useState, useTransition } from "react";
import { Check, Mail, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { enviarCodigoOtp, verificarCodigoOtp, type EstadoOtp } from "../acoes";

/**
 * A verificação por email, no fecho.
 *
 * Entre a declaração final e a assinatura, e é aí de propósito: é a última
 * coisa que o cliente faz antes de assinar, e o que ela destranca é
 * precisamente a assinatura. Pô-la mais acima seria pedir um código dez minutos
 * antes de ele fazer falta — e dez minutos é exatamente o tempo que ele dura.
 *
 * O envio é a pedido e não automático ao abrir o passo. O passo 7 é revisitado
 * (o cliente vai corrigir um campo e volta) e um envio por visita enchia-lhe a
 * caixa de códigos, gastava a quota do fornecedor e treinava-o a ignorar
 * exatamente a mensagem que precisa de ler.
 *
 * O `name="otp"` num input escondido não é para enviar nada — o código não vai
 * no `FormData` do passo, e a validação é do servidor contra a base de dados.
 * É o que dá ao resumo de erros um sítio para onde saltar quando a submissão é
 * recusada por falta de verificação (ver `alvoDoErro`, em `Formulario.tsx`).
 */
export function CodigoOtp({
  token,
  inicial,
  verificado,
  erros,
  aoVerificar,
}: {
  token: string;
  inicial: EstadoOtp;
  /**
   * Estado do formulário, e não deste componente.
   *
   * É o mesmo valor que decide se o quadro da assinatura monta, por isso tem de
   * haver **um** — com uma cópia local, uma verificação que o servidor recusasse
   * a meio (a validade de uma hora esgota-se) deixava este bloco a mostrar o
   * visto verde e o botão de submeter apagado, sem forma de voltar atrás.
   */
  verificado: boolean;
  erros: Record<string, string[]>;
  /** Avisa o formulário de que a assinatura pode aparecer — ou deixar de o estar. */
  aoVerificar: (verificado: boolean) => void;
}) {
  const [pedido, setPedido] = useState(inicial.pedido);
  const [para, setPara] = useState(inicial.para);
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aTrabalhar, transicao] = useTransition();

  const doServidor = erros.otp?.[0];

  const pedirCodigo = () =>
    transicao(async () => {
      setErro(null);
      setAviso(null);
      try {
        const r = await enviarCodigoOtp(token);
        if (!r.ok) {
          setErro(r.erro);
          return;
        }
        setPedido(true);
        setPara(r.para);
        setAviso(
          `Enviámos um código de 6 dígitos para ${r.para}. É válido durante ${r.expiraEmMinutos} minutos.`,
        );
      } catch {
        // Uma Server Action que rebenta não pode deixar o botão a sair de "A
        // enviar…" e mais nada — é o silêncio que faz uma falha de servidor
        // parecer um clique perdido.
        setErro("Não foi possível pedir o código. Verifique a ligação e tente de novo.");
      }
    });

  const confirmar = () =>
    transicao(async () => {
      setErro(null);
      setAviso(null);
      try {
        const r = await verificarCodigoOtp(token, codigo);
        if (!r.ok) {
          setErro(r.erro);
          return;
        }
        aoVerificar(true);
      } catch {
        setErro("Não foi possível verificar o código. Verifique a ligação e tente de novo.");
      }
    });

  if (verificado) {
    return (
      <div
        className="border-arquivo/40 bg-arquivo/5 text-arquivo flex items-start gap-2 rounded-sm border p-3 text-sm"
        data-otp="verificado"
      >
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        <span>
          Código verificado{para ? ` (${para})` : ""}. Já pode assinar e submeter.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-otp={pedido ? "pedido" : "por-pedir"}>
      {/* Ver a nota do componente: âncora do resumo de erros, não campo. */}
      <input type="hidden" name="otp" value="" />

      <p className="text-sm text-muted-foreground">
        Antes de assinar, confirmamos que é o senhor(a) quem está a submeter: enviamos
        um código de 6 dígitos para o email do processo e pedimos que o introduza aqui.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="campo-otp" className="text-tinta-suave">
            Código de verificação
          </Label>
          <input
            id="campo-otp"
            data-campo="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={codigo}
            disabled={!pedido || aTrabalhar}
            onChange={(e) => {
              setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6));
              setErro(null);
            }}
            placeholder="000000"
            aria-invalid={Boolean(erro || doServidor)}
            className={cn(
              "border-linha bg-papel-alto focus-visible:border-ring focus-visible:ring-ring/50",
              "h-9 w-40 rounded-sm border px-2.5 font-mono text-base tracking-[0.35em] tabular-nums",
              "outline-none focus-visible:ring-3 disabled:opacity-50",
            )}
          />
        </div>

        <Button
          type="button"
          onClick={confirmar}
          disabled={!pedido || codigo.length !== 6 || aTrabalhar}
        >
          <Check className="size-4" />
          Validar código
        </Button>

        <Button type="button" variant="outline" onClick={pedirCodigo} disabled={aTrabalhar}>
          <Mail className="size-4" />
          {aTrabalhar ? "A enviar…" : pedido ? "Enviar novo código" : "Enviar código"}
        </Button>
      </div>

      {aviso && (
        <p className="text-arquivo text-xs" aria-live="polite">
          {aviso}
        </p>
      )}

      {(erro || doServidor) && (
        <p className="text-selo flex items-start gap-1.5 text-xs" role="alert">
          <TriangleAlert className="mt-px size-3 shrink-0" />
          <span>{erro ?? doServidor}</span>
        </p>
      )}

      {!pedido && !erro && (
        <p className="text-xs text-muted-foreground">
          O código vai para o email que indicou no passo 1. Verifique também a pasta de
          spam.
        </p>
      )}
    </div>
  );
}
