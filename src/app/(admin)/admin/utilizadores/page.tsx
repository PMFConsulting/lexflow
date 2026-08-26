import Link from "next/link";
import { Ref } from "@/components/ref-processo";
import { NovoAdminPlataforma } from "@/features/plataforma/componentes/NovoAdminPlataforma";
import { listarUtilizadores } from "@/features/plataforma/consultas";

export const metadata = { title: "Utilizadores" };
export const dynamic = "force-dynamic";

const ROTULOS: Record<string, string> = {
  super_admin: "Administrador da plataforma",
  society_admin: "Administrador da sociedade",
  utilizador: "Utilizador",
};

const data = new Intl.DateTimeFormat("pt-PT", { dateStyle: "short" });

/**
 * Todas as contas da plataforma, de todas as sociedades.
 *
 * É uma vista de leitura: criar e desativar contas faz-se na página da
 * sociedade a que elas pertencem, onde está o contexto que a decisão pede. A
 * exceção são as contas de plataforma, que não pertencem a sociedade nenhuma e
 * por isso não teriam outra página onde viver.
 */
export default async function Utilizadores({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const contas = await listarUtilizadores(q);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div>
        <h1 className="text-2xl">Utilizadores</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Todas as contas do sistema. Para criar ou desativar contas de uma sociedade, abra a
          página dela.
        </p>
      </div>

      <NovoAdminPlataforma />

      <form className="border-linha bg-papel-alto flex flex-wrap items-center gap-3 rounded-sm border p-3">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Nome ou email"
          aria-label="Procurar contas"
          className="border-input bg-papel-alto focus-visible:border-ring focus-visible:ring-ring/50 h-8 min-w-0 flex-1 rounded-lg border px-2.5 text-sm focus-visible:ring-3"
        />
        <button
          type="submit"
          className="border-linha hover:border-tinta rounded-xs border px-3 py-1 text-sm"
        >
          Procurar
        </button>
      </form>

      {contas.length === 0 ? (
        <p className="border-linha rounded-sm border border-dashed py-12 text-center text-sm text-muted-foreground">
          {q ? "Nenhuma conta corresponde a essa procura." : "Ainda não há contas."}
        </p>
      ) : (
        <ul className="border-linha divide-linha bg-papel-alto divide-y rounded-sm border">
          {contas.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3">
              <span className={`min-w-0 flex-1 truncate text-sm ${c.ativo ? "" : "opacity-50"}`}>
                {c.nome}
              </span>
              <Ref className="text-xs text-muted-foreground">{c.email}</Ref>
              <span className="text-2xs border-linha rounded-xs border px-2 py-0.5">
                {ROTULOS[c.papel] ?? c.papel}
              </span>
              {c.organizacaoId ? (
                <Link
                  href={`/admin/sociedades/${c.organizacaoId}`}
                  className="text-xs underline underline-offset-4"
                >
                  {c.sociedade}
                </Link>
              ) : (
                <span className="text-xs text-muted-foreground">plataforma</span>
              )}
              {!c.ativo && (
                <span className="text-2xs border-selo/40 bg-selo/10 text-selo rounded-xs border px-2 py-0.5">
                  Desativada
                </span>
              )}
              {!c.ligado && (
                <span
                  className="text-2xs border-latao/40 bg-latao/10 text-latao rounded-xs border px-2 py-0.5"
                  title="Sem credenciais de acesso — o início de sessão não resolve."
                >
                  Sem acesso
                </span>
              )}
              <Ref className="text-2xs text-muted-foreground">{data.format(c.criadoEm)}</Ref>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
