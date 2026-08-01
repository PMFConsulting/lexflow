"use client";

import { useEffect, useRef, useState } from "react";
import SignaturePad from "signature_pad";
import { Eraser } from "lucide-react";
import { Label } from "@/components/ui/label";

/**
 * Rubrica manuscrita.
 *
 * Assinatura eletrónica simples: o que vale como prova não é o desenho, é o
 * conjunto — quem assinou, de que endereço, a que horas do relógio do servidor,
 * e sobre que conteúdo exato (o resumo criptográfico do dossier).
 *
 * O canvas é redimensionado pelo rácio de píxeis do ecrã, senão a rubrica sai
 * esborratada em telemóveis — que é onde a maioria das pessoas vai assinar.
 */
export function Assinatura({
  nome,
  erros,
  valorInicial,
}: {
  nome: string;
  erros?: Record<string, string[]>;
  valorInicial?: string | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pad = useRef<SignaturePad | null>(null);
  const [dados, setDados] = useState<string>(valorInicial ?? "");
  const erro = erros?.[nome]?.[0];

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;

    const ajustar = () => {
      const anterior = pad.current?.isEmpty() === false ? pad.current.toDataURL("image/png") : null;
      const rácio = Math.max(window.devicePixelRatio || 1, 1);
      el.width = el.offsetWidth * rácio;
      el.height = el.offsetHeight * rácio;
      el.getContext("2d")?.scale(rácio, rácio);
      pad.current?.clear();
      if (anterior) void pad.current?.fromDataURL(anterior);
    };

    pad.current = new SignaturePad(el, {
      penColor: "#101a24",
      backgroundColor: "rgba(255,255,255,0)",
      minWidth: 0.7,
      maxWidth: 2.2,
    });

    pad.current.addEventListener("endStroke", () => {
      setDados(pad.current?.isEmpty() ? "" : (pad.current?.toDataURL("image/png") ?? ""));
    });

    ajustar();
    if (valorInicial) void pad.current.fromDataURL(valorInicial);

    window.addEventListener("resize", ajustar);
    return () => {
      window.removeEventListener("resize", ajustar);
      pad.current?.off();
      pad.current = null;
    };
  }, [valorInicial]);

  const limpar = () => {
    pad.current?.clear();
    setDados("");
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="rubrica">
          Assinatura<span className="text-selo"> *</span>
        </Label>
        {dados && (
          <button
            type="button"
            onClick={limpar}
            className="text-muted-foreground hover:text-selo inline-flex items-center gap-1.5 text-xs"
          >
            <Eraser className="size-3.5" />
            Limpar
          </button>
        )}
      </div>

      <input type="hidden" name={nome} value={dados} />

      <div
        className={
          "border-linha bg-papel-alto relative rounded-sm border " +
          (erro ? "border-selo" : "")
        }
      >
        <canvas
          id="rubrica"
          ref={canvas}
          className="h-40 w-full touch-none sm:h-44"
          aria-label="Área de assinatura. Desenhe a sua rubrica com o dedo ou o rato."
        />
        {!dados && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Assine aqui
          </span>
        )}
        <span className="border-linha pointer-events-none absolute inset-x-6 bottom-7 border-b border-dashed" />
      </div>

      <p className="text-xs text-muted-foreground">
        Com o dedo, no telemóvel, ou com o rato. Fica registada com a data, a
        hora do servidor e o endereço de onde foi feita.
      </p>

      {erro && (
        <p className="text-selo text-xs" role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}
