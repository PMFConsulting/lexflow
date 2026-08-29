import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { papelUtilizador } from "@/db/schema/enums";
import { utilizador } from "@/db/schema/organizacao";
import { auth } from "./auth";

/**
 * Sessão e permissões. Três níveis desde a 0016: `super_admin` (dono da
 * plataforma, sem organização, portal `/admin`), `society_admin` (gere a sua
 * sociedade) e `utilizador` (trabalha os processos, antigo socio/advogado/assistente).
 *
 * Os `pode*` recebem o papel em `string`, não no tipo estreito — quem chama
 * já tem o valor da base de dados, e um cast por chamada seria ruído. A
 * exaustividade fica em `PORTAL_DO_PAPEL`, que o compilador obriga a cobrir.
 */

export type Papel = (typeof papelUtilizador.enumValues)[number];

/** Cookie que fixa qual sociedade ativa de uma conta multi-sociedade — partilhado entre `sessaoAtual()` e `trocarSociedade()`. */
export const COOKIE_SOCIEDADE_ATIVA = "sociedade_ativa";

/**
 * Sessão do back-office. Devolve o utilizador de domínio (papel +
 * organização), não o registo do Better Auth — é esse que decide o que pode
 * ser visto.
 *
 * BUG3-002: desde a 0025 a mesma conta pode ter uma linha `utilizador` em
 * mais de uma sociedade (único é `(organizacaoId, authUserId)`, não só
 * `authUserId`). Um `.limit(1)` sem `ORDER BY` dava ao Postgres uma ordem não
 * garantida — a pessoa caía ora numa sociedade ora noutra, sem escolher, o
 * que num KYC é o próprio risco a evitar.
 *
 * Correção em duas partes: `criadoEm` torna a ordem determinística (linha
 * mais antiga primeiro), e o cookie `sociedade_ativa`, quando válido, tem
 * prioridade sobre essa ordem. Um cookie inválido é ignorado, nunca dá acesso não autorizado.
 */
export async function sessaoAtual() {
  const sessao = await auth().api.getSession({ headers: await headers() });
  if (!sessao?.user) return null;

  const linhas = await db()
    .select()
    .from(utilizador)
    .where(eq(utilizador.authUserId, sessao.user.id))
    .orderBy(asc(utilizador.criadoEm), asc(utilizador.id));

  if (linhas.length === 0) return null;

  let eu = linhas[0];

  if (linhas.length > 1) {
    const cookieOrg = (await cookies()).get(COOKIE_SOCIEDADE_ATIVA)?.value;
    const escolhida = cookieOrg ? linhas.find((l) => l.organizacaoId === cookieOrg) : undefined;
    if (escolhida) eu = escolhida;
  }

  if (!eu || !eu.ativo || eu.apagadoEm) return null;

  return {
    conta: sessao.user,
    eu,
    /** Outras sociedades desta conta, só organizacaoId — buscar o nome aqui pagaria um SELECT extra em toda página. */
    outrasOrganizacoes: linhas
      .map((l) => l.organizacaoId)
      .filter((id): id is string => Boolean(id) && id !== eu.organizacaoId),
  };
}

/** Rota do ecrã de definição de palavra-passe — exportada para não repetir o literal em três sítios. */
export const ROTA_DEFINIR_PALAVRA_PASSE = "/definir-palavra-passe";
export const ROTA_AGUARDA_APROVACAO = "/aguarda-aprovacao";

/**
 * Exige sessão; sem ela, manda para o login. Chamada em toda página do
 * back-office.
 *
 * Dois desvios antes de devolver a sessão: aprovação da plataforma (0021) —
 * conta com `aprovado_em = null` vai para `/aguarda-aprovacao` até o
 * `super_admin` aprovar (que nunca passa por aqui, é ele quem aprova); e
 * redefinição obrigatória — `deve_redefinir_password = true` manda para o
 * ecrã de definição. Aprovação primeiro, por ser a mais externa das duas.
 *
 * Guard aqui e não no middleware: o middleware só corre sobre
 * `/api/auth/sign-in` e não tem acesso à base de dados de onde vêm as duas
 * marcas. As exceções (página de definição, ação que a fecha, ecrã de
 * espera) usam `sessaoAtual()` diretamente, para não redirecionarem para si próprias.
 */
export async function exigirSessao() {
  const s = await sessaoAtual();
  if (!s) redirect("/entrar");
  if (s.eu.papel !== "super_admin" && !s.eu.aprovadoEm) {
    redirect(ROTA_AGUARDA_APROVACAO);
  }
  if (s.eu.deveRedefinirPassword) redirect(ROTA_DEFINIR_PALAVRA_PASSE);
  return s;
}

/* --------------------------------------------------------------- os portais */

/**
 * Onde cada papel vive. `Record<Papel, string>` e não `switch` com
 * `default`: um papel novo parte a compilação aqui em vez de cair calado no
 * portal errado. Também é o destino após login — `/` despacha, o browser
 * nunca precisa de saber o papel para calcular a rota.
 */
const PORTAL_DO_PAPEL: Record<Papel, string> = {
  super_admin: "/admin",
  society_admin: "/",
  gestor: "/processos",
  utilizador: "/meus-processos",
};

export function portalDoPapel(papel: string) {
  return PORTAL_DO_PAPEL[papel as Papel] ?? "/meus-processos";
}

/* ----------------------------------------------------------- as capacidades */

/** Dono da plataforma não pertence a nenhuma sociedade — leitura legível de `organizacao_id is null`. */
export function eSuperAdmin(papel: string) {
  return papel === "super_admin";
}

/**
 * Quem vê declarações de PPE e origem dos fundos. Era o `assistente` que
 * ficava de fora (§6 do brief); com o papel extinto, quem trabalha processos
 * vê o processo todo — `gestor` (0021) entra pela mesma razão.
 */
export function podeVerPpe(papel: string) {
  return (
    papel === "society_admin" ||
    papel === "gestor" ||
    papel === "utilizador"
  );
}

/**
 * Quem pode aprovar ou rejeitar um processo.
 * Apenas a equipa da sociedade (society_admin, gestor, utilizador).
 * O super_admin NÃO pode aprovar processos.
 */
export function podeAprovarProcesso(papel: string) {
  return (
    papel === "society_admin" ||
    papel === "gestor" ||
    papel === "utilizador"
  );
}

/**
 * Quem pode reabrir um processo (Frente M).
 * Apenas administradores da sociedade e gestores (ou o super_admin transversal).
 * Utilizadores regulares não têm permissão para reabrir processos.
 */
export function podeReabrirProcesso(papel: string) {
  return (
    papel === "society_admin" ||
    papel === "gestor" ||
    papel === "super_admin"
  );
}

/**
 * Quem pode reenviar o link de acesso ao cliente (BUG3-005). Só
 * `society_admin`/`super_admin`, nem `gestor` nem `utilizador` — é
 * administração de acesso, mais restrito que `podeReabrirProcesso` de propósito.
 */
export function podeReenviarLinkProcesso(papel: string) {
  return papel === "society_admin" || papel === "super_admin";
}

/**
 * Diário de emails é administração da sociedade — página de diagnóstico, não
 * trabalho do dia. `super_admin` também não entra: os emails são de uma
 * sociedade e ele não está em nenhuma.
 */
export function podeVerEmails(papel: string) {
  return papel === "society_admin";
}

/** Quem cria contas: `super_admin` em qualquer sociedade, `society_admin` na sua — `gestor`/`utilizador` não criam nenhuma. */
export function podeGerirUtilizadores(papel: string) {
  return papel === "super_admin" || papel === "society_admin";
}

/**
 * Quem pode aprovar utilizadores propostos pelas sociedades.
 * Só o super_admin da plataforma.
 */
export function podeAprovarUtilizadores(papel: string) {
  return papel === "super_admin";
}

/**
 * Verifica se quem está autenticado tem permissão de acesso a uma dada sociedade.
 *
 * O `super_admin` tem acesso transversal a todas as sociedades.
 * Os utilizadores com sociedade (`society_admin`, `gestor`, `utilizador`) só podem
 * aceder à sociedade a que pertencem.
 */
export function podeAcederSociedade(
  eu: { papel: string; organizacaoId: string | null },
  organizacaoIdAlvo: string,
): boolean {
  return eSuperAdmin(eu.papel) || eu.organizacaoId === organizacaoIdAlvo;
}

/* ---------------------------------------------------------------- os guards */

/**
 * Manda quem não pertence aqui para o portal dele, não para o login — a
 * sessão é válida, só o papel é errado. Tem de estar na página em si, não só
 * na navegação: esconder a entrada na barra lateral não fecha o endereço.
 */
async function exigirPapel(permitidos: readonly Papel[]) {
  const s = await exigirSessao();
  if (!permitidos.includes(s.eu.papel)) redirect(portalDoPapel(s.eu.papel));
  return s;
}

/**
 * O mesmo, para papéis com sociedade — devolve `organizacaoId` já como
 * `string`. Sem isto, o `null` do `super_admin` viajava pelo código todo,
 * exigindo `!`/`?? ""` em cada consulta. Traduz a restrição da base de dados
 * (`utilizador_org_por_papel`) uma única vez para o sistema de tipos; o
 * `redirect` é defensivo — não há linha real que o alcance.
 */
async function exigirPapelComSociedade(permitidos: readonly Papel[]) {
  const s = await exigirPapel(permitidos);
  const organizacaoId = s.eu.organizacaoId;
  if (!organizacaoId) redirect("/entrar");
  return { ...s, eu: { ...s.eu, organizacaoId } };
}

/** Só o dono da plataforma. */
export async function exigirSuperAdmin() {
  return exigirPapel(["super_admin"]);
}

/** Só quem administra a sociedade — nome acompanha o papel `society_admin` (antigo `admin`). */
export async function exigirSocietyAdmin() {
  return exigirPapelComSociedade(["society_admin"]);
}

/**
 * A área de trabalho partilhada: processos e clientes.
 *
 * O `society_admin`, o `gestor` e o `utilizador` entram — é a equipa da sociedade.
 * O `super_admin` não entra: os processos são de uma sociedade.
 */
export async function exigirEquipaDaSociedade() {
  return exigirPapelComSociedade(["society_admin", "gestor", "utilizador"]);
}

/**
 * Acesso a processos e dados: o dono da plataforma (`super_admin`) ou a equipa
 * da sociedade (`society_admin`, `gestor`, `utilizador`).
 */
export async function exigirEquipaOuSuperAdmin() {
  return exigirPapel(["super_admin", "society_admin", "gestor", "utilizador"]);
}

/**
 * Quem pode criar contas: dono da plataforma ou administrador da sociedade.
 * Sem `ComSociedade` — `super_admin` não tem organização por definição; quem
 * chama decide em que sociedade, via `sociedadeAlvo()`.
 */
export async function exigirGestorDeUtilizadores() {
  return exigirPapel(["super_admin", "society_admin"]);
}

/** Equivalente a `exigirSocietyAdmin` — nome usado pela feature `administracao/`. */
export async function exigirAdministracao() {
  return exigirSocietyAdmin();
}
