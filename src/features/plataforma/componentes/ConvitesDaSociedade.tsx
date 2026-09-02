import { Ref } from "@/components/ref-processo";
import { rotuloDoPapel } from "@/components/portal-shell";
import { PreencherPerfil } from "@/features/convites/componentes/PreencherPerfil";
import { exerceAdvocacia } from "@/features/convites/passos";
import type { PerfilAdiantado } from "@/features/convites/dados";
import type { LinhaConvite } from "@/features/administracao/consultas";
import { formatarDataCurta } from "@/lib/datas";

/**
 * Os convites por aceitar desta sociedade, do lado do dono da plataforma.
 *
 * Existe por uma razão só: sem ele, preencher a ficha de quem foi convidado é
 * uma capacidade que o `super_admin` tem no servidor e não tem em lado nenhum
 * do ecrã. Convidar, reenviar e cancelar continuam a ser do administrador da
 * sociedade — é a equipa dele, e a lista dela está em `/gestao/utilizadores`.
 */
export function ConvitesDaSociedade({
  organizacaoId,
  convites,
  perfis,
}: {
  organizacaoId: string;
  convites: LinhaConvite[];
  perfis: Record<string, PerfilAdiantado>;
}) {
  const pendentes = convites.filter((c) => c.estado === "pendente");

  return (
    <section className="border-linha bg-papel-alto rounded-sm border p-4">
      <h2 className="text-base">Convites por aceitar</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Quem foi convidado e ainda não concluiu o registo. Pode adiantar-lhe os dados pessoais e
        profissionais — os documentos, o sigilo, os Termos e Condições e a palavra-passe continuam
        a ser atos da própria pessoa.
      </p>

      {pendentes.length === 0 ? (
        <p className="border-linha mt-3 rounded-sm border border-dashed py-8 text-center text-sm text-muted-foreground">
          Não há convites por aceitar nesta sociedade.
        </p>
      ) : (
        <ul className="border-linha divide-linha mt-3 divide-y rounded-sm border">
          {pendentes.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{c.nome}</p>
                <p className="truncate text-xs text-muted-foreground">
                  <Ref>{c.email}</Ref> · {rotuloDoPapel(c.papel)} · passo {c.passoAtual} de 6
                </p>
                <p className="text-2xs mt-0.5 text-muted-foreground">
                  Válido até{" "}
                  {c.expiraEm ? formatarDataCurta(new Date(c.expiraEm)) : "sem prazo"}
                  {perfis[c.id] ? " · ficha já iniciada" : ""}
                </p>
              </div>

              <PreencherPerfil
                key={`${c.id}-${organizacaoId}`}
                conviteId={c.id}
                nome={c.nome}
                email={c.email}
                exerce={exerceAdvocacia(c.papel)}
                inicial={perfis[c.id] ?? null}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
