import { redirect } from "next/navigation";
import { Users, UserCheck } from "lucide-react";
import { Ref } from "@/components/ref-processo";
import { listarUtilizadoresDoGestor } from "@/features/plataforma/consultas";
import { exigirEquipaDaSociedade, portalDoPapel } from "@/lib/sessao";

export const metadata = { title: "A minha equipa" };
export const dynamic = "force-dynamic";

const data = new Intl.DateTimeFormat("pt-PT", { dateStyle: "short" });

/**
 * Vista da equipa atribuída a um gestor.
 *
 * Apresenta em modo só-leitura todos os utilizadores associados ao gestor
 * com `gestor_id = eu.id`.
 */
export default async function EquipaDoGestorPage() {
  const { eu } = await exigirEquipaDaSociedade();

  if (eu.papel === "society_admin") {
    redirect("/utilizadores");
  }

  if (eu.papel !== "gestor") {
    redirect(portalDoPapel(eu.papel));
  }

  const membros = await listarUtilizadoresDoGestor(eu.id, eu.organizacaoId);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div>
        <h1 className="text-2xl">A minha equipa</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Utilizadores associados à sua coordenação nesta sociedade.
        </p>
      </div>

      <section className="border-linha bg-papel-alto rounded-sm border">
        <div className="border-linha flex flex-wrap items-baseline justify-between gap-2 border-b p-3">
          <h2 className="flex items-center gap-2 text-base">
            <Users className="size-4" strokeWidth={1.75} /> Utilizadores associados
          </h2>
          <span className="text-xs text-muted-foreground">
            {membros.length === 0
              ? "nenhum utilizador"
              : `${membros.length} ${membros.length === 1 ? "utilizador" : "utilizadores"}`}
          </span>
        </div>

        {membros.length === 0 ? (
          <div className="border-linha m-4 flex flex-col items-center justify-center rounded-sm border border-dashed py-8 text-center">
            <UserCheck className="text-tinta-suave mb-2 size-6" strokeWidth={1.5} />
            <p className="text-sm font-medium">Sem utilizadores associados</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Ainda não tem utilizadores associados à sua coordenação. O administrador da sociedade
              pode associar novos utilizadores ao seu perfil.
            </p>
          </div>
        ) : (
          <ul className="divide-linha divide-y">
            {membros.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3">
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
                <Ref className="text-2xs text-muted-foreground">{data.format(m.criadoEm)}</Ref>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
