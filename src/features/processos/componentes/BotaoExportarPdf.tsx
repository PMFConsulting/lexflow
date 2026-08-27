"use client";

import { useTransition } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { exportarProcessoPdf } from "../exportar-pdf";

export function BotaoExportarPdf({
  processoId,
  referencia,
}: {
  processoId: string;
  referencia: string;
}) {
  const [aExportar, transicao] = useTransition();

  const handleExportar = () => {
    transicao(async () => {
      try {
        const resultado = await exportarProcessoPdf(processoId);
        if (!resultado.ok) {
          toast.error(resultado.erro);
          return;
        }

        // Converter base64 para Blob binário e descarregar
        const binario = atob(resultado.pdfBase64);
        const bytes = new Uint8Array(binario.length);
        for (let i = 0; i < binario.length; i++) {
          bytes[i] = binario.charCodeAt(i);
        }

        const blob = new Blob([bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = resultado.nomeFicheiro;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        toast.success(`Dossier ${referencia} exportado em PDF.`);
      } catch (err) {
        console.error("Erro ao exportar PDF:", err);
        toast.error("Ocorreu um erro ao gerar o PDF do dossier.");
      }
    });
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleExportar}
      disabled={aExportar}
      className="inline-flex items-center gap-1.5 text-xs"
    >
      {aExportar ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Download className="size-3.5" />
      )}
      <span>Exportar PDF</span>
    </Button>
  );
}
