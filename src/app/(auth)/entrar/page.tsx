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

      // Ver a nota em FormularioRegisto: navegação dura para o servidor ler o
      // cookie da sessão nova, e para o botão não ficar preso.
      window.location.assign("/");
    });
  };

  return (
    <div className="flex flex-col gap-6">
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

      <ComoFunciona />
    </div>
  );
}

const PASSOS = [
  {
    numero: "01",
    titulo: "Registar",
    descricao:
      "Só emails autorizados pela sociedade criam conta (socio@pmf.local, advogado@pmf.local, assistente@pmf.local). Palavra-passe com mínimo de 12 caracteres.",
  },
  {
    numero: "02",
    titulo: "Entrar",
    descricao: "Email + palavra-passe. Sessão de 8 horas, um dia de trabalho.",
  },
  {
    numero: "03",
    titulo: "Criar processos",
    descricao:
      "No Painel, o botão Novo processo gera o link mágico de onboarding — mostrado uma única vez. O cliente preenche os 6 passos, assina e submete.",
  },
  {
    numero: "04",
    titulo: "Ver os dados",
    descricao:
      "Lista de processos com pesquisa, detalhe com os 6 passos, risco e auditoria imutável com cadeia de hashes (nada se apaga nem se altera).",
  },
] as const;

function ComoFunciona() {
  return (
    <div className="border-linha bg-papel-alto rounded-sm border p-6">
      <h2 className="text-2xs mb-5 font-mono tracking-[0.16em] text-muted-foreground uppercase">
        Como funciona a POC
      </h2>
      <ol className="flex flex-col gap-5">
        {PASSOS.map((passo) => (
          <li key={passo.numero} className="flex gap-4">
            <span
              className="border-latao/30 bg-latao/8 text-latao grid size-9 shrink-0 place-items-center rounded-full border font-mono text-sm font-medium tabular-nums"
              aria-hidden="true"
            >
              {passo.numero}
            </span>
            <div>
              <p className="text-sm font-medium">{passo.titulo}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{passo.descricao}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
