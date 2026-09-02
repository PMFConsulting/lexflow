"use client";

import { useState, useTransition } from "react";
import { Users, UserCheck, Plus, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Ref } from "@/components/ref-processo";
import { formatarDataCurta } from "@/lib/datas";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { associarUtilizadorEquipa, removerUtilizadorEquipa } from "@/features/plataforma/acoes";

type Membro = {
  id: string;
  nome: string;
  email: string;
  ativo: boolean;
  aprovadoEm: Date | null;
  criadoEm: Date;
};

type Elegivel = {
  id: string;
  nome: string;
  email: string;
};

export function GestaoEquipa({
  membros,
  elegiveis,
}: {
  membros: Membro[];
  elegiveis: Elegivel[];
}) {
  const [isPending, startTransition] = useTransition();
  const [selecionado, setSelecionado] = useState<string>("");

  function associar() {
    if (!selecionado) return;
    startTransition(async () => {
      const res = await associarUtilizadorEquipa(selecionado);
      if (res.ok) {
        toast.success("Utilizador associado à equipa.");
        setSelecionado("");
      } else {
        toast.error(res.erro);
      }
    });
  }

  function remover(id: string) {
    startTransition(async () => {
      const res = await removerUtilizadorEquipa(id);
      if (res.ok) {
        toast.success("Utilizador removido da equipa.");
      } else {
        toast.error(res.erro);
      }
    });
  }

  return (
    <section className="border-linha bg-papel-alto rounded-sm border">
      <div className="border-linha flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <h2 className="flex items-center gap-2 text-base">
          <Users className="size-4" strokeWidth={1.75} /> Utilizadores associados
        </h2>
        
        <div className="flex items-center gap-2">
          {elegiveis.length > 0 && (
            <>
              <Select value={selecionado} onValueChange={setSelecionado} disabled={isPending}>
                <SelectTrigger className="h-8 w-48 text-xs">
                  <SelectValue placeholder="Selecione para adicionar..." />
                </SelectTrigger>
                <SelectContent>
                  {elegiveis.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button 
                size="sm" 
                className="h-8" 
                onClick={associar} 
                disabled={!selecionado || isPending}
              >
                {isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="mr-1 size-4" />}
                Adicionar
              </Button>
            </>
          )}
          <span className="text-xs text-muted-foreground ml-2">
            {membros.length === 0
              ? "nenhum utilizador"
              : `${membros.length} ${membros.length === 1 ? "utilizador" : "utilizadores"}`}
          </span>
        </div>
      </div>

      {membros.length === 0 ? (
        <div className="border-linha m-4 flex flex-col items-center justify-center rounded-sm border border-dashed py-8 text-center">
          <UserCheck className="text-tinta-suave mb-2 size-6" strokeWidth={1.5} />
          <p className="text-sm font-medium">Sem utilizadores associados</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Ainda não tem utilizadores associados à sua coordenação. 
            {elegiveis.length > 0 ? " Adicione utilizadores usando o menu acima." : " O administrador da sociedade pode criar novos utilizadores para o seu perfil."}
          </p>
        </div>
      ) : (
        <ul className="divide-linha divide-y">
          {membros.map((m) => (
            <li key={m.id} className="group flex flex-wrap items-center gap-x-4 gap-y-1 p-3">
              <span className={`min-w-0 flex-1 truncate text-sm ${m.ativo ? "" : "opacity-50"}`}>
                {m.nome}
              </span>
              <Ref className="text-xs text-muted-foreground">{m.email}</Ref>
              <span className="text-2xs border-linha rounded-sm border px-2 py-0.5">
                Utilizador
              </span>
              {m.aprovadoEm === null && (
                <span
                  className="text-2xs border-latao/40 bg-latao/10 text-latao rounded-sm border px-2 py-0.5"
                  title="A aguardar aprovação da plataforma"
                >
                  A aguardar aprovação
                </span>
              )}
              {!m.ativo && (
                <span className="text-2xs border-selo/40 bg-selo/10 text-selo rounded-sm border px-2 py-0.5">
                  Desativada
                </span>
              )}
              <Ref className="text-2xs text-muted-foreground">{formatarDataCurta(m.criadoEm)}</Ref>
              <Button
                variant="ghost"
                size="icon"
                className="ml-2 h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-50 text-muted-foreground hover:text-selo"
                onClick={() => remover(m.id)}
                disabled={isPending}
                title="Remover da equipa"
              >
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
