import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Ref } from "@/components/ref-processo";
import { NovoAdminPlataforma } from "@/features/plataforma/componentes/NovoAdminPlataforma";
import { listarUtilizadores } from "@/features/plataforma/consultas";
import { rotuloDoPapel } from "@/components/portal-shell";
import { formatarDataCurta } from "@/lib/datas";

export const metadata = { title: "Utilizadores" };
export const dynamic = "force-dynamic";

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
        <Input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Nome ou email"
          aria-label="Procurar contas"
          className="bg-papel-alto flex-1"
        />
        <Button type="submit" variant="outline">
          Procurar
        </Button>
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
              <span className="text-2xs border-linha rounded-sm border px-2 py-0.5">
                {rotuloDoPapel(c.papel)}
              </span>
              {c.papel === "utilizador" && c.gestorNome && (
                <span
                  className="text-2xs border-linha text-muted-foreground rounded-sm border px-2 py-0.5"
                  title={`Gestor: ${c.gestorNome}`}
                >
                  Gestor: {c.gestorNome}
                </span>
              )}
              {c.aprovadoEm === null && c.papel !== "super_admin" && (
                <span
                  className="text-2xs border-latao/40 bg-latao/10 text-latao rounded-sm border px-2 py-0.5"
                  title="A aguardar aprovação da administração da plataforma"
                >
                  Pendente
                </span>
              )}
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
                <span className="text-2xs border-selo/40 bg-selo/10 text-selo rounded-sm border px-2 py-0.5">
                  Desativada
                </span>
              )}
              {!c.ligado && (
                <span
                  className="text-2xs border-latao/40 bg-latao/10 text-latao rounded-sm border px-2 py-0.5"
                  title="Sem credenciais de acesso — o início de sessão não resolve."
                >
                  Sem acesso
                </span>
              )}
              <Ref className="text-2xs text-muted-foreground">{formatarDataCurta(c.criadoEm)}</Ref>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
