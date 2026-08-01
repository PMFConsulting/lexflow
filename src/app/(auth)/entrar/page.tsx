"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/lib/auth-cliente";

export default function Entrar() {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [aEntrar, transicao] = useTransition();

  const submeter = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    setErro(null);

    transicao(async () => {
      const r = await signIn.email({
        email: String(fd.get("email") ?? "").trim().toLowerCase(),
        password: String(fd.get("password") ?? ""),
      });

      if (r.error) {
        // Mensagem única de propósito: dizer "este email não existe" confirma
        // a quem tenta que os outros existem.
        setErro("Email ou palavra-passe incorretos.");
        return;
      }

      router.push("/");
      router.refresh();
    });
  };

  return (
    <div className="border-linha bg-papel-alto rounded-sm border p-6">
      <h1 className="mb-1 text-xl">Entrar</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        Acesso restrito à equipa da sociedade.
      </p>

      <form onSubmit={submeter} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="username" required />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Palavra-passe</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>

        {erro && (
          <p className="border-selo/40 bg-selo/10 text-selo rounded-sm border p-2.5 text-sm" role="alert">
            {erro}
          </p>
        )}

        <Button type="submit" disabled={aEntrar} size="lg">
          {aEntrar ? "A entrar…" : "Entrar"}
        </Button>
      </form>

      <p className="mt-5 text-xs text-muted-foreground">
        Primeira vez?{" "}
        <Link href="/registar" className="underline underline-offset-2">
          Criar a sua conta
        </Link>
        .
      </p>
    </div>
  );
}
