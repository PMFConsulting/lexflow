"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { uuidv7 } from "uuidv7";
import { db } from "@/db";
import { account, user } from "@/db/schema/auth";
import { organizacao, utilizador } from "@/db/schema/organizacao";
import { registarEvento } from "@/features/auditoria/registar";
import { ORGANIZACAO_PLATAFORMA_ID } from "@/features/auditoria/constantes";
import {
  exigirGestorDeUtilizadores,
  exigirSuperAdmin,
  type Papel,
} from "@/lib/sessao";
import {
  criarConta,
  enviarCredenciais,
  enviarCredenciaisPendentes,
  gerarPalavraPasse,
  ErroDeConta,
  type ContaCriada,
  type CredencialPorEnviar,
} from "./contas";
import { prepararImportacao, type LinhaRecusada } from "./importacao";
import {
  contaDePlataformaSchema,
  contaSchema,
  erros,
  sociedadeComAdminSchema,
  sociedadeSchema,
} from "./schemas";

/**
 * As ações do portal da plataforma.
 *
 * Duas regras atravessam este ficheiro:
 *
 * 1. **A autorização é o primeiro passo de cada ação**, e não uma verificação
 *    do layout. Um Server Action é um endereço alcançável a partir do browser:
 *    o guard da página não o protege, e o dia em que alguém descobrir o
 *    identificador de uma destas funções tem de bater no mesmo `redirect`.
 *
 * 2. **A sociedade-alvo nunca vem só do pedido.** Para um `society_admin` é
 *    sempre a dele, e o que vier no formulário é ignorado — sem isso, mudar um
 *    campo escondido criava contas na sociedade de outra pessoa. É o que
 *    `sociedadeAlvo()` resolve, e é a única forma de este par de papéis
 *    partilhar as mesmas ações em segurança.
 */

/* --------------------------------------------------------------- contexto */

async function ambiente() {
  const cabecalhos = await headers();
  return {
    ip: cabecalhos.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: cabecalhos.get("user-agent"),
  };
}

/**
 * A sociedade em que esta ação vai escrever.
 *
 * O `super_admin` indica-a (é o que lhe permite criar contas em qualquer uma);
 * o `society_admin` **não a indica** — é sempre a dele, venha o que vier no
 * pedido. Não é paranoia: o formulário do `society_admin` nem sequer tem esse
 * campo, e é exatamente por isso que o valor tem de ser ignorado do lado do
 * servidor em vez de confiado.
 */
function sociedadeAlvo(eu: { papel: string; organizacaoId: string | null }, pedida?: string | null) {
  return eu.papel === "super_admin" ? (pedida ?? null) : eu.organizacaoId;
}

/**
 * Regista sem nunca interromper a ação.
 *
 * Mesma regra da D46: a partir do momento em que a escrita passou, nada do que
 * vem a seguir a pode desfazer nem esconder. Uma sociedade criada e um erro no
 * ecrã porque a auditoria falhou é a pior das duas respostas possíveis — a
 * sociedade fica lá, e quem a criou pensa que não.
 */
async function auditar(entrada: Parameters<typeof registarEvento>[0]) {
  try {
    await registarEvento(entrada);
  } catch (e) {
    console.error(`[plataforma] falha a registar ${entrada.acao}:`, e);
  }
}

/* ------------------------------------------------------------ sociedades */

export type ResultadoSociedade =
  | { ok: true; id: string; admin: ContaCriada | null; avisoAdmin: string | null }
  | { ok: false; erros: Record<string, string> };

/**
 * Cria uma sociedade e, se vierem os dados, o primeiro administrador dela.
 *
 * **A conta é opcional de propósito.** Quem abre uma sociedade nem sempre sabe
 * ainda quem a vai operar, e obrigar a inventar um endereço para poder avançar
 * produzia contas a apagar. O preço está pago no painel: uma sociedade sem
 * administrador nenhum aparece contada em "sem administrador", que é a única
 * forma de o adiamento não se tornar esquecimento.
 *
 * Se a conta falhar, **a sociedade fica criada na mesma** e o ecrã diz as duas
 * coisas. A alternativa — desfazer tudo — obrigava a repetir os três campos da
 * sociedade por causa de um email repetido, que é o erro mais provável dos dois.
 */
export async function criarSociedade(dados: unknown): Promise<ResultadoSociedade> {
  const { eu } = await exigirSuperAdmin();

  const lido = sociedadeComAdminSchema.safeParse(dados);
  if (!lido.success) return { ok: false, erros: erros(lido) };

  const v = lido.data;

  /* --- a sociedade ------------------------------------------------------- */

  const colisao = await colisaoDeSociedade(v.nif, v.prefixoReferencia, null);
  if (colisao) return { ok: false, erros: colisao };

  const id = uuidv7();

  try {
    await db().insert(organizacao).values({
      id,
      nome: v.nome,
      nif: v.nif,
      prefixoReferencia: v.prefixoReferencia,
    });
  } catch (e) {
    console.error("[plataforma] falhou a criar a sociedade:", e);
    return {
      ok: false,
      erros: { _: "Não foi possível criar a sociedade. Tente de novo." },
    };
  }

  const { ip, userAgent } = await ambiente();

  await auditar({
    organizacaoId: id,
    atorId: eu.id,
    acao: "sociedade.criada",
    entidade: "organizacao",
    entidadeId: id,
    valorNovo: { nome: v.nome, nif: v.nif, prefixoReferencia: v.prefixoReferencia },
    ip,
    userAgent,
  });

  /* --- o primeiro administrador, se veio --------------------------------- */

  let admin: ContaCriada | null = null;
  let avisoAdmin: string | null = null;

  if (v.adminNome && v.adminEmail) {
    try {
      admin = await criarConta({
        nome: v.adminNome,
        email: v.adminEmail,
        papel: "society_admin",
        organizacaoId: id,
      });

      await auditar({
        organizacaoId: id,
        atorId: eu.id,
        acao: "utilizador.criado",
        entidade: "utilizador",
        entidadeId: admin.utilizadorId,
        // Sem a palavra-passe, obviamente: a auditoria dura sete anos.
        valorNovo: {
          email: admin.email,
          papel: admin.papel,
          primeiroAdmin: true,
          credenciaisEnviadas: admin.emailEnviado,
        },
        ip,
        userAgent,
      });
    } catch (e) {
      avisoAdmin =
        e instanceof ErroDeConta
          ? e.motivo
          : "Não foi possível criar a conta do administrador.";
      console.error("[plataforma] sociedade criada, administrador não:", e);
    }
  }

  revalidatePath("/admin");
  return { ok: true, id, admin, avisoAdmin };
}

export async function atualizarSociedade(
  id: string,
  dados: unknown,
): Promise<{ ok: true } | { ok: false; erros: Record<string, string> }> {
  const { eu } = await exigirSuperAdmin();

  const lido = sociedadeSchema.safeParse(dados);
  if (!lido.success) return { ok: false, erros: erros(lido) };

  const v = lido.data;

  const [antes] = await db()
    .select()
    .from(organizacao)
    .where(and(eq(organizacao.id, id), isNull(organizacao.apagadoEm)))
    .limit(1);

  if (!antes) return { ok: false, erros: { _: "Esta sociedade já não existe." } };

  const colisao = await colisaoDeSociedade(v.nif, v.prefixoReferencia, id);
  if (colisao) return { ok: false, erros: colisao };

  /**
   * O prefixo muda, as referências já emitidas **não**.
   *
   * `PMF-2026-0142` está em emails enviados, em PDFs arquivados e no assunto de
   * avisos internos; reescrevê-lo na base de dados partia a correspondência
   * entre o que a sociedade tem em papel e o que a plataforma diz. O prefixo
   * novo vale para os processos seguintes — e é isso que o ecrã avisa antes de
   * gravar.
   */
  try {
    await db()
      .update(organizacao)
      .set({
        nome: v.nome,
        nif: v.nif,
        prefixoReferencia: v.prefixoReferencia,
        atualizadoEm: new Date(),
      })
      .where(eq(organizacao.id, id));
  } catch (e) {
    console.error("[plataforma] falhou a atualizar a sociedade:", e);
    return { ok: false, erros: { _: "Não foi possível gravar. Tente de novo." } };
  }

  const { ip, userAgent } = await ambiente();

  await auditar({
    organizacaoId: id,
    atorId: eu.id,
    acao: "sociedade.atualizada",
    entidade: "organizacao",
    entidadeId: id,
    valorAnterior: {
      nome: antes.nome,
      nif: antes.nif,
      prefixoReferencia: antes.prefixoReferencia,
    },
    valorNovo: { nome: v.nome, nif: v.nif, prefixoReferencia: v.prefixoReferencia },
    ip,
    userAgent,
  });

  revalidatePath("/admin");
  revalidatePath(`/admin/sociedades/${id}`);
  return { ok: true };
}

/**
 * O NIPC e o prefixo já estão noutra sociedade?
 *
 * Os índices únicos da `0016` garantem o resultado; isto existe para dar a
 * **mensagem**, debaixo do campo certo. Um `duplicate key value violates unique
 * constraint "organizacao_prefixo"` no ecrã não diz a ninguém que basta trocar
 * três letras.
 */
async function colisaoDeSociedade(
  nif: string,
  prefixo: string,
  excepto: string | null,
): Promise<Record<string, string> | null> {
  const linhas = await db()
    .select({ id: organizacao.id, nif: organizacao.nif, prefixo: organizacao.prefixoReferencia })
    .from(organizacao)
    .where(isNull(organizacao.apagadoEm));

  const outras = linhas.filter((l) => l.id !== excepto);

  if (outras.some((l) => l.nif === nif)) {
    return { nif: "Já existe uma sociedade com este NIPC." };
  }
  if (outras.some((l) => l.prefixo === prefixo)) {
    return { prefixoReferencia: `O prefixo "${prefixo}" já está a ser usado por outra sociedade.` };
  }
  return null;
}

/* --------------------------------------------------------------- contas */

export type ResultadoConta =
  | { ok: true; conta: ContaCriada }
  | { ok: false; erros: Record<string, string> };

/**
 * Cria uma conta numa sociedade — manualmente, uma de cada vez.
 *
 * Chamável pelo `super_admin` (para qualquer sociedade) e pelo `society_admin`
 * (só para a dele). O papel `super_admin` não passa pelo schema, e é a
 * fronteira mais importante deste ficheiro: sem ela, quem administra uma
 * sociedade criava-se a si próprio um acesso a todas as outras.
 */
export async function criarUtilizador(dados: unknown): Promise<ResultadoConta> {
  const { eu } = await exigirGestorDeUtilizadores();

  const lido = contaSchema.safeParse(dados);
  if (!lido.success) return { ok: false, erros: erros(lido) };

  const alvo = sociedadeAlvo(eu, lido.data.organizacaoId);
  if (!alvo) {
    return { ok: false, erros: { organizacaoId: "Escolha a sociedade a que esta conta pertence." } };
  }

  const [sociedade] = await db()
    .select({ id: organizacao.id })
    .from(organizacao)
    .where(and(eq(organizacao.id, alvo), isNull(organizacao.apagadoEm)))
    .limit(1);

  if (!sociedade) {
    return { ok: false, erros: { organizacaoId: "Esta sociedade já não existe." } };
  }

  const aprovadoEm = eu.papel === "super_admin" ? new Date() : null;
  // Diogo's rule: O super_admin NÃO escolhe gestores nem dependentes. Apenas society_admin.
  const gestorIdEfetivo =
    eu.papel === "society_admin" && lido.data.papel === "utilizador"
      ? lido.data.gestorId
      : null;

  try {
    const conta = await criarConta({
      nome: lido.data.nome,
      email: lido.data.email,
      papel: lido.data.papel,
      organizacaoId: alvo,
      gestorId: gestorIdEfetivo,
      aprovadoEm,
    });

    const { ip, userAgent } = await ambiente();

    await auditar({
      organizacaoId: alvo,
      atorId: eu.id,
      acao: "utilizador.criado",
      entidade: "utilizador",
      entidadeId: conta.utilizadorId,
      valorNovo: {
        email: conta.email,
        papel: conta.papel,
        gestorId: gestorIdEfetivo ?? null,
        pendenteAprovacao: aprovadoEm === null,
        credenciaisEnviadas: conta.emailEnviado,
      },
      ip,
      userAgent,
    });

    revalidatePath("/admin");
    revalidatePath("/admin/aprovacoes");
    revalidatePath(`/admin/sociedades/${alvo}`);
    revalidatePath("/admin/utilizadores");
    revalidatePath("/utilizadores");

    return { ok: true, conta };
  } catch (e) {
    if (e instanceof ErroDeConta) return { ok: false, erros: { email: e.motivo } };
    console.error("[plataforma] falhou a criar a conta:", e);
    return { ok: false, erros: { _: "Não foi possível criar a conta. Tente de novo." } };
  }
}

/**
 * Associa ou move o gestor atribuído a um utilizador da sociedade.
 * Operação administrativa imediata (sem aprovação da plataforma),
 * reservada exclusivamente ao administrador da sociedade (`society_admin`).
 * O super_admin NÃO pode associar gestores nem dependentes.
 */
export async function associarGestor(
  utilizadorId: string,
  gestorId: string | null,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const { eu } = await exigirGestorDeUtilizadores();

  if (eu.papel !== "society_admin" || !eu.organizacaoId) {
    return { ok: false, erro: "Apenas o administrador da sociedade pode associar ou alterar gestores." };
  }

  const [alvo] = await db()
    .select()
    .from(utilizador)
    .where(and(eq(utilizador.id, utilizadorId), isNull(utilizador.apagadoEm)))
    .limit(1);

  if (!alvo || alvo.organizacaoId !== eu.organizacaoId) {
    return { ok: false, erro: "Utilizador não encontrado nesta sociedade." };
  }

  if (alvo.papel !== "utilizador") {
    return { ok: false, erro: "Apenas contas com papel 'utilizador' podem ter gestor associado." };
  }

  const gestorIdLimpo = gestorId && gestorId.trim() ? gestorId.trim() : null;

  if (gestorIdLimpo) {
    const [gestor] = await db()
      .select()
      .from(utilizador)
      .where(and(eq(utilizador.id, gestorIdLimpo), isNull(utilizador.apagadoEm)))
      .limit(1);

    if (
      !gestor ||
      gestor.organizacaoId !== eu.organizacaoId ||
      gestor.papel !== "gestor" ||
      !gestor.ativo
    ) {
      return { ok: false, erro: "O gestor selecionado não é válido ou não pertence à sociedade." };
    }
  }

  await db()
    .update(utilizador)
    .set({ gestorId: gestorIdLimpo, atualizadoEm: new Date() })
    .where(eq(utilizador.id, utilizadorId));

  const { ip, userAgent } = await ambiente();

  await auditar({
    organizacaoId: eu.organizacaoId,
    atorId: eu.id,
    acao: "utilizador.gestor_atualizado",
    entidade: "utilizador",
    entidadeId: alvo.id,
    valorAnterior: { gestorId: alvo.gestorId },
    valorNovo: { gestorId: gestorIdLimpo },
    ip,
    userAgent,
  });

  revalidatePath("/utilizadores");
  revalidatePath("/equipa");
  revalidatePath("/processos");

  return { ok: true };
}

/**
 * Cria outra conta de plataforma. Só o `super_admin`, e sem sociedade.
 *
 * Existe porque a primeira conta nasce no servidor
 * (`scripts/criar_utilizador.mjs`) e a segunda não deve obrigar a voltar lá —
 * uma plataforma com um único dono é uma plataforma que fica inacessível no dia
 * em que essa pessoa perde a palavra-passe.
 */
export async function criarAdministradorDePlataforma(dados: unknown): Promise<ResultadoConta> {
  const { eu } = await exigirSuperAdmin();

  const lido = contaDePlataformaSchema.safeParse(dados);
  if (!lido.success) return { ok: false, erros: erros(lido) };

  try {
    const conta = await criarConta({
      nome: lido.data.nome,
      email: lido.data.email,
      papel: "super_admin",
      organizacaoId: null,
    });

    const { ip, userAgent } = await ambiente();

    await auditar({
      organizacaoId: ORGANIZACAO_PLATAFORMA_ID,
      atorId: eu.id,
      acao: "utilizador.criado",
      entidade: "utilizador",
      entidadeId: conta.utilizadorId,
      valorNovo: {
        email: conta.email,
        papel: "super_admin",
        credenciaisEnviadas: conta.emailEnviado,
      },
      ip,
      userAgent,
    });

    revalidatePath("/admin/utilizadores");
    return { ok: true, conta };
  } catch (e) {
    if (e instanceof ErroDeConta) return { ok: false, erros: { email: e.motivo } };
    console.error("[plataforma] falhou a criar o administrador da plataforma:", e);
    return { ok: false, erros: { _: "Não foi possível criar a conta. Tente de novo." } };
  }
}

/* ------------------------------------------------------------ importação */

export type ResultadoImportacao =
  | {
      ok: true;
      criadas: ContaCriada[];
      recusadas: LinhaRecusada[];
    }
  | { ok: false; erro: string };

/**
 * Importação em lote, a partir de um `.csv` ou `.xlsx`.
 *
 * **Tudo ou nada, para as linhas válidas.** As contas criam-se dentro de uma
 * única transação: um ficheiro de trinta pessoas que rebente na vigésima não
 * pode deixar dezanove contas criadas e onze por criar, porque não há nada no
 * ecrã que diga quais foram quais — e a segunda tentativa passa a bater em
 * "já existe" nas dezanove.
 *
 * As linhas **recusadas** não impedem as outras de entrar. São coisas
 * diferentes: uma linha má é um erro de quem preencheu a folha, e devolvê-la
 * para correção enquanto as boas seguem é o que evita a folha ir e voltar três
 * vezes.
 */
export async function importarUtilizadores(
  organizacaoIdPedida: string | null,
  ficheiro: File,
): Promise<ResultadoImportacao> {
  const { eu } = await exigirGestorDeUtilizadores();

  const alvo = sociedadeAlvo(eu, organizacaoIdPedida);
  if (!alvo) return { ok: false, erro: "Escolha a sociedade onde importar as contas." };

  const [sociedade] = await db()
    .select({ id: organizacao.id })
    .from(organizacao)
    .where(and(eq(organizacao.id, alvo), isNull(organizacao.apagadoEm)))
    .limit(1);

  if (!sociedade) return { ok: false, erro: "Esta sociedade já não existe." };

  // 2 MB: uma folha de contas com mil linhas não chega a 100 kB. O limite não é
  // sobre o formato, é sobre o que um Server Action deve aceitar receber.
  if (ficheiro.size > 2 * 1024 * 1024) {
    return { ok: false, erro: "O ficheiro é demasiado grande (máximo 2 MB)." };
  }

  const bytes = Buffer.from(await ficheiro.arrayBuffer());

  const todos = await db()
    .select({ email: utilizador.email, organizacaoId: utilizador.organizacaoId })
    .from(utilizador)
    .where(isNull(utilizador.apagadoEm));

  const existentes = todos.filter((l) => l.organizacaoId === alvo).map((l) => l.email);
  const noutras = todos.filter((l) => l.organizacaoId !== alvo).map((l) => l.email);

  const leitura = prepararImportacao(
    bytes,
    existentes,
    noutras,
  );

  if (!leitura.ok) return { ok: false, erro: leitura.erro };

  const { validas, recusadas } = leitura.previsao;
  if (validas.length === 0) return { ok: true, criadas: [], recusadas };

  const aprovadoEm = eu.papel === "super_admin" ? new Date() : null;

  let criadas: ContaCriada[];

  /**
   * Os envios ficam à espera de a transação fechar (caso estejam aprovadas).
   */
  const pendentes: CredencialPorEnviar[] = [];

  try {
    criadas = await db().transaction(async (tx) => {
      const feitas: ContaCriada[] = [];
      for (const linha of validas) {
        feitas.push(
          await criarConta(
            {
              nome: linha.nome,
              email: linha.email,
              papel: linha.papel as Papel,
              organizacaoId: alvo,
              aprovadoEm,
            },
            tx,
            pendentes,
          ),
        );
      }
      return feitas;
    });
  } catch (e) {
    console.error("[plataforma] a importação falhou e foi desfeita:", e);
    return {
      ok: false,
      erro:
        e instanceof ErroDeConta
          ? `${e.motivo} Nenhuma conta foi criada — corrija o ficheiro e importe de novo.`
          : "Não foi possível criar as contas. Nenhuma foi criada — tente de novo.",
    };
  }

  // Se aprovadas, as credenciais saem agora que a transação fechou
  if (aprovadoEm !== null) {
    await enviarCredenciaisPendentes(pendentes);
  }

  const { ip, userAgent } = await ambiente();

  await auditar({
    organizacaoId: alvo,
    atorId: eu.id,
    acao: "utilizador.importado",
    entidade: "utilizador",
    valorNovo: {
      ficheiro: ficheiro.name,
      criadas: criadas.length,
      recusadas: recusadas.length,
      emails: criadas.map((c) => c.email),
      pendentesAprovacao: aprovadoEm === null,
      credenciaisNaoEnviadas:
        aprovadoEm !== null ? criadas.filter((c) => c.emailEnviado === false).length : 0,
    },
    ip,
    userAgent,
  });

  revalidatePath("/admin");
  revalidatePath("/admin/aprovacoes");
  revalidatePath(`/admin/sociedades/${alvo}`);
  revalidatePath("/admin/utilizadores");
  revalidatePath("/utilizadores");

  return { ok: true, criadas, recusadas };
}

/* -------------------------------------------------------- estado da conta */

/**
 * Liga e desliga uma conta.
 *
 * `ativo = false` e não um apagamento: `sessaoAtual()` já recusa a sessão de
 * quem esteja inativo, e a linha continua a existir para o que ela sustenta —
 * `processo.responsavel_id` aponta para aqui, e `evento_auditoria.ator_id`
 * também. Apagar quem decidiu sobre um processo era apagar a resposta à
 * pergunta "quem aprovou isto", que a lei obriga a manter durante sete anos.
 */
export async function alterarEstadoDaConta(
  utilizadorId: string,
  ativo: boolean,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const { eu } = await exigirGestorDeUtilizadores();

  const [alvo] = await db()
    .select()
    .from(utilizador)
    .where(and(eq(utilizador.id, utilizadorId), isNull(utilizador.apagadoEm)))
    .limit(1);

  if (!alvo) return { ok: false, erro: "Esta conta já não existe." };

  // O `society_admin` só mexe na sua sociedade. Sem esta linha, o identificador
  // de uma conta de outra sociedade era suficiente para a desligar.
  if (eu.papel !== "super_admin" && alvo.organizacaoId !== eu.organizacaoId) {
    return { ok: false, erro: "Esta conta não é da sua sociedade." };
  }

  // Ninguém se desliga a si próprio: era sair da plataforma e ficar sem forma de
  // voltar a entrar para o desfazer.
  if (alvo.id === eu.id) {
    return { ok: false, erro: "Não pode desativar a sua própria conta." };
  }

  await db()
    .update(utilizador)
    .set({ ativo, atualizadoEm: new Date() })
    .where(eq(utilizador.id, utilizadorId));

  const { ip, userAgent } = await ambiente();

  await auditar({
    organizacaoId: alvo.organizacaoId ?? ORGANIZACAO_PLATAFORMA_ID,
    atorId: eu.id,
    acao: ativo ? "utilizador.reativado" : "utilizador.desativado",
    entidade: "utilizador",
    entidadeId: alvo.id,
    valorAnterior: { ativo: alvo.ativo },
    valorNovo: { ativo },
    ip,
    userAgent,
  });

  revalidatePath("/admin");
  if (alvo.organizacaoId) revalidatePath(`/admin/sociedades/${alvo.organizacaoId}`);
  revalidatePath("/admin/utilizadores");
  revalidatePath("/utilizadores");

  return { ok: true };
}

/* ------------------------------------------------ aprovação de utilizadores */

export type ResultadoAprovacao =
  | {
      ok: true;
      /** `true` quando a conta já estava aprovada e nada foi feito nesta chamada. */
      jaAprovado?: boolean;
      emailEnviado?: boolean | null;
      erroEmail?: string | null;
    }
  | { ok: false; erro: string };

/**
 * Aprova um utilizador pendente proposto por uma sociedade.
 *
 * Apenas o `super_admin` da plataforma pode aprovar.
 * Gera uma nova palavra-passe temporária, preenche `aprovado_em = now()`,
 * marca `deve_redefinir_password = true`, e envia as credenciais de acesso por email.
 *
 * A palavra-passe **é gerada aqui e não na criação**: a conta pendente nasceu
 * com uma que ninguém recebeu (é o que a D-aprovação exige — uma conta que pode
 * ser rejeitada não deve ter recebido credenciais), e o email só faz sentido no
 * momento em que a pessoa passa a poder entrar. Mesma regra da `criarConta`:
 * quem administra não a escolhe, não a lê e não a entrega.
 */
export async function aprovarUtilizador(utilizadorId: string): Promise<ResultadoAprovacao> {
  const { eu } = await exigirSuperAdmin();

  const [alvo] = await db()
    .select()
    .from(utilizador)
    .where(and(eq(utilizador.id, utilizadorId), isNull(utilizador.apagadoEm)))
    .limit(1);

  if (!alvo) return { ok: false, erro: "Este utilizador já não existe." };

  /**
   * Já aprovada: não se volta a aprovar, e sobretudo **não se diz que as
   * credenciais saíram**. Dois cliques no mesmo botão, ou dois separadores
   * abertos sobre a mesma lista, davam um ecrã a garantir um email que ninguém
   * mandou — e a segunda passagem geraria uma palavra-passe nova, invalidando
   * a que a pessoa já tinha recebido e possivelmente já trocado.
   */
  if (alvo.aprovadoEm) return { ok: true, jaAprovado: true, emailEnviado: null };

  /**
   * Sem conta do Better Auth não há onde guardar a palavra-passe.
   *
   * Mandar o email na mesma era entregar credenciais que não abrem nada — o
   * defeito mais confuso deste sistema (a conta que passa o login e não resolve
   * a sessão) com um email por cima a dizer que está tudo bem. A lista de
   * utilizadores já assinala estas linhas como "não ligada"; aqui a aprovação
   * pára e diz o mesmo.
   */
  if (!alvo.authUserId) {
    return {
      ok: false,
      erro: "Esta conta não está ligada ao início de sessão e não pode ser aprovada. Recrie-a a partir da sociedade.",
    };
  }

  const authUserId = alvo.authUserId;

  /**
   * `auth_user_id` preenchido não garante que a conta do outro lado exista.
   *
   * A coluna é `text().unique()` e **não tem chave estrangeira** para `user.id`
   * (`schema/organizacao.ts`), enquanto `account.userId` apaga em cascata com o
   * `user`. Apagada a linha do Better Auth, as credenciais vão atrás dela e aqui
   * fica um identificador pendurado que passa a verificação de cima como se
   * estivesse tudo bem.
   *
   * Sem esta consulta o que acontecia a seguir era: a procura da credencial não
   * encontrava nada, o `INSERT` de recuperação batia na chave estrangeira de
   * `account.userId`, e o `catch` da transação respondia «Tente de novo» — um
   * convite a repetir uma operação que não pode funcionar nenhuma das vezes,
   * sobre uma conta que ninguém percebe porque não aprova. É o mesmo silêncio da
   * D46 noutra roupa: a falha é real, e a mensagem manda procurar no sítio
   * errado.
   */
  const [linhaAuth] = await db()
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, authUserId))
    .limit(1);

  if (!linhaAuth) {
    console.error(
      `[plataforma] utilizador ${alvo.id} aponta para auth_user_id ${authUserId}, que não existe`,
    );
    return {
      ok: false,
      erro: "Esta conta perdeu a ligação ao início de sessão e não pode ser aprovada. Recrie-a a partir da sociedade.",
    };
  }

  const palavraPasse = gerarPalavraPasse();
  const hash = await hashPassword(palavraPasse);
  const agora = new Date();

  /**
   * A credencial em falta **recupera-se**, e a recuperação fica escrita.
   *
   * Recusar aqui seria trancar para sempre uma conta que se resolve escrevendo
   * a linha que falta — e a linha só falta em contas que nunca chegaram a ter
   * palavra-passe, que é exactamente o que esta aprovação existe para dar.
   * O que não pode é acontecer sem deixar rasto: a auditoria leva
   * `credencialCriada`, para a diferença entre «trocou-se a palavra-passe» e
   * «não havia nenhuma para trocar» sobreviver a esta chamada.
   */
  let credencialCriada = false;

  /**
   * As duas escritas são uma transação, pela mesma razão da D63: entre elas não
   * há estado aceitável. A palavra-passe trocada numa conta que continua
   * pendente é uma pessoa que não entra e cujas credenciais no email já não
   * servem; a conta aprovada sem a palavra-passe nova é o email a anunciar uma
   * que a base de dados não conhece.
   */
  try {
    await db().transaction(async (tx) => {
      const [credencial] = await tx
        .select({ id: account.id })
        .from(account)
        .where(and(eq(account.userId, authUserId), eq(account.providerId, "credential")))
        .limit(1);

      if (credencial) {
        await tx
          .update(account)
          .set({ password: hash, updatedAt: agora })
          .where(eq(account.id, credencial.id));
      } else {
        // A linha `account` é onde o Better Auth procura a palavra-passe (D23).
        // Falta ela, o login passa a não ter com que comparar — e a conta ficava
        // aprovada com credenciais que não abrem nada.
        credencialCriada = true;
        await tx.insert(account).values({
          id: randomBytes(16).toString("hex"),
          accountId: authUserId,
          providerId: "credential",
          userId: authUserId,
          password: hash,
          createdAt: agora,
          updatedAt: agora,
        });
      }

      await tx
        .update(utilizador)
        .set({
          aprovadoEm: agora,
          deveRedefinirPassword: true,
          atualizadoEm: agora,
        })
        .where(eq(utilizador.id, utilizadorId));
    });
  } catch (e) {
    console.error("[plataforma] falhou a aprovar a conta:", e);
    return { ok: false, erro: "Não foi possível aprovar a conta. Tente de novo." };
  }

  const contaParaEnvio: ContaCriada = {
    utilizadorId: alvo.id,
    email: alvo.email,
    nome: alvo.nome,
    papel: alvo.papel,
    aprovadoEm: agora,
    gestorId: alvo.gestorId,
    emailEnviado: null,
    erroEmail: null,
  };

  await enviarCredenciais({
    nome: alvo.nome,
    email: alvo.email,
    palavraPasse,
    organizacaoId: alvo.organizacaoId,
    conta: contaParaEnvio,
  });

  const { ip, userAgent } = await ambiente();

  if (alvo.organizacaoId) {
    await auditar({
      organizacaoId: alvo.organizacaoId,
      atorId: eu.id,
      acao: "utilizador.aprovado",
      entidade: "utilizador",
      entidadeId: alvo.id,
      valorNovo: {
        email: alvo.email,
        papel: alvo.papel,
        aprovadoEm: agora,
        credenciaisEnviadas: contaParaEnvio.emailEnviado,
        credencialCriada,
      },
      ip,
      userAgent,
    });
  }

  revalidatePath("/admin");
  revalidatePath("/admin/aprovacoes");
  revalidatePath("/admin/utilizadores");
  if (alvo.organizacaoId) {
    revalidatePath(`/admin/sociedades/${alvo.organizacaoId}`);
    revalidatePath("/utilizadores");
  }

  return {
    ok: true,
    emailEnviado: contaParaEnvio.emailEnviado,
    erroEmail: contaParaEnvio.erroEmail,
  };
}

/**
 * Rejeita um utilizador **pendente** proposto por uma sociedade.
 *
 * Apenas o `super_admin` da plataforma.
 * Soft-delete da conta (`apagado_em = now()`, `ativo = false`) com auditoria.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Porque é que a recusa só vale sobre pendentes
 *
 * O ecrã só oferece o botão nas contas que aguardam aprovação, mas um Server
 * Action é um endereço alcançável a partir do browser e o guard da página não o
 * protege — a mesma regra que abre este ficheiro. Sem esta verificação, o
 * identificador de **qualquer** conta da plataforma, incluindo a de um
 * administrador de uma sociedade a trabalhar há meses, era suficiente para a
 * apagar por um caminho chamado "rejeitar", que na auditoria fica a dizer que
 * uma proposta foi recusada. Desligar uma conta em uso tem outro caminho e
 * outro nome (`alterarEstadoDaConta`), e é reversível.
 */
export async function rejeitarUtilizador(
  utilizadorId: string,
  motivo?: string,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const { eu } = await exigirSuperAdmin();

  const [alvo] = await db()
    .select()
    .from(utilizador)
    .where(and(eq(utilizador.id, utilizadorId), isNull(utilizador.apagadoEm)))
    .limit(1);

  if (!alvo) return { ok: false, erro: "Este utilizador já não existe." };

  if (alvo.aprovadoEm) {
    return {
      ok: false,
      erro: "Esta conta já foi aprovada e não pode ser rejeitada. Para lhe retirar o acesso, desative-a na sociedade.",
    };
  }

  const agora = new Date();
  await db()
    .update(utilizador)
    .set({
      apagadoEm: agora,
      ativo: false,
      atualizadoEm: agora,
    })
    .where(eq(utilizador.id, utilizadorId));

  const { ip, userAgent } = await ambiente();

  if (alvo.organizacaoId) {
    await auditar({
      organizacaoId: alvo.organizacaoId,
      atorId: eu.id,
      acao: "utilizador.rejeitado",
      entidade: "utilizador",
      entidadeId: alvo.id,
      valorNovo: {
        email: alvo.email,
        papel: alvo.papel,
        motivo: motivo?.trim() || null,
      },
      ip,
      userAgent,
    });
  }

  revalidatePath("/admin");
  revalidatePath("/admin/aprovacoes");
  revalidatePath("/admin/utilizadores");
  if (alvo.organizacaoId) {
    revalidatePath(`/admin/sociedades/${alvo.organizacaoId}`);
    revalidatePath("/utilizadores");
  }

  return { ok: true };
}
