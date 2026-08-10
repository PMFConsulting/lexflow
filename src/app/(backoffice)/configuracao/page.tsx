import { exigirSessao } from "@/lib/sessao";

export const metadata = { title: "Configuração" };
export const dynamic = "force-dynamic";

/**
 * A secção "Armazenamento" (estado da ligação, destino, pasta raiz,
 * credenciais e teste de ligação) saiu da UI a pedido do cliente. O motor
 * (`lib/storage`, a tabela de configuração, as variáveis de ambiente)
 * mantém-se intacto e continua a arquivar em cada submissão; o que desapareceu
 * foi o ecrã. A lista "Últimas sincronizações" saiu também — o registo fica na
 * base de dados, sem ocupar espaço na interface.
 */
export default async function Configuracao() {
  await exigirSessao();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <h1 className="text-2xl">Configuração</h1>
      <p className="text-sm text-muted-foreground">
        Não há definições para alterar nesta instalação.
      </p>
    </div>
  );
}
