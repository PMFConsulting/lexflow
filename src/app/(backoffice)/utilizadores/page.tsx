import { GestaoUtilizadores } from "@/features/plataforma/componentes/GestaoUtilizadores";
import { utilizadoresDaSociedade } from "@/features/plataforma/consultas";
import { exigirSocietyAdmin } from "@/lib/sessao";

export const metadata = { title: "Utilizadores" };
export const dynamic = "force-dynamic";

/**
 * As contas da própria sociedade.
 *
 * O `super_admin` cria sociedades e dá-lhes o primeiro administrador; a partir
 * daí é a sociedade que se gere a si própria. Sem esta página, cada colaborador
 * novo obrigava a pedir ao dono da plataforma — o que transforma o dono da
 * infraestrutura no departamento de recursos humanos de toda a gente.
 *
 * É o **mesmo componente** de `/admin/sociedades/[id]`, e a sociedade que o
 * servidor usa não é a que vai neste parâmetro: para um `society_admin`,
 * `sociedadeAlvo()` substitui-a sempre pela dele. O valor daqui é o que faz o
 * ecrã funcionar, não o que decide onde se escreve.
 */
export default async function UtilizadoresDaSociedade() {
  const { eu } = await exigirSocietyAdmin();
  const contas = await utilizadoresDaSociedade(eu.organizacaoId);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div>
        <h1 className="text-2xl">Utilizadores</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          As contas da sua sociedade. Um administrador gere contas, emails e configuração; um
          gestor coordena um grupo de utilizadores; um utilizador trabalha os processos. É aqui —
          e só aqui — que se define a quem cada utilizador reporta.
        </p>
      </div>

      <GestaoUtilizadores organizacaoId={eu.organizacaoId} contas={contas} />
    </div>
  );
}
