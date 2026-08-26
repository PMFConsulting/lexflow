"use client";

import { useId, useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { atualizarSociedade } from "../acoes";
import { Erro, ErroGeral } from "./Erro";

/**
 * Os dados da sociedade, editáveis.
 *
 * O aviso sobre o prefixo não é decorativo: mudá-lo **não** reescreve as
 * referências já emitidas, e não pode reescrever — `PMF-2026-0142` está em
 * emails enviados, em PDFs arquivados e em assuntos de avisos internos, e
 * mudá-lo na base de dados partia a correspondência entre o que a sociedade tem
 * em papel e o que a plataforma diz. Quem muda o prefixo tem de saber isso
 * antes de gravar, não depois.
 */
export function EditarSociedade({
  id,
  inicial,
}: {
  id: string;
  inicial: { nome: string; nif: string; prefixoReferencia: string };
}) {
  const [erros, setErros] = useState<Record<string, string>>({});
  const [gravado, setGravado] = useState(false);
  const [aGravar, transicao] = useTransition();
  const base = useId();

  const submeter = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    setErros({});
    setGravado(false);

    transicao(async () => {
      try {
        const r = await atualizarSociedade(id, {
          nome: String(fd.get("nome") ?? ""),
          nif: String(fd.get("nif") ?? ""),
          prefixoReferencia: String(fd.get("prefixo") ?? ""),
        });

        if (!r.ok) {
          setErros(r.erros);
          return;
        }
        setGravado(true);
      } catch (e) {
        console.error("[plataforma] atualizarSociedade rebentou:", e);
        setErros({ _: "O servidor não respondeu. Recarregue a página e tente de novo." });
      }
    });
  };

  return (
    <section className="border-linha bg-papel-alto rounded-sm border p-4">
      <h2 className="text-base">Dados da sociedade</h2>

      <form onSubmit={submeter} className="mt-3 flex flex-col gap-4">
        <ErroGeral erros={erros} />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${base}-nome`}>Nome</Label>
          <Input id={`${base}-nome`} name="nome" defaultValue={inicial.nome} required />
          <Erro erros={erros} campo="nome" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${base}-nif`}>NIPC</Label>
            <Input
              id={`${base}-nif`}
              name="nif"
              defaultValue={inicial.nif}
              inputMode="numeric"
              className="font-mono"
              required
            />
            <Erro erros={erros} campo="nif" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${base}-prefixo`}>Prefixo de referência</Label>
            <Input
              id={`${base}-prefixo`}
              name="prefixo"
              defaultValue={inicial.prefixoReferencia}
              className="font-mono uppercase"
              maxLength={6}
              required
            />
            <p className="text-2xs text-muted-foreground">
              Mudar o prefixo <strong>não</strong> altera as referências já emitidas — só vale
              para os processos seguintes.
            </p>
            <Erro erros={erros} campo="prefixoReferencia" />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={aGravar}>
            {aGravar ? "A gravar…" : "Gravar"}
          </Button>
          {gravado && (
            <span className="text-arquivo inline-flex items-center gap-1.5 text-sm">
              <Check className="size-4" /> Gravado
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
