"use client";

import { useId, useState, useTransition } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MINIMO_PALAVRA_PASSE } from "@/lib/campos";
import { redefinirPalavraPasse } from "../acoes";

/**
 * O ecrã que uma conta criada por um administrador vê antes de tudo o resto.
 *
 * Diz porquê logo à cabeça e não em letra pequena no fim: quem chega aqui
 * acabou de entrar com uma palavra-passe que lhe apareceu num email e não
 * pediu, e um formulário sem explicação a seguir a um início de sessão lê-se
 * como um erro do sistema.
 *
 * Navegação dura no fim (`window.location.assign`), como o ecrã de entrada:
 * dentro de um `useTransition` a navegação do router deixava o botão preso em
 * "A gravar…", e o que vem a seguir é uma página servida por um guard que tem
 * de voltar a ler a marca na base de dados.
 */
export function FormularioNovaPalavraPasse({ email }: { email: string }) {
  const [erros, setErros] = useState<Record<string, string>>({});
  const [aGravar, transicao] = useTransition();
  const base = useId();

  const submeter = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    setErros({});

    transicao(async () => {
      try {
        const r = await redefinirPalavraPasse({
          palavraPasse: String(fd.get("palavraPasse") ?? ""),
          confirmacao: String(fd.get("confirmacao") ?? ""),
        });

        if (!r.ok) {
          setErros(r.erros);
          return;
        }

        window.location.assign("/");
      } catch (e) {
        // Sem isto, um Server Action que rebente deixa o botão a sair de
        // "A gravar…" e mais nada — o silêncio que faz uma falha de servidor
        // parecer um clique perdido.
        console.error("[conta] redefinirPalavraPasse rebentou:", e);
        setErros({ _: "O servidor não respondeu. Recarregue a página e tente de novo." });
      }
    });
  };

  return (
    <div className="border-linha bg-papel-alto rounded-sm border p-6">
      <h1 className="mb-1 flex items-center gap-2 text-xl">
        <KeyRound className="size-4" strokeWidth={1.75} /> Defina a sua palavra-passe
      </h1>
      <p className="mb-5 text-sm text-muted-foreground">
        A palavra-passe que recebeu por email é temporária e viajou por um canal que não é
        seguro. Escolha uma sua para continuar — só a partir daí a conta é mesmo só sua.
      </p>

      <form onSubmit={submeter} className="flex flex-col gap-4">
        {/* O email visível e não editável: confirma em que conta se está a
            mexer, e dá ao gestor de palavras-passe do browser o par que ele
            precisa de guardar. */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${base}-email`} className="text-tinta-suave">Conta</Label>
          <Input
            id={`${base}-email`}
            name="email"
            type="email"
            value={email}
            readOnly
            autoComplete="username"
            className="font-mono text-muted-foreground"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${base}-nova`} className="text-tinta-suave">Palavra-passe nova</Label>
          <Input
            id={`${base}-nova`}
            name="palavraPasse"
            type="password"
            autoComplete="new-password"
            minLength={MINIMO_PALAVRA_PASSE}
            required
            autoFocus
          />
          <p className="text-2xs text-muted-foreground">
            Pelo menos {MINIMO_PALAVRA_PASSE} caracteres. Não pode ser a que recebeu por email.
          </p>
          {erros.palavraPasse && (
            <p className="text-selo text-xs" role="alert">
              {erros.palavraPasse}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${base}-confirmacao`} className="text-tinta-suave">Repita a palavra-passe</Label>
          <Input
            id={`${base}-confirmacao`}
            name="confirmacao"
            type="password"
            autoComplete="new-password"
            required
          />
          {erros.confirmacao && (
            <p className="text-selo text-xs" role="alert">
              {erros.confirmacao}
            </p>
          )}
        </div>

        {erros._ && (
          <p
            className="border-selo/40 bg-selo/10 text-selo rounded-sm border p-2.5 text-sm"
            role="alert"
          >
            {erros._}
          </p>
        )}

        <Button type="submit" disabled={aGravar} size="lg">
          {aGravar ? "A gravar…" : "Definir e entrar"}
        </Button>
      </form>
    </div>
  );
}
