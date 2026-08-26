"use client";

import { useId, useRef, useState, useTransition } from "react";
import { ShieldUser, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { criarAdministradorDePlataforma } from "../acoes";
import type { ContaCriada } from "../contas";
import { Credenciais } from "./Credenciais";
import { Erro, ErroGeral } from "./Erro";

/**
 * Outra conta de administração da plataforma.
 *
 * Existe por uma razão de continuidade e não de comodidade: a primeira conta
 * nasce no servidor (`scripts/criar_utilizador.mjs`, D23), e uma plataforma com
 * um único dono fica inacessível no dia em que essa pessoa perde a
 * palavra-passe — sem ninguém que possa criar outra sem acesso ao servidor.
 *
 * Fica atrás de um clique e com o aviso à frente, e não escondido: o que estas
 * contas veem é **todas** as sociedades, e quem as cria deve ler isso antes de
 * escrever o email, não a seguir.
 */
export function NovoAdminPlataforma() {
  const [aberto, setAberto] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [criadas, setCriadas] = useState<ContaCriada[]>([]);
  const [aGravar, transicao] = useTransition();
  const formulario = useRef<HTMLFormElement>(null);
  const base = useId();

  const submeter = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    setErros({});

    transicao(async () => {
      try {
        const r = await criarAdministradorDePlataforma({
          nome: String(fd.get("nome") ?? ""),
          email: String(fd.get("email") ?? ""),
          palavraPasse: String(fd.get("palavraPasse") ?? "").trim() || undefined,
        });

        if (!r.ok) {
          setErros(r.erros);
          return;
        }

        setCriadas((c) => [...c, r.conta]);
        formulario.current?.reset();
      } catch (e) {
        console.error("[plataforma] criarAdministradorDePlataforma rebentou:", e);
        setErros({ _: "O servidor não respondeu. Recarregue a página e tente de novo." });
      }
    });
  };

  return (
    <section className="border-linha bg-papel-alto rounded-sm border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base">
            <ShieldUser className="size-4" strokeWidth={1.75} /> Administração da plataforma
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Contas sem sociedade, que veem e gerem todas as sociedades do sistema.
          </p>
        </div>
        <Button variant="outline" onClick={() => setAberto((a) => !a)}>
          {aberto ? "Cancelar" : "Criar conta de plataforma"}
        </Button>
      </div>

      <Credenciais contas={criadas} titulo="Conta de plataforma criada" />

      {aberto && (
        <form ref={formulario} onSubmit={submeter} className="mt-4 flex flex-col gap-4">
          <p className="border-selo/40 bg-selo/10 text-selo flex items-start gap-2 rounded-sm border p-2.5 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              Esta conta vê e gere <strong>todas</strong> as sociedades da plataforma, incluindo
              a criação de contas dentro delas. Crie-a só para quem administra o sistema.
            </span>
          </p>

          <ErroGeral erros={erros} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${base}-nome`}>Nome</Label>
              <Input id={`${base}-nome`} name="nome" required autoComplete="off" />
              <Erro erros={erros} campo="nome" />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${base}-email`}>Email</Label>
              <Input id={`${base}-email`} name="email" type="email" required autoComplete="off" />
              <Erro erros={erros} campo="email" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${base}-pw`}>Palavra-passe (opcional)</Label>
            <Input
              id={`${base}-pw`}
              name="palavraPasse"
              className="font-mono"
              autoComplete="new-password"
            />
            <p className="text-2xs text-muted-foreground">
              Em branco, é gerada — e mostrada uma única vez a seguir.
            </p>
            <Erro erros={erros} campo="palavraPasse" />
          </div>

          <Button type="submit" disabled={aGravar} className="self-start">
            {aGravar ? "A criar…" : "Criar conta de plataforma"}
          </Button>
        </form>
      )}
    </section>
  );
}
