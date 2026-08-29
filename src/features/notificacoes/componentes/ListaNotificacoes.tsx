"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  Building2,
  Check,
  CheckCheck,
  ExternalLink,
  FileText,
  Inbox,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ItemNotificacao } from "../consultas";
import { marcarNotificacaoComoLida, marcarTodasComoLidas } from "../acoes";
import { formatarData } from "@/lib/datas";

const formatadorDataHora = (d: Date | string) =>
  formatarData(d, { dateStyle: "short", timeStyle: "short" });

function obterIcone(titulo: string) {
  const t = titulo.toLowerCase();
  if (t.includes("processo")) return FileText;
  if (t.includes("sociedade")) return Building2;
  if (t.includes("utilizador") || t.includes("membro")) return UserPlus;
  return Bell;
}

export function ListaNotificacoes({
  notificacoesIniciais,
  superAdmin = false,
}: {
  notificacoesIniciais: ItemNotificacao[];
  superAdmin?: boolean;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [apenasNaoLidas, setApenasNaoLidas] = useState(false);

  const [lista, setLista] = useState(notificacoesIniciais);

  const naoLidasCount = lista.filter((n) => !n.lidaEm).length;
  const notificacoesFiltradas = apenasNaoLidas
    ? lista.filter((n) => !n.lidaEm)
    : lista;

  const aoMarcarComoLida = (id: string) => {
    setLista((prev) =>
      prev.map((n) => (n.id === id ? { ...n, lidaEm: new Date() } : n)),
    );
    startTransition(async () => {
      await marcarNotificacaoComoLida(id);
      router.refresh();
    });
  };

  const aoMarcarTodasComoLidas = () => {
    setLista((prev) => prev.map((n) => ({ ...n, lidaEm: new Date() })));
    startTransition(async () => {
      await marcarTodasComoLidas();
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Barra de Ações e Filtros */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant={!apenasNaoLidas ? "default" : "outline"}
            size="sm"
            onClick={() => setApenasNaoLidas(false)}
            className="text-xs"
          >
            Todas ({lista.length})
          </Button>
          <Button
            type="button"
            variant={apenasNaoLidas ? "default" : "outline"}
            size="sm"
            onClick={() => setApenasNaoLidas(true)}
            className="text-xs"
          >
            Não lidas ({naoLidasCount})
          </Button>
        </div>

        {naoLidasCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pendente}
            onClick={aoMarcarTodasComoLidas}
            className="text-tinta-suave hover:text-foreground text-xs"
          >
            <CheckCheck className="mr-1.5 size-3.5" />
            Marcar todas como lidas
          </Button>
        )}
      </div>

      {/* Lista de Notificações */}
      {notificacoesFiltradas.length === 0 ? (
        <div className="border-linha bg-papel-alto flex flex-col items-center justify-center rounded-sm border p-12 text-center">
          <div className="border-linha bg-papel flex size-12 items-center justify-center rounded-full border">
            <Inbox className="text-tinta-suave size-6" />
          </div>
          <p className="text-tinta mt-3 text-sm font-medium">Sem notificações</p>
          <p className="text-tinta-suave mt-1 text-xs">
            {apenasNaoLidas
              ? "Não tem notificações por ler de momento."
              : "Ainda não foram geradas notificações."}
          </p>
        </div>
      ) : (
        <div className="divide-linha border-linha bg-papel-alto divide-y rounded-sm border">
          {notificacoesFiltradas.map((item) => {
            const Icone = obterIcone(item.titulo);
            const naoLida = !item.lidaEm;

            return (
              <div
                key={item.id}
                className={cn(
                  "flex items-start justify-between gap-4 p-4 transition-colors",
                  naoLida ? "bg-papel/60 font-normal" : "opacity-80 hover:opacity-100",
                )}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-sm border",
                      naoLida
                        ? "border-verdete/40 bg-verdete/10 text-verdete"
                        : "border-linha bg-papel text-tinta-suave",
                    )}
                  >
                    <Icone className="size-4.5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p
                        className={cn(
                          "text-sm",
                          naoLida ? "font-semibold text-foreground" : "font-medium text-foreground/90",
                        )}
                      >
                        {item.titulo}
                      </p>
                      {naoLida && (
                        <span className="bg-selo/15 text-selo inline-flex items-center rounded-full px-2 py-0.5 font-mono text-2xs font-medium">
                          Nova
                        </span>
                      )}
                      {superAdmin && item.organizacaoNome && (
                        <span className="bg-papel text-tinta-suave border-linha inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-2xs">
                          {item.organizacaoNome}
                        </span>
                      )}
                    </div>

                    <p className="text-tinta-suave mt-1 text-xs whitespace-pre-line break-words">
                      {item.corpo}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <span className="text-tinta-suave/80 font-mono text-xs tabular-nums">
                        {formatadorDataHora(new Date(item.criadoEm))}
                      </span>

                      {item.link && (
                        <Link
                          href={item.link}
                          onClick={() => {
                            if (naoLida) aoMarcarComoLida(item.id);
                          }}
                          className="text-verdete hover:text-verdete/80 inline-flex items-center gap-1 font-mono text-xs font-medium underline underline-offset-2 transition-colors"
                        >
                          Ver detalhes
                          <ExternalLink className="size-3" />
                        </Link>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {naoLida && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title="Marcar como lida"
                      disabled={pendente}
                      onClick={() => aoMarcarComoLida(item.id)}
                      className="text-tinta-suave hover:text-foreground size-7"
                    >
                      <Check className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
