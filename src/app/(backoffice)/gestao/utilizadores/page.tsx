import { exigirAdministracao } from "@/lib/sessao";
import {
  listarConvites,
  listarEquipa,
  sociedadeDe,
} from "@/features/administracao/consultas";
import { GestaoEquipa } from "@/features/administracao/componentes/GestaoEquipa";
import { perfisDosConvites } from "@/features/convites/dados";

export const metadata = { title: "Utilizadores" };
export const dynamic = "force-dynamic";

export default async function Utilizadores() {
  // A guarda está na página e não só na navegação: esconder a entrada da barra
  // lateral não fecha o endereço a quem o escreva à mão (D35).
  const { eu } = await exigirAdministracao();

  const [equipa, convites, org, perfis] = await Promise.all([
    listarEquipa(eu.organizacaoId),
    listarConvites(eu.organizacaoId),
    sociedadeDe(eu.organizacaoId),
    perfisDosConvites(eu.organizacaoId),
  ]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div>
        <h1 className="text-2xl">Utilizadores e convites</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Quem tem acesso à plataforma, com que perfil, e quem está a meio do registo. Ninguém
          entra sem concluir o percurso — a conta só nasce no último passo dele.
        </p>
      </div>

      <GestaoEquipa
        equipa={equipa}
        convites={convites}
        perfis={perfis}
        versaoTermos={org?.termosVersao ?? null}
        euId={eu.id}
      />
    </div>
  );
}
