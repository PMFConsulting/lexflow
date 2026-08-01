"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUp } from "@/lib/auth-cliente";
import { ligarConta } from "@/features/conta/acoes";

export function FormularioRegisto() {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [jaExiste, setJaExiste] = useState(false);
  const [aCriar, transicao] = useTransition();

  const submeter = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const email = String(fd.get("email") ?? "").trim().toLowerCase();
    const password = String(fd.get("password") ?? "");
    const nome = String(fd.get("nome") ?? "").trim();
    setErro(null);

    if (password.length < 12) {
      setErro("A palavra-passe tem de ter pelo menos 12 caracteres.");
      return;
    }

    transicao(async () => {
      const r = await signUp.email({ email, password, name: nome || email });

      if (r.error) {
        // "Já existe" sem caminho para a frente é um beco. Quem chega aqui
        // quase sempre já se registou e só quer entrar.
        setJaExiste(Boolean(r.error.message?.toLowerCase().includes("exist")));
        setErro(
          r.error.message?.toLowerCase().includes("exist")
            ? "Já existe uma conta com este email."
            : "Não foi possível criar a conta.",
        );
        return;
      }

      // A conta existe no Better Auth; falta ligá-la ao utilizador de domínio,
      // que é quem tem papel e organização. Sem essa ligação não há acesso.
      const l = await ligarConta(email, r.data.user.id);
      if (!l.ok) {
        setErro(l.erro);
        return;
      }

      router.push("/");
      router.refresh();
    });
  };

  return (
    <form onSubmit={submeter} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="nome">Nome</Label>
        <Input id="nome" name="nome" autoComplete="name" />
      </div>

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
          autoComplete="new-password"
          required
          minLength={12}
        />
        <p className="text-xs text-muted-foreground">Mínimo 12 caracteres.</p>
      </div>

      {erro && (
        <div className="border-selo/40 bg-selo/10 rounded-sm border p-2.5" role="alert">
          <p className="text-selo text-sm">{erro}</p>
          {jaExiste && (
            <Link
              href="/entrar"
              className="text-selo mt-1 inline-block text-sm font-medium underline underline-offset-2"
            >
              Entrar com essa conta →
            </Link>
          )}
        </div>
      )}

      <Button type="submit" disabled={aCriar} size="lg">
        {aCriar ? "A criar…" : "Criar conta"}
      </Button>
    </form>
  );
}
