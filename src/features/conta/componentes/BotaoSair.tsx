"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { signOut } from "@/lib/auth-cliente";

export function BotaoSair() {
  const router = useRouter();
  const [aSair, transicao] = useTransition();

  return (
    <button
      type="button"
      disabled={aSair}
      onClick={() =>
        transicao(async () => {
          await signOut();
          router.push("/entrar");
          router.refresh();
        })
      }
      className="inline-flex items-center gap-1.5 text-xs opacity-70 transition-opacity hover:opacity-100"
    >
      <LogOut className="size-3.5" />
      {aSair ? "A sair…" : "Sair"}
    </button>
  );
}
