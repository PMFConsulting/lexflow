"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, CheckCircle2, Clock, TriangleAlert, UserCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Ref } from "@/components/ref-processo";
import { aprovarUtilizador, rejeitarUtilizador } from "../acoes";
import type { LinhaUtilizadorPendente } from "../consultas";
import { rotuloDoPapel } from "@/components/portal-shell";
import { formatarData } from "@/lib/datas";

const data = (d: Date) => formatarData(d, { dateStyle: "short", timeStyle: "short" });

export function AprovacoesUtilizadores({
  pendentes,
  titulo = "Aprovações pendentes",
  mostrarSociedade = true,
}: {
  pendentes: LinhaUtilizadorPendente[];
  titulo?: string;
  mostrarSociedade?: boolean;
}) {
  const [aProcessarId, setAProcessarId] = useState<string | null>(null);
  const [rejeitandoId, setRejeitandoId] = useState<string | null>(null);
  const [motivoRejeicao, setMotivoRejeicao] = useState("");
  const [mensagemSucesso, setMensagemSucesso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleAprovar = (id: string, nome: string) => {
    setErro(null);
    setMensagemSucesso(null);
    setAProcessarId(id);

    startTransition(async () => {
      try {
        const r = await aprovarUtilizador(id);
        if (!r.ok) {
          setErro(r.erro);
          return;
        }

        if (r.jaAprovado) {
          // Dois separadores abertos sobre a mesma lista, ou dois cliques
          // seguidos: dizer "credenciais enviadas" aqui era anunciar um email
          // que ninguém mandou.
          setMensagemSucesso(`A conta de ${nome} já estava aprovada — nada foi alterado.`);
          return;
        }

        if (r.emailEnviado === false) {
          setMensagemSucesso(
            `Conta de ${nome} aprovada com sucesso. No entanto, o envio do email com as credenciais falhou (${r.erroEmail ?? "erro de envio"}).`,
          );
        } else {
          setMensagemSucesso(`Conta de ${nome} aprovada com sucesso. Credenciais de acesso enviadas por email.`);
        }
      } catch (e) {
        console.error("[plataforma] aprovarUtilizador falhou:", e);
        setErro("O servidor não respondeu. Tente novamente.");
      } finally {
        setAProcessarId(null);
      }
    });
  };

  const handleRejeitar = (id: string, nome: string) => {
    setErro(null);
    setMensagemSucesso(null);
    setAProcessarId(id);

    startTransition(async () => {
      try {
        const r = await rejeitarUtilizador(id, motivoRejeicao);
        if (!r.ok) {
          setErro(r.erro);
          return;
        }

        setMensagemSucesso(`Conta de ${nome} rejeitada.`);
        setRejeitandoId(null);
        setMotivoRejeicao("");
      } catch (e) {
        console.error("[plataforma] rejeitarUtilizador falhou:", e);
        setErro("O servidor não respondeu. Tente novamente.");
      } finally {
        setAProcessarId(null);
      }
    });
  };

  return (
    <section className="border-linha bg-papel-alto flex flex-col gap-3 rounded-sm border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-medium">
          <UserCheck className="size-4" strokeWidth={1.75} /> {titulo}
        </h2>
        <span className="text-xs text-muted-foreground">
          {pendentes.length === 0
            ? "nenhum pedido pendente"
            : `${pendentes.length} ${pendentes.length === 1 ? "pedido" : "pedidos"}`}
        </span>
      </div>

      {mensagemSucesso && (
        <div className="border-arquivo/40 bg-arquivo/10 text-arquivo flex items-center gap-2 rounded-sm border p-3 text-sm">
          <CheckCircle2 className="size-4 shrink-0" />
          <span>{mensagemSucesso}</span>
        </div>
      )}

      {erro && (
        <div className="border-selo/40 bg-selo/10 text-selo flex items-center gap-2 rounded-sm border p-3 text-sm">
          <TriangleAlert className="size-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      {pendentes.length === 0 ? (
        <div className="border-linha/60 flex flex-col items-center justify-center rounded-sm border border-dashed p-8 text-center">
          <Clock className="text-tinta-suave mb-2 size-6" strokeWidth={1.5} />
          <p className="text-sm font-medium">Sem pedidos pendentes</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Todas as contas propostas pelas sociedades já foram aprovadas ou tratadas.
          </p>
        </div>
      ) : (
        <ul className="border-linha divide-linha divide-y rounded-sm border">
          {pendentes.map((u) => {
            const estaAProcessar = isPending && aProcessarId === u.id;
            const estaARejeitar = rejeitandoId === u.id;

            return (
              <li key={u.id} className="flex flex-col gap-3 p-3 sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{u.nome}</span>
                      <Ref className="text-xs text-muted-foreground">{u.email}</Ref>
                      <span className="text-2xs border-linha bg-papel rounded-sm border px-2 py-0.5">
                        {rotuloDoPapel(u.papel)}
                      </span>
                      {u.gestorNome && (
                        <span className="text-2xs border-linha text-muted-foreground rounded-sm border px-2 py-0.5">
                          Gestor: {u.gestorNome}
                        </span>
                      )}
                    </div>

                    <div className="text-2xs mt-1 flex flex-wrap items-center gap-x-3 text-muted-foreground">
                      {mostrarSociedade && u.sociedadeNome && (
                        <span>
                          Sociedade:{" "}
                          {u.organizacaoId ? (
                            <Link
                              href={`/admin/sociedades/${u.organizacaoId}`}
                              className="text-foreground underline underline-offset-2 hover:opacity-80"
                            >
                              {u.sociedadeNome}
                            </Link>
                          ) : (
                            u.sociedadeNome
                          )}
                        </span>
                      )}
                      <span>Proposto em: {data(u.criadoEm)}</span>
                    </div>
                  </div>

                  {!estaARejeitar && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => {
                          setRejeitandoId(u.id);
                          setMotivoRejeicao("");
                        }}
                        className="text-selo hover:bg-selo/10 hover:text-selo text-xs"
                      >
                        <X className="mr-1 size-3.5" /> Rejeitar
                      </Button>

                      <Button
                        size="sm"
                        disabled={isPending}
                        onClick={() => handleAprovar(u.id, u.nome)}
                        className="text-xs"
                      >
                        <Check className="mr-1 size-3.5" />
                        {estaAProcessar ? "A aprovar…" : "Aprovar"}
                      </Button>
                    </div>
                  )}
                </div>

                {estaARejeitar && (
                  <div className="border-linha/80 bg-papel mt-2 flex flex-col gap-2 rounded-sm border p-3">
                    <p className="text-xs font-medium">Rejeitar conta de {u.nome}</p>
                    <p className="text-2xs text-muted-foreground">
                      A conta será desativada e arquivada. Pode indicar um motivo para registo de auditoria.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        placeholder="Motivo da rejeição (opcional)"
                        value={motivoRejeicao}
                        onChange={(e) => setMotivoRejeicao(e.target.value)}
                        className="h-8 flex-1 text-xs"
                      />
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={isPending}
                        onClick={() => handleRejeitar(u.id, u.nome)}
                        className="text-xs"
                      >
                        {estaAProcessar ? "A rejeitar…" : "Confirmar rejeição"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        onClick={() => {
                          setRejeitandoId(null);
                          setMotivoRejeicao("");
                        }}
                        className="text-xs"
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
