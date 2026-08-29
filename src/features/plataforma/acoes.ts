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
import {
  notificarDonoNovoUtilizador,
  notificarDonoSociedadeCriada,
} from "@/lib/emails/notificacoes-dono";

/**
 * Ações do portal da plataforma. Duas regras atravessam o ficheiro:
 * autorização é o primeiro passo de cada ação (o guard da página não protege
 * a Server Action em si); e a sociedade-alvo nunca vem só do pedido — para
 * `society_admin` é sempre a dele, resolvido em `sociedadeAlvo()`.
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
 * Sociedade em que a ação escreve. O `super_admin` indica-a; o
 * `society_admin` nunca — é sempre a dele, ignorando o que vier no pedido.
 */
function sociedadeAlvo(eu: { papel: string; organizacaoId: string | null }, pedida?: string | null) {
  return eu.papel === "super_admin" ? (pedida ?? null) : eu.organizacaoId;
}

/** Regista sem nunca interromper a ação (D46) — falha de auditoria não pode parecer falha da escrita. */
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
 * Cria uma sociedade e, se vierem os dados, o primeiro administrador.
 *
 * A conta é opcional de propósito — obrigar a inventar um endereço produzia
 * contas de mentira; o painel mostra "sem administrador" para o adiamento não
 * virar esquecimento. Se a conta falhar, a sociedade fica criada na mesma e o
 * ecrã diz as duas coisas.
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

  await notificarDonoSociedadeCriada({
    sociedadeId: id,
    nome: v.nome,
    nif: v.nif,
    prefixo: v.prefixoReferencia,
    adminNome: v.adminNome ?? null,
    adminEmail: v.adminEmail ?? null,
    erroAdmin: avisoAdmin,
  });

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

  // O prefixo muda, as referências já emitidas não — estão em emails e PDFs
  // arquivados. O prefixo novo vale só para os processos seguintes.
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
 * NIPC ou prefixo já usados noutra sociedade? Os índices únicos da 0016 já
 * garantem isto — isto existe só para dar a mensagem debaixo do campo certo.
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
 * Cria uma conta numa sociedade, uma de cada vez. Chamável por `super_admin`
 * (qualquer sociedade) e `society_admin` (só a dele) — o papel `super_admin`
 * não passa pelo schema, fronteira mais importante do ficheiro.
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
    .select({ id: organizacao.id, nome: organizacao.nome })
    .from(organizacao)
    .where(and(eq(organizacao.id, alvo), isNull(organizacao.apagadoEm)))
    .limit(1);

  if (!sociedade) {
    return { ok: false, erros: { organizacaoId: "Esta sociedade já não existe." } };
  }

  const aprovadoEm = eu.papel === "super_admin" ? new Date() : null;
  // Regra de negócio: só o society_admin atribui gestor/dependente; o super_admin não escolhe.
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

    await notificarDonoNovoUtilizador({
      nome: conta.nome,
      email: conta.email,
      sociedadeNome: sociedade.nome,
      papel: conta.papel,
      organizacaoId: alvo,
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
 * Cria outra conta de plataforma. Só `super_admin`, sem sociedade. A primeira
 * nasce no servidor (`scripts/criar_utilizador.mjs`); um único dono é um
 * ponto único de falha se perder a palavra-passe.
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

/** Tamanho máximo do ficheiro de importação em lote. */
const LIMITE_IMPORTACAO_BYTES = 2 * 1024 * 1024;

export type ResultadoImportacao =
  | {
      ok: true;
      criadas: ContaCriada[];
      recusadas: LinhaRecusada[];
    }
  | { ok: false; erro: string };

/**
 * Importação em lote, a partir de `.csv` ou `.xlsx`. Tudo ou nada para as
 * linhas válidas — uma transação única evita ficheiro de trinta a rebentar na
 * vigésima e deixar dezanove por saber quais. Linhas recusadas não travam as
 * boas: são um erro de quem preencheu a folha, corrigível à parte.
 */
export async function importarUtilizadores(
  organizacaoIdPedida: string | null,
  ficheiro: File,
): Promise<ResultadoImportacao> {
  const { eu } = await exigirGestorDeUtilizadores();

  const alvo = sociedadeAlvo(eu, organizacaoIdPedida);
  if (!alvo) return { ok: false, erro: "Escolha a sociedade onde importar as contas." };

  const [sociedade] = await db()
    .select({ id: organizacao.id, nome: organizacao.nome })
    .from(organizacao)
    .where(and(eq(organizacao.id, alvo), isNull(organizacao.apagadoEm)))
    .limit(1);

  if (!sociedade) return { ok: false, erro: "Esta sociedade já não existe." };

  // Uma folha de mil linhas não chega a 100 kB — o limite é sobre o que uma
  // Server Action deve aceitar receber, não sobre o formato.
  if (ficheiro.size > LIMITE_IMPORTACAO_BYTES) {
    return { ok: false, erro: `O ficheiro é demasiado grande (máximo ${LIMITE_IMPORTACAO_BYTES / (1024 * 1024)} MB).` };
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

  /** Envios ficam à espera de a transação fechar (caso estejam aprovadas). */
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

  for (const c of criadas) {
    await notificarDonoNovoUtilizador({
      nome: c.nome,
      email: c.email,
      sociedadeNome: sociedade.nome,
      papel: c.papel,
      organizacaoId: alvo,
    });
  }

  revalidatePath("/admin");
  revalidatePath("/admin/aprovacoes");
  revalidatePath(`/admin/sociedades/${alvo}`);
  revalidatePath("/admin/utilizadores");
  revalidatePath("/utilizadores");

  return { ok: true, criadas, recusadas };
}

/* -------------------------------------------------------- estado da conta */

/**
 * Liga e desliga uma conta. `ativo = false`, nunca apagamento —
 * `processo.responsavel_id` e `evento_auditoria.ator_id` apontam para esta
 * linha, e apagá-la perderia a resposta a "quem aprovou isto" (retenção de 7 anos).
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

  // society_admin só mexe na sua sociedade.
  if (eu.papel !== "super_admin" && alvo.organizacaoId !== eu.organizacaoId) {
    return { ok: false, erro: "Esta conta não é da sua sociedade." };
  }

  // Ninguém se desliga a si próprio — não haveria forma de reverter.
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
 * Aprova um utilizador pendente. Só `super_admin`. Gera palavra-passe
 * temporária, marca `aprovado_em`/`deve_redefinir_password`, envia
 * credenciais por email.
 *
 * Palavra-passe gerada aqui, não na criação — uma conta pendente e rejeitável
 * não deve ter recebido credenciais nenhumas. Mesma regra de `criarConta`:
 * quem administra não a escolhe, não a lê, não a entrega.
 */
export async function aprovarUtilizador(utilizadorId: string): Promise<ResultadoAprovacao> {
  const { eu } = await exigirSuperAdmin();

  const [alvo] = await db()
    .select()
    .from(utilizador)
    .where(and(eq(utilizador.id, utilizadorId), isNull(utilizador.apagadoEm)))
    .limit(1);

  if (!alvo) return { ok: false, erro: "Este utilizador já não existe." };

  // Já aprovada: não se repete, e não se diz que credenciais saíram sem
  // sair — duplo clique geraria palavra-passe nova, invalidando a já trocada.
  if (alvo.aprovadoEm) return { ok: true, jaAprovado: true, emailEnviado: null };

  // Sem conta do Better Auth não há onde guardar a palavra-passe — mandar o
  // email seria entregar credenciais que não abrem nada.
  if (!alvo.authUserId) {
    return {
      ok: false,
      erro: "Esta conta não está ligada ao início de sessão e não pode ser aprovada. Recrie-a a partir da sociedade.",
    };
  }

  const authUserId = alvo.authUserId;

  // auth_user_id preenchido não garante conta do outro lado: a coluna não tem
  // FK para user.id, e uma linha do Better Auth apagada deixa um identificador
  // pendurado. Sem esta consulta, o INSERT de recuperação batia na FK de
  // account.userId e o catch respondia "Tente de novo" para uma operação que
  // nunca funcionaria.
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

  // Credencial em falta recupera-se, e a recuperação fica em auditoria
  // (credencialCriada) — distingue "trocou-se a palavra-passe" de "não havia nenhuma".
  let credencialCriada = false;

  // Duas escritas, uma transação (mesma razão da D63): entre elas não há
  // estado aceitável — palavra-passe trocada numa conta ainda pendente, ou
  // conta aprovada sem palavra-passe nova, são ambos estados quebrados.
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
        // account é onde o Better Auth procura a palavra-passe (D23) — sem
        // ela, a conta ficava aprovada com credenciais que não abrem nada.
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
    // Conta que já existia e está a ser aprovada: a palavra-passe dela não
    // mudou, portanto não é o caminho das credenciais novas.
    reaproveitada: true,
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
 * Rejeita um utilizador pendente. Só `super_admin`. Soft-delete
 * (`apagado_em`, `ativo = false`) com auditoria.
 *
 * Só vale sobre pendentes: sem essa verificação, o identificador de qualquer
 * conta (mesmo um admin ativo há meses) bastaria para a apagar por um caminho
 * chamado "rejeitar". Desligar uma conta em uso é outro caminho, reversível
 * (`alterarEstadoDaConta`).
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
