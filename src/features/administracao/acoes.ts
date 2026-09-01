"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { organizacao, utilizador } from "@/db/schema/organizacao";
import {
  conviteUtilizador,
  documentoOrganizacao,
  perfilUtilizador,
} from "@/db/schema/sociedade";
import { registarEvento } from "@/features/auditoria/registar";
import { perfilConvidadoSchema } from "@/features/convites/schemas";
import {
  assinaturaConfere,
  mensagemConteudo,
  mimeAceite,
} from "@/features/onboarding/formatos";
import { email as campoEmail, obrigatorio } from "@/lib/campos";
import { enviarEmail } from "@/lib/email";
import { ASSUNTO_CONVITE_UTILIZADOR, emailConviteUtilizador } from "@/lib/emails/convites";
import { urlLogotipoSociedade } from "@/lib/emails/moldura";
import { origemPublica } from "@/lib/origem";
import { exigirAdministracao, exigirGestorDeUtilizadores } from "@/lib/sessao";
import { expiraDaquiA, novoTokenAcesso } from "@/lib/token";
import {
  CAMPOS_MAE,
  dadosSociedadeSchema,
  MENSAGEM_CAMPOS_MAE,
} from "./schemas";

/**
 * Ações do portal de administração da sociedade.
 *
 * Todas começam por `exigirAdministracao()` — uma Server Action é um endpoint
 * público como outro qualquer, esconder o botão não é segurança (D35).
 */

async function contexto() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
  };
}

const PAPEIS = ["society_admin", "gestor", "utilizador"] as const;

/* ------------------------------------------------------------- convidar */

const esquemaConvite = z.object({
  nome: obrigatorio("O nome").max(200, "Máximo 200 caracteres."),
  email: campoEmail,
  papel: z.enum(PAPEIS, { message: "Escolha o perfil desta pessoa." }),
  /**
   * A ficha da pessoa, já preenchida por quem convida — opcional.
   *
   * Quem convida tem quase sempre o processo de admissão em cima da mesa, e
   * obrigar a pessoa a reescrever o que a sociedade já sabe é a razão por que
   * um convite fica parado no passo 1. O que ela recebe é o formulário dela
   * com os campos já lá, editáveis: os dados são dela, a última palavra
   * também. Nada disto substitui os passos 3 a 6 — anexos, sigilo, T&C e
   * palavra-passe são atos próprios (`perfilConvidadoSchema`).
   */
  perfil: perfilConvidadoSchema.optional(),
});

export type ResultadoConvidar =
  | {
      ok: true;
      link: string;
      email: string;
      emailEnviado: boolean;
      erroEmail?: string;
      /** `true` quando veio ficha adiantada e ela ficou gravada. */
      perfilGravado: boolean;
    }
  | { ok: false; erros: Record<string, string[]>; mensagem?: string };

/**
 * Convida uma pessoa para a sociedade.
 *
 * O link é sempre devolvido, mesmo que o email falhe (D48) — sem ele no ecrã,
 * um envio falhado deixava o convite inacessível e o administrador sem saber.
 */
export async function convidarUtilizador(dados: unknown): Promise<ResultadoConvidar> {
  const { eu } = await exigirAdministracao();

  const r = esquemaConvite.safeParse(dados);
  if (!r.success) {
    const erros: Record<string, string[]> = {};
    for (const problema of r.error.issues) {
      const campo = problema.path.join(".") || "_";
      (erros[campo] ??= []).push(problema.message);
    }
    return { ok: false, erros };
  }

  const { nome, papel, perfil } = r.data;
  const email = r.data.email.trim().toLowerCase();
  const base = db();

  // Já está na equipa (muda-se-lhe o papel) ou já tem convite pendente
  // (reenvia-se): duplicar dava dois links válidos para o mesmo endereço.
  const [jaNaEquipa] = await base
    .select({ id: utilizador.id })
    .from(utilizador)
    .where(
      and(
        eq(utilizador.organizacaoId, eu.organizacaoId),
        eq(utilizador.email, email),
        isNull(utilizador.apagadoEm),
      ),
    )
    .limit(1);

  if (jaNaEquipa) {
    return {
      ok: false,
      erros: {
        email: [
          "Esta pessoa já faz parte da equipa. Para lhe mudar o perfil, use a lista de utilizadores.",
        ],
      },
    };
  }

  const [pendente] = await base
    .select({ id: conviteUtilizador.id })
    .from(conviteUtilizador)
    .where(
      and(
        eq(conviteUtilizador.organizacaoId, eu.organizacaoId),
        eq(conviteUtilizador.email, email),
        eq(conviteUtilizador.estado, "pendente"),
        isNull(conviteUtilizador.apagadoEm),
      ),
    )
    .limit(1);

  if (pendente) {
    return {
      ok: false,
      erros: {
        email: [
          "Já existe um convite pendente para este endereço. Use «Reenviar» na lista de convites — um segundo convite daria dois links válidos para a mesma pessoa.",
        ],
      },
    };
  }

  const { token, hash } = novoTokenAcesso();

  const [convite] = await base
    .insert(conviteUtilizador)
    .values({
      organizacaoId: eu.organizacaoId,
      email,
      nome,
      papel,
      tokenAcessoHash: hash,
      expiraEm: expiraDaquiA(30),
      criadoPor: eu.id,
    })
    .returning({ id: conviteUtilizador.id });

  const [org] = await base
    .select({
      id: organizacao.id,
      nome: organizacao.nome,
      logotipoDados: organizacao.logotipoDados,
      logotipoMime: organizacao.logotipoMime,
      logotipoAtualizadoEm: organizacao.logotipoAtualizadoEm,
    })
    .from(organizacao)
    .where(eq(organizacao.id, eu.organizacaoId))
    .limit(1);

  // A ficha adiantada, se veio — no seu próprio `try` (D46): o convite já
  // existe e é acessível, e um perfil por gravar não pode fazer parecer que o
  // convite falhou. O ecrã diz as duas coisas em separado.
  let perfilGravado = false;
  if (perfil && convite) {
    const valores = Object.fromEntries(
      Object.entries(perfil).filter(([, valor]) => valor !== undefined),
    );
    if (Object.keys(valores).length > 0) {
      try {
        await base.insert(perfilUtilizador).values({
          organizacaoId: eu.organizacaoId,
          conviteId: convite.id,
          ...valores,
        } as typeof perfilUtilizador.$inferInsert);
        perfilGravado = true;

        await registarEvento({
          organizacaoId: eu.organizacaoId,
          atorId: eu.id,
          acao: "utilizador.dados_preenchidos_por_admin",
          entidade: "perfil_utilizador",
          entidadeId: convite.id,
          valorNovo: { email, papel, campos: Object.keys(valores), ...valores },
        }).catch((e) => console.error("[admin] audit write failed", { erro: String(e) }));
      } catch (e) {
        console.error("[admin] convite criado, perfil adiantado não:", e);
      }
    }
  }

  // A partir daqui, cada passo no seu próprio `try` (D46): o convite já está
  // gravado, e montar o link, enviar o email ou escrever a auditoria não pode
  // fazer parecer que a ação toda falhou.
  let link = "";
  let emailEnviado = false;
  let erroEmail: string | undefined;

  try {
    link = `${await origemPublica()}/convite/${token}`;
  } catch (e) {
    // Sem `origemPublica`, devolve-se o token em bruto — quem administra
    // completa o domínio à mão em vez de ficar com um convite inalcançável.
    console.error("[admin] origemPublica failed", { erro: String(e) });
    link = `/convite/${token}`;
  }

  try {
    const envio = await enviarEmail({
      para: email,
      assunto: ASSUNTO_CONVITE_UTILIZADOR,
      html: emailConviteUtilizador({
        nome,
        sociedade: org?.nome ?? "a sociedade",
        link,
        papel,
        logotipoUrl: urlLogotipoSociedade(org),
      }),
      template: "convite_utilizador",
      organizacaoId: eu.organizacaoId,
      // Hash e não o token em claro — leitura do `email_log` não dá acesso a convites (D4/D34).
      tokenHash: hash,
    });
    emailEnviado = envio.ok;
    if (!envio.ok) erroEmail = envio.erro;
  } catch (e) {
    erroEmail = e instanceof Error ? e.message : String(e);
    console.error("[admin] invitation email blew up", { email, erro: erroEmail });
  }

  try {
    const { ip, userAgent } = await contexto();
    await registarEvento({
      organizacaoId: eu.organizacaoId,
      atorId: eu.id,
      acao: emailEnviado ? "convite.enviado" : "convite.envio_falhou",
      entidade: "convite_utilizador",
      entidadeId: convite?.id ?? null,
      valorNovo: { email, papel, erro: erroEmail ?? null },
      ip,
      userAgent,
    });
  } catch (e) {
    console.error("[admin] audit write failed", { erro: String(e) });
  }

  try {
    revalidatePath("/gestao/utilizadores");
  } catch {
    // Fora de um contexto de pedido não é motivo para falhar um convite criado.
  }

  return { ok: true, link, email, emailEnviado, erroEmail, perfilGravado };
}

/* ------------------------------------------------------------- reenviar */

export type ResultadoReenvio =
  | { ok: true; link: string; emailEnviado: boolean; erroEmail?: string }
  | { ok: false; mensagem: string };

/**
 * Reenvia um convite com token novo. O antigo deixa de servir — reenviar o
 * mesmo link não resolve expiração, e num endereço trocado deixaria um link
 * válido na caixa errada.
 */
export async function reenviarConvite(conviteId: string): Promise<ResultadoReenvio> {
  const { eu } = await exigirAdministracao();
  const base = db();

  const [convite] = await base
    .select()
    .from(conviteUtilizador)
    .where(
      and(
        eq(conviteUtilizador.id, conviteId),
        eq(conviteUtilizador.organizacaoId, eu.organizacaoId),
        isNull(conviteUtilizador.apagadoEm),
      ),
    )
    .limit(1);

  if (!convite) return { ok: false, mensagem: "Convite não encontrado." };
  if (convite.estado === "aceite") {
    return {
      ok: false,
      mensagem: "Este convite já foi aceite — a conta existe. Não há nada para reenviar.",
    };
  }

  const { token, hash } = novoTokenAcesso();

  await base
    .update(conviteUtilizador)
    .set({
      tokenAcessoHash: hash,
      expiraEm: expiraDaquiA(30),
      estado: "pendente",
      atualizadoEm: new Date(),
    })
    .where(eq(conviteUtilizador.id, convite.id));

  const [org] = await base
    .select({ nome: organizacao.nome })
    .from(organizacao)
    .where(eq(organizacao.id, eu.organizacaoId))
    .limit(1);

  let link = `/convite/${token}`;
  try {
    link = `${await origemPublica()}/convite/${token}`;
  } catch (e) {
    console.error("[admin] origemPublica failed", { erro: String(e) });
  }

  let emailEnviado = false;
  let erroEmail: string | undefined;

  try {
    const envio = await enviarEmail({
      para: convite.email,
      assunto: ASSUNTO_CONVITE_UTILIZADOR,
      html: emailConviteUtilizador({
        nome: convite.nome,
        sociedade: org?.nome ?? "a sociedade",
        link,
        papel: convite.papel,
      }),
      template: "convite_utilizador",
      organizacaoId: eu.organizacaoId,
      tokenHash: hash,
    });
    emailEnviado = envio.ok;
    if (!envio.ok) erroEmail = envio.erro;
  } catch (e) {
    erroEmail = e instanceof Error ? e.message : String(e);
  }

  try {
    const { ip, userAgent } = await contexto();
    await registarEvento({
      organizacaoId: eu.organizacaoId,
      atorId: eu.id,
      acao: "convite.reenviado",
      entidade: "convite_utilizador",
      entidadeId: convite.id,
      valorNovo: { email: convite.email, emailEnviado },
      ip,
      userAgent,
    });
  } catch (e) {
    console.error("[admin] audit write failed", { erro: String(e) });
  }

  revalidatePath("/gestao/utilizadores");
  return { ok: true, link, emailEnviado, erroEmail };
}

/* ------------------------------------------------------------ cancelar */

export async function cancelarConvite(conviteId: string) {
  const { eu } = await exigirAdministracao();
  const base = db();

  const [convite] = await base
    .select()
    .from(conviteUtilizador)
    .where(
      and(
        eq(conviteUtilizador.id, conviteId),
        eq(conviteUtilizador.organizacaoId, eu.organizacaoId),
      ),
    )
    .limit(1);

  if (!convite) return { ok: false as const, mensagem: "Convite não encontrado." };
  if (convite.estado === "aceite") {
    return {
      ok: false as const,
      mensagem:
        "Este convite já foi aceite e a conta existe. Para lhe retirar o acesso, desative o utilizador na lista da equipa.",
    };
  }

  await base
    .update(conviteUtilizador)
    .set({ estado: "cancelado", atualizadoEm: new Date() })
    .where(eq(conviteUtilizador.id, convite.id));

  const { ip, userAgent } = await contexto();
  await registarEvento({
    organizacaoId: eu.organizacaoId,
    atorId: eu.id,
    acao: "convite.cancelado",
    entidade: "convite_utilizador",
    entidadeId: convite.id,
    valorAnterior: { estado: convite.estado, email: convite.email },
    ip,
    userAgent,
  }).catch((e) => console.error("[admin] audit write failed", { erro: String(e) }));

  revalidatePath("/gestao/utilizadores");
  return { ok: true as const };
}

/* -------------------------------------------------------- papel e estado */

const esquemaPapel = z.object({
  utilizadorId: z.string().min(1),
  papel: z.enum(PAPEIS, { message: "Perfil inválido." }),
});

/**
 * Muda o perfil de alguém da equipa.
 *
 * A guarda que importa é não ficar sem administradores — despromover o
 * último fecha a administração por dentro, sem saída que não seja o servidor.
 */
export async function alterarPapel(dados: unknown) {
  const { eu } = await exigirAdministracao();

  const r = esquemaPapel.safeParse(dados);
  if (!r.success) return { ok: false as const, mensagem: "Perfil inválido." };

  const { utilizadorId, papel } = r.data;
  const base = db();

  const [alvo] = await base
    .select()
    .from(utilizador)
    .where(
      and(
        eq(utilizador.id, utilizadorId),
        eq(utilizador.organizacaoId, eu.organizacaoId),
        isNull(utilizador.apagadoEm),
      ),
    )
    .limit(1);

  if (!alvo) return { ok: false as const, mensagem: "Utilizador não encontrado." };
  if (alvo.papel === papel) return { ok: true as const };

  if (alvo.papel === "society_admin" && papel !== "society_admin") {
    const restantes = await contarAdministradores(eu.organizacaoId, alvo.id);
    if (restantes === 0) {
      return {
        ok: false as const,
        mensagem:
          "Esta é a última conta de administrador. Promova outra pessoa a administrador antes de mudar esta — sem administrador, a área de administração fica inacessível e só se recupera no servidor.",
      };
    }
  }

  await base
    .update(utilizador)
    .set({ papel, atualizadoEm: new Date() })
    .where(eq(utilizador.id, alvo.id));

  const { ip, userAgent } = await contexto();
  await registarEvento({
    organizacaoId: eu.organizacaoId,
    atorId: eu.id,
    acao: "utilizador.papel_alterado",
    entidade: "utilizador",
    entidadeId: alvo.id,
    valorAnterior: { papel: alvo.papel },
    valorNovo: { papel, email: alvo.email },
    ip,
    userAgent,
  }).catch((e) => console.error("[admin] audit write failed", { erro: String(e) }));

  revalidatePath("/gestao/utilizadores");
  return { ok: true as const };
}

/** Quantos administradores ativos ficam, sem contar com `exceto`. */
async function contarAdministradores(organizacaoId: string, exceto: string) {
  const linhas = await db()
    .select({ id: utilizador.id })
    .from(utilizador)
    .where(
      and(
        eq(utilizador.organizacaoId, organizacaoId),
        eq(utilizador.papel, "society_admin"),
        eq(utilizador.ativo, true),
        isNull(utilizador.apagadoEm),
      ),
    );
  return linhas.filter((l) => l.id !== exceto).length;
}

/**
 * Ativa ou desativa alguém. Desativar não apaga: `sessaoAtual()` deixa de
 * resolver a sessão, mas tudo o que a pessoa escreveu continua a apontar para
 * ela — com sete anos de retenção, apagar o autor apagaria metade do ato.
 */
export async function alterarEstadoUtilizador(utilizadorId: string, ativo: boolean) {
  const { eu } = await exigirAdministracao();
  const base = db();

  const [alvo] = await base
    .select()
    .from(utilizador)
    .where(
      and(
        eq(utilizador.id, utilizadorId),
        eq(utilizador.organizacaoId, eu.organizacaoId),
        isNull(utilizador.apagadoEm),
      ),
    )
    .limit(1);

  if (!alvo) return { ok: false as const, mensagem: "Utilizador não encontrado." };

  if (!ativo && alvo.id === eu.id) {
    return {
      ok: false as const,
      mensagem: "Não pode desativar a sua própria conta — ficaria de fora à porta fechada.",
    };
  }

  if (!ativo && alvo.papel === "society_admin") {
    const restantes = await contarAdministradores(eu.organizacaoId, alvo.id);
    if (restantes === 0) {
      return {
        ok: false as const,
        mensagem:
          "Esta é a última conta de administrador ativa. Promova outra pessoa a administrador antes de desativar esta.",
      };
    }
  }

  await base
    .update(utilizador)
    .set({ ativo, atualizadoEm: new Date() })
    .where(eq(utilizador.id, alvo.id));

  const { ip, userAgent } = await contexto();
  await registarEvento({
    organizacaoId: eu.organizacaoId,
    atorId: eu.id,
    acao: ativo ? "utilizador.ativado" : "utilizador.desativado",
    entidade: "utilizador",
    entidadeId: alvo.id,
    valorNovo: { email: alvo.email, ativo },
    ip,
    userAgent,
  }).catch((e) => console.error("[admin] audit write failed", { erro: String(e) }));

  revalidatePath("/gestao/utilizadores");
  return { ok: true as const };
}

/* ------------------------------------------------------ T&C da sociedade */

const MAX_TERMOS = 4 * 1024 * 1024;

export type ResultadoTermos =
  | { ok: true; versao: string }
  | { ok: false; erros?: Record<string, string[]>; mensagem: string };

/**
 * Publica uma versão nova dos Termos e Condições da sociedade.
 *
 * A versão tem de mudar quando o documento muda (D3/D38) — repetir a versão
 * em vigor é recusado, senão apaga-se a diferença entre o que já foi aceite e
 * o que passa a estar escrito. O documento anterior fica em soft delete; as
 * aceitações antigas continuam a apontar para a versão que viram de facto.
 */
export async function publicarTermosSociedade(formData: FormData): Promise<ResultadoTermos> {
  const { eu } = await exigirAdministracao();
  const base = db();

  const versao = String(formData.get("versao") ?? "").trim();
  if (!versao) {
    return {
      ok: false,
      erros: { versao: ["A versão é obrigatória."] },
      mensagem: "Indique a versão do articulado.",
    };
  }
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(versao)) {
    return {
      ok: false,
      erros: {
        versao: [
          "Use letras, números, pontos, traços ou underscores — por exemplo 2026.08.1. Máximo 40 caracteres.",
        ],
      },
      mensagem: "A versão tem um formato inválido.",
    };
  }

  const [org] = await base
    .select()
    .from(organizacao)
    .where(eq(organizacao.id, eu.organizacaoId))
    .limit(1);

  if (!org) return { ok: false, mensagem: "Sociedade não encontrada." };

  if (org.termosVersao === versao) {
    return {
      ok: false,
      erros: {
        versao: [
          `A versão «${versao}» já está em vigor. Suba a versão — publicar um documento novo com a mesma versão apaga a diferença entre o que já foi aceite e o que passa a estar escrito.`,
        ],
      },
      mensagem: "A versão tem de mudar quando o documento muda.",
    };
  }

  const ficheiro = formData.get("ficheiro");
  if (!(ficheiro instanceof File) || ficheiro.size === 0) {
    return {
      ok: false,
      erros: { ficheiro: ["Escolha o PDF do articulado."] },
      mensagem: "Falta o documento.",
    };
  }
  if (ficheiro.size > MAX_TERMOS) {
    const mb = (ficheiro.size / 1024 / 1024).toFixed(1);
    return {
      ok: false,
      erros: { ficheiro: [`O ficheiro tem ${mb} MB. O máximo são 4 MB.`] },
      mensagem: "O ficheiro é demasiado grande.",
    };
  }

  const mime = mimeAceite(ficheiro.name, ficheiro.type);
  if (mime !== "application/pdf") {
    return {
      ok: false,
      erros: {
        ficheiro: [
          `«${ficheiro.name}» não é um PDF. O articulado tem de ser um PDF — é o documento que vai ser apresentado aos clientes.`,
        ],
      },
      mensagem: "O documento tem de ser um PDF.",
    };
  }

  const bytes = Buffer.from(await ficheiro.arrayBuffer());
  if (!assinaturaConfere(mime, bytes)) {
    return {
      ok: false,
      erros: { ficheiro: [mensagemConteudo(ficheiro.name)] },
      mensagem: "O conteúdo não corresponde a um PDF.",
    };
  }

  const hash = createHash("sha256").update(bytes).digest("hex");

  // Um documento de T&C vivo por sociedade (mesma regra da D52) — duas linhas
  // vivas obrigariam a escolher uma por ordenação.
  await base
    .update(documentoOrganizacao)
    .set({ apagadoEm: new Date() })
    .where(
      and(
        eq(documentoOrganizacao.organizacaoId, org.id),
        eq(documentoOrganizacao.tipo, "termos_sociedade"),
        isNull(documentoOrganizacao.conviteId),
        isNull(documentoOrganizacao.apagadoEm),
      ),
    );

  const [linha] = await base
    .insert(documentoOrganizacao)
    .values({
      organizacaoId: org.id,
      tipo: "termos_sociedade",
      nomeOriginal: ficheiro.name.slice(0, 200),
      mime,
      tamanhoBytes: ficheiro.size,
      hashSha256: hash,
      chaveStorage: `sociedades/${org.id}/${hash}`,
      dados: bytes.toString("base64"),
      carregadoPor: eu.id,
    })
    .returning({ id: documentoOrganizacao.id });

  await base
    .update(organizacao)
    .set({
      termosDocumentoRef: linha.id,
      termosVersao: versao,
      termosAtualizadoEm: new Date(),
    })
    .where(eq(organizacao.id, org.id));

  const { ip, userAgent } = await contexto();
  await registarEvento({
    organizacaoId: org.id,
    atorId: eu.id,
    acao: "termos.publicados",
    entidade: "documento_organizacao",
    entidadeId: linha.id,
    valorAnterior: { versao: org.termosVersao },
    valorNovo: { versao, nome: ficheiro.name, hash },
    ip,
    userAgent,
  }).catch((e) => console.error("[admin] audit write failed", { erro: String(e) }));

  revalidatePath("/gestao/configuracoes");
  return { ok: true, versao };
}

/* ------------------------------------------------- dados da sociedade */

export type ResultadoDadosSociedade =
  | { ok: true }
  | { ok: false; erros: Record<string, string[]>; mensagem?: string };

/** Os campos que esta ação escreve — a lista existe uma vez e serve o UPDATE e a auditoria. */
const COLUNAS_EDITAVEIS = [
  "naturezaJuridica",
  "numeroOrdem",
  "emailGeral",
  "telefone",
  "website",
  "morada",
  "pais",
  "localidade",
  "codigoPostal",
  "freguesia",
  "concelho",
  "distrito",
] as const;

/**
 * Atualiza os dados **não-mãe** da sociedade.
 *
 * Quem administra a sociedade corrige a sede, os contactos, a forma jurídica e
 * o número de inscrição na Ordem sem passar pelo suporte — era o que a página
 * dizia para fazer, e o que fazia dela um ecrã de leitura sobre dados que
 * envelhecem. O que continua fechado são os três campos de identidade
 * (`CAMPOS_MAE`), que só `atualizarSociedade` (super_admin, em `/admin`) muda.
 *
 * `exigirGestorDeUtilizadores` e não `exigirAdministracao`: o super_admin
 * também os pode corrigir — indicando a sociedade —, pela mesma regra que já
 * vale para criar contas. Para o `society_admin` a sociedade-alvo **nunca vem
 * do pedido**: é sempre a dele, ignorando o que venha em `organizacaoId`.
 */
export async function atualizarDadosSociedade(
  dados: unknown,
): Promise<ResultadoDadosSociedade> {
  const { eu } = await exigirGestorDeUtilizadores();

  if (typeof dados !== "object" || dados === null) {
    return { ok: false, erros: {}, mensagem: "Pedido inválido." };
  }
  const carga = dados as Record<string, unknown>;

  // Os campos mãe recusam-se em vez de serem ignorados em silêncio: um pedido
  // que os traz está a pedir outra coisa, e deixá-lo passar «com sucesso» sem
  // os gravar é a forma de alguém acreditar que mudou o NIPC.
  const maeNoPedido = CAMPOS_MAE.filter((campo) => campo in carga);
  if (maeNoPedido.length > 0) {
    return {
      ok: false,
      erros: Object.fromEntries(maeNoPedido.map((campo) => [campo, [MENSAGEM_CAMPOS_MAE]])),
      mensagem: MENSAGEM_CAMPOS_MAE,
    };
  }

  const alvo =
    eu.papel === "super_admin"
      ? typeof carga.organizacaoId === "string"
        ? carga.organizacaoId
        : null
      : eu.organizacaoId;

  if (!alvo) {
    return {
      ok: false,
      erros: { organizacaoId: ["Indique a sociedade a atualizar."] },
      mensagem: "Indique a sociedade a atualizar.",
    };
  }

  const r = dadosSociedadeSchema.safeParse(carga);
  if (!r.success) {
    const erros: Record<string, string[]> = {};
    for (const problema of r.error.issues) {
      const campo = problema.path.join(".") || "_";
      (erros[campo] ??= []).push(problema.message);
    }
    return { ok: false, erros, mensagem: "Falta corrigir um campo." };
  }

  const base = db();

  const [antes] = await base
    .select()
    .from(organizacao)
    .where(and(eq(organizacao.id, alvo), isNull(organizacao.apagadoEm)))
    .limit(1);

  if (!antes) return { ok: false, erros: {}, mensagem: "Esta sociedade já não existe." };

  // `website` é o único opcional: vazio grava `null`, que é como se apaga um
  // endereço que deixou de servir.
  const valores = {
    naturezaJuridica: r.data.naturezaJuridica,
    numeroOrdem: r.data.numeroOrdem,
    emailGeral: r.data.emailGeral,
    telefone: r.data.telefone,
    website: r.data.website ?? null,
    morada: r.data.morada,
    pais: r.data.pais,
    localidade: r.data.localidade,
    codigoPostal: r.data.codigoPostal,
    freguesia: r.data.freguesia,
    concelho: r.data.concelho,
    distrito: r.data.distrito,
  };

  try {
    await base
      .update(organizacao)
      .set({ ...valores, atualizadoEm: new Date() })
      .where(eq(organizacao.id, alvo));
  } catch (e) {
    console.error("[admin] falhou a atualizar os dados da sociedade:", e);
    return { ok: false, erros: {}, mensagem: "Não foi possível gravar. Tente de novo." };
  }

  const anterior: Record<string, unknown> = {};
  for (const coluna of COLUNAS_EDITAVEIS) {
    anterior[coluna] = (antes as Record<string, unknown>)[coluna] ?? null;
  }

  const { ip, userAgent } = await contexto();
  await registarEvento({
    organizacaoId: alvo,
    atorId: eu.id,
    acao: "sociedade.dados_atualizados",
    entidade: "organizacao",
    entidadeId: alvo,
    valorAnterior: anterior,
    valorNovo: valores,
    ip,
    userAgent,
  }).catch((e) => console.error("[admin] audit write failed", { erro: String(e) }));

  revalidatePath("/gestao/configuracoes");
  revalidatePath(`/admin/sociedades/${alvo}`);
  return { ok: true };
}
