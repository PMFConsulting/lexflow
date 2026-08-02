"use client";

import { useRef, useState, useTransition } from "react";
import { Paperclip, Trash2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { carregarDocumento, removerDocumento } from "../documentos";

type Anexo = { id: string; nome: string; tipo: string; bytes: number };

const ROTULOS: Record<string, string> = {
  identificacao: "Documento de identificação",
  comprovativo_nif: "Comprovativo de NIF",
  certidao_permanente: "Certidão permanente",
  procuracao: "Procuração",
  ata_designacao: "Ata de designação",
  comprovativo_rcbe: "Comprovativo RCBE",
  outro: "Outro",
};

const kb = (b: number) => (b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

/**
 * Anexos de um passo.
 *
 * O formulário real tem um dropzone genérico. Aqui pede-se a categoria, porque
 * sem ela o painel não consegue avisar que um documento de identificação está
 * a expirar — e esse aviso é meio ponto do brief.
 */
export function Anexos({
  token,
  tipos,
  iniciais,
  titulo,
  ajuda,
}: {
  token: string;
  tipos: string[];
  iniciais: Anexo[];
  titulo: string;
  ajuda?: string;
}) {
  const [anexos, setAnexos] = useState<Anexo[]>(iniciais);
  const [tipo, setTipo] = useState(tipos[0]);
  const [erro, setErro] = useState<string | null>(null);
  const [aCarregar, transicao] = useTransition();
  const entrada = useRef<HTMLInputElement>(null);

  const escolher = (lista: FileList | null) => {
    const f = lista?.[0];
    if (!f) return;
    setErro(null);

    const fd = new FormData();
    fd.set("ficheiro", f);
    fd.set("tipo", tipo);

    transicao(async () => {
      const r = await carregarDocumento(token, fd);
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      setAnexos((a) => [...a, { id: r.id, nome: r.nome, tipo, bytes: f.size }]);
      if (entrada.current) entrada.current.value = "";
    });
  };

  const remover = (id: string) =>
    transicao(async () => {
      const r = await removerDocumento(token, id);
      if (r.ok) setAnexos((a) => a.filter((x) => x.id !== id));
    });

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg">{titulo}</h2>
        {ajuda && <p className="mt-1 text-sm text-muted-foreground">{ajuda}</p>}
      </div>

      {anexos.length > 0 && (
        <ul className="border-linha divide-linha divide-y rounded-sm border">
          {anexos.map((a) => (
            <li key={a.id} className="flex items-center gap-3 p-2.5">
              <Paperclip className="text-tinta-suave size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{a.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {ROTULOS[a.tipo] ?? a.tipo} · {kb(a.bytes)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remover(a.id)}
                disabled={aCarregar}
                className="text-muted-foreground hover:text-selo p-2 transition-colors"
                aria-label={`Remover ${a.nome}`}
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="border-linha bg-papel-alto flex flex-col gap-3 rounded-sm border border-dashed p-4">
        {tipos.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`tipo-${titulo}`}>Tipo de documento</Label>
            <select
              id={`tipo-${titulo}`}
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className="border-input bg-papel-alto h-9 rounded-sm border px-3 text-sm"
            >
              {tipos.map((t) => (
                <option key={t} value={t}>
                  {ROTULOS[t] ?? t}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`ficheiro-${titulo}`}>Ficheiro</Label>
          <input
            id={`ficheiro-${titulo}`}
            ref={entrada}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
            disabled={aCarregar}
            onChange={(e) => escolher(e.target.files)}
            className="file:bg-tinta file:text-papel-alto text-sm file:mr-3 file:rounded-sm file:border-0 file:px-3 file:py-1.5 file:text-sm"
          />
          <p className="text-xs text-muted-foreground">
            PDF, JPG, PNG, WEBP ou HEIC. Máximo 4 MB.
          </p>
        </div>

        {aCarregar && <p className="text-xs text-muted-foreground">A carregar…</p>}
        {erro && (
          <p className="text-selo text-xs" role="alert">
            {erro}
          </p>
        )}
      </div>
    </section>
  );
}
