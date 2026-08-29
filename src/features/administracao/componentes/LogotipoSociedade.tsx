"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Image as ImageIcon, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatarData } from "@/lib/datas";
import { guardarLogotipo, removerLogotipo } from "../logotipo";

/**
 * Gestão e personalização do logótipo da sociedade.
 *
 * Permite que a sociedade carregue a sua imagem de marca para exibição na barra
 * lateral do portal em substituição do logótipo "LexFlow".
 */
export function LogotipoSociedade({
  temLogotipo,
  nomeLogotipo,
  atualizadoEm,
}: {
  temLogotipo: boolean;
  nomeLogotipo: string | null;
  atualizadoEm: Date | null;
}) {
  const router = useRouter();
  const [erros, setErros] = useState<Record<string, string[]>>({});
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [aGuardar, transicaoGuardar] = useTransition();
  const [aRemover, transicaoRemover] = useTransition();
  const formulario = useRef<HTMLFormElement>(null);

  const emProcessamento = aGuardar || aRemover;

  const enviar = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    setMensagem(null);
    setSucesso(null);

    transicaoGuardar(async () => {
      try {
        const r = await guardarLogotipo(fd);
        if (!r.ok) {
          setErros(r.erros ?? {});
          setMensagem(r.mensagem);
          return;
        }
        setErros({});
        setSucesso("Logótipo guardado com sucesso. A barra lateral passa a exibir a marca da sociedade.");
        formulario.current?.reset();
        router.refresh();
      } catch {
        setMensagem("O servidor não respondeu. Verifique a ligação e tente de novo.");
      }
    });
  };

  const apagar = () => {
    setMensagem(null);
    setSucesso(null);

    transicaoRemover(async () => {
      try {
        const r = await removerLogotipo();
        if (!r.ok) {
          setMensagem(r.mensagem);
          return;
        }
        setErros({});
        setSucesso("Logótipo removido. O portal passa a utilizar o logótipo «LexFlow».");
        formulario.current?.reset();
        router.refresh();
      } catch {
        setMensagem("O servidor não respondeu. Verifique a ligação e tente de novo.");
      }
    });
  };

  const urlLogotipo = temLogotipo
    ? `/api/sociedade/logotipo?t=${atualizadoEm ? new Date(atualizadoEm).getTime() : Date.now()}`
    : null;

  return (
    <section className="border-linha bg-papel-alto flex flex-col gap-4 rounded-sm border p-4">
      <div>
        <h2 className="text-lg">Logótipo da sociedade</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Personalize a marca exibida na barra lateral do portal. Se não definir um logótipo próprio,
          será utilizado o logótipo genérico do software.
        </p>
      </div>

      <div className="border-linha bg-muted flex flex-col gap-3 rounded-sm border p-3">
        {temLogotipo && urlLogotipo ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="border-linha bg-sidebar flex h-14 w-36 shrink-0 items-center justify-center rounded-sm border p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={urlLogotipo}
                  alt={nomeLogotipo ?? "Logótipo da sociedade"}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{nomeLogotipo ?? "Logótipo personalizado"}</p>
                <p className="text-xs text-muted-foreground">
                  {atualizadoEm ? `Atualizado em ${formatarData(atualizadoEm)}` : "Logótipo ativo"}
                </p>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={apagar}
              disabled={emProcessamento}
              className="text-selo hover:bg-selo/10 hover:text-selo self-start sm:self-auto"
            >
              <Trash2 className="size-3.5" />
              {aRemover ? "A remover…" : "Remover logótipo"}
            </Button>
          </div>
        ) : (
          <div>
            <p className="text-latao text-sm">Ainda não tem logótipo — usa o LexFlow.</p>
            <p className="text-xs text-muted-foreground">
              Carregue a imagem da sua sociedade em formato PNG, JPEG, WEBP ou SVG (máximo 2 MB).
            </p>
          </div>
        )}
      </div>

      {mensagem && (
        <p className="border-selo/40 bg-selo/5 text-selo rounded-sm border p-3 text-sm" role="alert">
          {mensagem}
        </p>
      )}
      {sucesso && (
        <p className="border-arquivo/40 bg-arquivo/5 text-arquivo rounded-sm border p-3 text-sm">
          {sucesso}
        </p>
      )}

      <form ref={formulario} onSubmit={enviar} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ficheiro-logotipo" className="text-tinta-suave">
            Ficheiro de imagem <span className="text-selo">*</span>
          </Label>
          <input
            id="ficheiro-logotipo"
            name="logotipo"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            disabled={emProcessamento}
            className="file:bg-tinta file:text-papel-alto text-sm file:mr-3 file:rounded-sm file:border-0 file:px-3 file:py-1.5 file:text-sm"
          />
          {erros.logotipo?.[0] ? (
            <p className="text-selo text-xs" role="alert">
              {erros.logotipo[0]}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Formatos aceites: PNG, JPEG, WEBP ou SVG. Máximo 2 MB. Recomenda-se imagem com fundo transparente ou adaptada a fundos escuros.
            </p>
          )}
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={emProcessamento}>
            {temLogotipo ? <ImageIcon className="size-4" /> : <Upload className="size-4" />}
            {aGuardar ? "A guardar…" : temLogotipo ? "Substituir logótipo" : "Guardar logótipo"}
          </Button>
        </div>
      </form>
    </section>
  );
}
