import { redirect } from "next/navigation";
import { listarUtilizadoresDoGestor, listarUtilizadoresElegiveisParaGestor } from "@/features/plataforma/consultas";
import { exigirEquipaDaSociedade, portalDoPapel } from "@/lib/sessao";
import { GestaoEquipa } from "./gestao";

export const metadata = { title: "A minha equipa" };
export const dynamic = "force-dynamic";

/**
 * Vista da equipa atribuída a um gestor.
 *
 * Apresenta todos os utilizadores associados ao gestor
 * com `gestor_id = eu.id`, e permite associar/remover.
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
  const elegiveis = await listarUtilizadoresElegiveisParaGestor(eu.organizacaoId);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div>
        <h1 className="text-2xl">A minha equipa</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Utilizadores associados à sua coordenação nesta sociedade.
        </p>
      </div>

      <GestaoEquipa membros={membros} elegiveis={elegiveis} />
    </div>
  );
}
