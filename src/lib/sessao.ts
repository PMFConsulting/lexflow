import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { papelUtilizador } from "@/db/schema/enums";
import { utilizador } from "@/db/schema/organizacao";
import { auth } from "./auth";

/**
 * Sessão e permissões.
 *
 * Três níveis, desde a migração `0016` (ver `db/schema/enums.ts`):
 *
 * - `super_admin` — dono da plataforma. Não pertence a sociedade nenhuma
 *   (`organizacao_id` é NULL) e o portal dele é `/admin`: sociedades e as
 *   contas delas.
 * - `society_admin` — gere a sua sociedade. É o back-office de sempre.
 * - `utilizador` — trabalha os processos da sua sociedade. É o que eram o
 *   `socio`, o `advogado` e o `assistente`.
 *
 * Os `pode*` continuam a receber o papel em `string` e não o tipo estreito, e é
 * de propósito: quem os chama tem o papel vindo da base de dados, e um `cast`
 * em cada sítio de chamada era mais ruído do que segurança. A garantia de
 * exaustividade está onde interessa — em `PORTAL_DO_PAPEL`, que o compilador
 * obriga a cobrir os três.
 */

export type Papel = (typeof papelUtilizador.enumValues)[number];

/**
 * Back-office session.
 *
 * Returns the domain user — the one with a role and an organisation — and not
 * the Better Auth record. That is the one that matters for deciding what can be
 * seen.
 */
export async function sessaoAtual() {
  const sessao = await auth().api.getSession({ headers: await headers() });
  if (!sessao?.user) return null;

  const [eu] = await db()
    .select()
    .from(utilizador)
    .where(eq(utilizador.authUserId, sessao.user.id))
    .limit(1);

  if (!eu || !eu.ativo || eu.apagadoEm) return null;
  return { conta: sessao.user, eu };
}

/**
 * Onde vive o ecrã de definição de palavra-passe.
 *
 * Exportado porque é o mesmo endereço em três sítios — o guard aqui, a página
 * que ele serve e a ação que a fecha — e um literal repetido três vezes é um
 * `redirect` para uma página que deixou de existir no dia em que a rota mudar.
 */
export const ROTA_DEFINIR_PALAVRA_PASSE = "/definir-palavra-passe";

/**
 * Requires a session. Without one, it goes to the login screen.
 *
 * Called on every back-office page: a system holding PEP declarations and
 * identification documents cannot have a single page left open by oversight.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A redefinição obrigatória, e porque é aqui
 *
 * Uma conta criada por um administrador nasce com uma palavra-passe gerada e
 * enviada por email — um segredo que viajou por um canal que não é secreto.
 * Enquanto `deve_redefinir_password` estiver a `true`, esta função não deixa
 * passar: manda para o ecrã de definição, e mais nada.
 *
 * **O guard é este e não o `middleware`.** O middleware desta instalação só
 * corre sobre `/api/auth/sign-in` de propósito (ver a nota lá) e não tem acesso
 * à base de dados de onde esta marca vem — a sessão do Better Auth diz quem é a
 * pessoa, não o que falta a essa pessoa. Pôr a decisão aqui é pô-la no mesmo
 * sítio por onde já passam todas as páginas e todos os Server Actions
 * autenticados: os guards de papel chamam esta função, e uma página nova que se
 * esqueça do desvio não existe — teria de se esquecer também da sessão.
 *
 * As duas exceções óbvias — a página de definição e a ação que a fecha — usam
 * `sessaoAtual()` diretamente. É a única forma de não ficarem a redirecionar
 * para si próprias.
 */
export async function exigirSessao() {
  const s = await sessaoAtual();
  if (!s) redirect("/entrar");
  if (s.eu.deveRedefinirPassword) redirect(ROTA_DEFINIR_PALAVRA_PASSE);
  return s;
}

/* --------------------------------------------------------------- os portais */

/**
 * Onde é que cada papel vive.
 *
 * Um `Record<Papel, string>` e não um `switch` com `default`: o dia em que
 * nascer um quarto nível, isto parte a compilação aqui — que é onde falta a
 * decisão — em vez de o mandar calado para o portal errado.
 *
 * É também o destino a seguir ao início de sessão. O ecrã de entrada manda
 * toda a gente para `/`, e é `/` que despacha: assim o browser nunca precisa de
 * saber o papel de quem entra para calcular um destino, e a decisão fica num
 * sítio só.
 */
const PORTAL_DO_PAPEL: Record<Papel, string> = {
  super_admin: "/admin",
  society_admin: "/",
  utilizador: "/meus-processos",
};

export function portalDoPapel(papel: string) {
  return PORTAL_DO_PAPEL[papel as Papel] ?? "/meus-processos";
}

/* ----------------------------------------------------------- as capacidades */

/**
 * O dono da plataforma não é parte de nenhuma sociedade.
 *
 * O papel sozinho quase nunca é o que decide: o isolamento real vem de
 * `organizacao_id` ser NULL, e das consultas do back-office compararem sempre a
 * organização do processo com a de quem lê. Isto é a leitura legível dessa
 * mesma condição.
 */
export function eSuperAdmin(papel: string) {
  return papel === "super_admin";
}

/**
 * Quem vê as declarações de PPE e a origem dos fundos.
 *
 * Era o `assistente` que ficava de fora (§6 do brief), e o `assistente`
 * desapareceu: quem trabalha processos passou a ver o processo todo. O corte
 * mudou de sítio, não desapareceu — quem fica de fora agora é o `super_admin`.
 *
 * Isso pode ler-se como uma contradição com o "vê tudo" que ele tem: não é. O
 * que ele vê é a **plataforma** — que sociedades existem, que contas têm, quem
 * as criou. Uma declaração de pessoa politicamente exposta é o dado mais
 * sensível que aqui há, é de um cliente de uma sociedade concreta, e o dono da
 * infraestrutura não tem razão nenhuma de negócio para lhe pôr os olhos em
 * cima. Na prática nem chega lá — o detalhe de processo compara organizações e
 * a dele é NULL —, e isto é a mesma regra dita à frente, em vez de ficar a
 * depender de um efeito lateral.
 */
export function podeVerPpe(papel: string) {
  return !eSuperAdmin(papel);
}

/**
 * Quem pode aprovar ou rejeitar um processo.
 *
 * Mesma fronteira da PPE, e pela mesma razão. A decisão sobre um cliente —
 * que dispara o email de boas-vindas ou uma rejeição — é da sociedade que o
 * aceita, e quem a toma assina-a: `aprovado_por` guarda o `utilizador.id`.
 *
 * O `utilizador` mantém a aprovação de propósito. Ele herda o antigo
 * `advogado`, que aprovava; tirar-lha na migração era uma capacidade a
 * desaparecer sem aviso, e o dia em que se dá por ela é o dia em que alguém
 * não consegue fechar um processo.
 */
export function podeAprovarProcesso(papel: string) {
  return !eSuperAdmin(papel);
}

/**
 * O diário de emails é administração da sociedade.
 *
 * A lista mostra a quem a sociedade escreveu e quando — endereços de clientes,
 * lado a lado, numa página só. É para diagnóstico, não para o trabalho do dia,
 * e não há razão para estar ao alcance de quem preenche processos.
 *
 * O `super_admin` também não entra: os emails são de uma sociedade e ele não
 * está em nenhuma. O portal dele é outro.
 */
export function podeVerEmails(papel: string) {
  return papel === "society_admin";
}

/**
 * Quem cria contas dentro de uma sociedade.
 *
 * O `super_admin` cria em qualquer uma (é ele quem abre a sociedade e lhe dá o
 * primeiro administrador); o `society_admin` cria na sua. O `utilizador` não
 * cria nenhuma — dar acesso a um sistema de KYC é uma decisão de administração.
 */
export function podeGerirUtilizadores(papel: string) {
  return papel === "super_admin" || papel === "society_admin";
}

/* ---------------------------------------------------------------- os guards */

/**
 * Manda quem não pertence aqui para o portal dele — e não para o início de
 * sessão.
 *
 * A diferença conta: quem chega a uma página sem ter papel para ela **tem**
 * sessão válida, e mandá-lo autenticar-se outra vez sugeria que o problema era
 * a sessão. Passa a cair no sítio onde efetivamente trabalha.
 *
 * O guard tem de estar na página (ou no layout que a serve) e não só na
 * navegação: esconder a entrada na barra lateral é cortesia, não é fechar o
 * endereço a quem o escreve à mão.
 */
async function exigirPapel(permitidos: readonly Papel[]) {
  const s = await exigirSessao();
  if (!permitidos.includes(s.eu.papel)) redirect(portalDoPapel(s.eu.papel));
  return s;
}

/**
 * O mesmo, para os papéis que **têm** sociedade — e a devolver `organizacaoId`
 * já como `string`.
 *
 * Desde a `0016` a coluna é anulável, e sem esta função o `null` do
 * `super_admin` viajava pelo código todo: cada consulta que compara a
 * organização do processo com a de quem lê passava a precisar de um `!` ou de
 * um `?? ""`, e um deles mais cedo ou mais tarde fica errado. Aqui a restrição
 * da base de dados (`utilizador_org_por_papel`) é traduzida uma única vez para
 * o sistema de tipos, no sítio onde o papel acabou de ser verificado.
 *
 * O `redirect` desse ramo é defensivo: com a restrição em vigor não há linha
 * que o alcance. Se alguma existir — uma base anterior à migração, um `UPDATE`
 * infeliz — o que ela precisa é de parar à entrada, e não de descobrir a meio
 * de uma consulta que não tem organização nenhuma para comparar.
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

/**
 * Só quem administra a sociedade.
 *
 * Era o `exigirAdmin` de antes, com o mesmo papel a fazer o mesmo trabalho — o
 * `admin` da sociedade passou a chamar-se `society_admin` e o nome do guard
 * acompanhou. Sem alias para o nome antigo: um `exigirAdmin` a viver ao lado
 * de um `exigirSuperAdmin` é uma armadilha de leitura por 25 caracteres
 * poupados.
 */
export async function exigirSocietyAdmin() {
  return exigirPapelComSociedade(["society_admin"]);
}

/**
 * A área de trabalho partilhada: processos e clientes.
 *
 * O `society_admin` e o `utilizador` entram os dois — é o mesmo trabalho, e a
 * separação entre eles é de administração (emails, configuração, contas) e não
 * de processos. O `super_admin` não entra: os processos são de uma sociedade.
 */
export async function exigirEquipaDaSociedade() {
  return exigirPapelComSociedade(["society_admin", "utilizador"]);
}

/**
 * Quem pode criar contas — o dono da plataforma ou o administrador da
 * sociedade.
 *
 * Sem `ComSociedade`: é o único guard onde os dois lados da fronteira se
 * encontram, e o `super_admin` que passa por aqui não tem organização por
 * definição. Quem o chamar tem de decidir **em que sociedade** está a criar a
 * conta — e é isso que `sociedadeAlvo()`, em `features/plataforma/acoes.ts`,
 * resolve: para o `society_admin` é sempre a dele (o parâmetro é ignorado), e
 * para o `super_admin` é a que vier indicada.
 */
export async function exigirGestorDeUtilizadores() {
  return exigirPapel(["super_admin", "society_admin"]);
}

/**
 * Alias de compatibilidade para o código pré-RBAC.
 *
 * O `admin` da sociedade passou a `society_admin`; quem administra a sociedade
 * é exactamente quem tem esse papel. `podeAdministrar` continua a existir para
 * que os ecrãs de administração escritos antes do RBAC 3 níveis continuem a
 * funcionar sem reescrita — a resposta é a mesma, só o nome do papel mudou.
 */
export function podeAdministrar(papel: string) {
  return papel === "society_admin";
}

/**
 * Alias de compatibilidade para o código pré-RBAC.
 *
 * Equivalente a `exigirSocietyAdmin`. Mantido para as páginas e Server Actions
 * de administração que foram escritas contra o antigo nome do papel.
 */
export async function exigirAdministracao() {
  return exigirSocietyAdmin();
}
