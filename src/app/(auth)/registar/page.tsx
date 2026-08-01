import Link from "next/link";
import { emailsPorRegistar } from "@/features/conta/acoes";
import { FormularioRegisto } from "./FormularioRegisto";

export const metadata = { title: "Criar conta" };

/** Lê a lista de emails autorizados da base de dados — não é pré-renderizável. */
export const dynamic = "force-dynamic";

export default async function Registar() {
  const disponiveis = await emailsPorRegistar();

  return (
    <div className="border-linha bg-papel-alto rounded-sm border p-6">
      <h1 className="mb-1 text-xl">Criar conta</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        Só emails já autorizados pela sociedade podem criar conta.
      </p>

      <FormularioRegisto />

      {disponiveis.length > 0 && (
        <div className="border-linha mt-5 border-t pt-4">
          <p className="text-2xs mb-2 font-mono tracking-[0.14em] text-muted-foreground uppercase">
            Ainda por registar
          </p>
          <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
            {disponiveis.map((d) => (
              <li key={d.email} className="flex justify-between gap-3">
                <span className="font-mono">{d.email}</span>
                <span>{d.papel}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-5 text-xs text-muted-foreground">
        Já tem conta?{" "}
        <Link href="/entrar" className="underline underline-offset-2">
          Entrar
        </Link>
        .
      </p>
    </div>
  );
}
