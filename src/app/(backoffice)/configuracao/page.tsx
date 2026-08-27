import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { papelUtilizador } from "@/db/schema/enums";
import { organizacao } from "@/db/schema/organizacao";
import { exigirSocietyAdmin } from "@/lib/sessao";
import { cn } from "@/lib/utils";

export const metadata = { title: "Configuração" };
export const dynamic = "force-dynamic";

/**
 * A secção "Armazenamento" (estado da ligação, destino, pasta raiz,
 * credenciais e teste de ligação) saiu da UI a pedido do cliente. O motor
 * (`lib/storage`, a tabela de configuração, as variáveis de ambiente)
 * mantém-se intacto e continua a arquivar em cada submissão; o que desapareceu
 * foi o ecrã. A lista "Últimas sincronizações" saiu também — o registo fica na
 * base de dados, sem ocupar espaço na interface.
 *
 * O que resta é uma página **de leitura**: alguns detalhes da conta de quem
 * está autenticado e da sociedade a que pertence. Não há campos, formulários,
 * Server Actions nem botões de alterar, e é de propósito — nesta instalação
 * nada disto se muda pela interface. As contas criam-se no servidor
 * (`scripts/criar_utilizador.mjs`, D23) e a organização vem das seeds.
 */

type Papel = (typeof papelUtilizador.enumValues)[number];

/**
 * Um mapa exaustivo, e não um `Record<string, string>` com fallback: assim, um
 * papel novo no enum não passa calado a mostrar `socio` em cru na interface —
 * parte a compilação aqui, que é onde a tradução falta.
 */
const ROTULOS_PAPEL: Record<Papel, string> = {
  super_admin: "Administrador da plataforma",
  society_admin: "Administrador da sociedade",
  gestor: "Gestor",
  utilizador: "Utilizador",
};

const dataCurta = new Intl.DateTimeFormat("pt-PT", { dateStyle: "short" });

/**
 * Uma linha de detalhe. `mono` para o que é identificador — NIF, prefixo de
 * referência, datas —, que é regra do projeto e não sugestão.
 */
function Linha({
  etiqueta,
  valor,
  mono = false,
}: {
  etiqueta: string;
  valor: string;
  mono?: boolean;
}) {
  return (
    <div className="border-linha flex items-baseline justify-between gap-4 border-b py-2 last:border-0">
      <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
      <dd className={cn("text-right text-sm break-all", mono && "font-mono tabular-nums")}>
        {valor}
      </dd>
    </div>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="border-linha bg-papel-alto rounded-sm border p-4">
      <h2 className="text-lg">{titulo}</h2>
      <dl className="mt-2">{children}</dl>
    </section>
  );
}

/**
 * Só o administrador da sociedade.
 *
 * A página é de leitura e não mostra nada de perigoso, mas mostra a sociedade
 * inteira — e o portal do `utilizador` é, por definição, o que não tem
 * administração (nem emails, nem configuração, nem contas). O guard está aqui e
 * não só na barra lateral: esconder a entrada não fecha o endereço a quem o
 * escreve à mão.
 */
export default async function Configuracao() {
  const { eu } = await exigirSocietyAdmin();

  const [org] = await db()
    .select()
    .from(organizacao)
    .where(eq(organizacao.id, eu.organizacaoId))
    .limit(1);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="text-2xl">Configuração</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Detalhes da conta e da sociedade, em modo de leitura. Não há nada para
          alterar nesta página.
        </p>
      </div>

      <Bloco titulo="Conta">
        <Linha etiqueta="Nome" valor={eu.nome} />
        <Linha etiqueta="Email" valor={eu.email} />
        <Linha etiqueta="Papel" valor={ROTULOS_PAPEL[eu.papel]} />
        <Linha etiqueta="Criada em" valor={dataCurta.format(eu.criadoEm)} mono />
      </Bloco>

      <Bloco titulo="Sociedade">
        <Linha etiqueta="Nome" valor={org?.nome ?? "—"} />
        <Linha etiqueta="NIF" valor={org?.nif ?? "—"} mono />
        <Linha
          etiqueta="Prefixo de referência"
          valor={org?.prefixoReferencia ?? "—"}
          mono
        />
      </Bloco>

      <section className="border-linha bg-papel-alto rounded-sm border p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg">Modelos de Email</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Personalize o assunto e os textos dos emails enviados aos clientes (boas-vindas, confirmação de receção, rejeição e reabertura).
            </p>
          </div>
          <Link
            href="/configuracao/emails"
            className="border-linha bg-papel hover:border-tinta-suave inline-flex shrink-0 items-center justify-center rounded-sm border px-3.5 py-2 text-sm font-medium transition-colors"
          >
            Gerir modelos de email
          </Link>
        </div>
      </section>
    </div>
  );
}
