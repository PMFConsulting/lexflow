"use client";

import { useState, useTransition } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { exportarClientesCsv } from "../acoes";

export function BotaoExportarClientes({ termoPesquisa }: { termoPesquisa?: string }) {
  const [aExportar, transicao] = useTransition();

  const handleExportar = () => {
    transicao(async () => {
      try {
        const resultado = await exportarClientesCsv(termoPesquisa);
        if (!resultado.ok) {
          toast.error(resultado.erro);
          return;
        }

        const blob = new Blob([resultado.csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = resultado.nomeFicheiro;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        toast.success(
          resultado.total === 1
            ? "1 cliente exportado com sucesso."
            : `${resultado.total} clientes exportados com sucesso.`,
        );
      } catch (err) {
        console.error("Erro ao exportar clientes:", err);
        toast.error("Ocorreu um erro ao gerar a exportação de clientes.");
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
      <span>Exportar</span>
    </Button>
  );
}
