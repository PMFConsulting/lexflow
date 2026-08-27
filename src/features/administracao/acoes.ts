"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { organizacao, utilizador } from "@/db/schema/organizacao";
import { conviteUtilizador, documentoOrganizacao } from "@/db/schema/sociedade";
import { registarEvento } from "@/features/auditoria/registar";
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
import { exigirAdministracao } from "@/lib/sessao";
import { expiraDaquiA, novoTokenAcesso } from "@/lib/token";

/**
 * As ações do portal de administração da sociedade.
 *
 * **Todas** começam por `exigirAdministracao()`, e não por confiança em quem
 * chama. Uma Server Action é um endpoint público como qualquer outro: esconder
 * o botão na navegação é cortesia, não segurança, e é exatamente a lição da D35
 * aplicada a operações que escrevem em vez de lerem.
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
});

export type ResultadoConvidar =
  | { ok: true; link: string; email: string; emailEnviado: boolean; erroEmail?: string }
  | { ok: false; erros: Record<string, string[]>; mensagem?: string };

/**
 * Convida uma pessoa para a sociedade.
 *
 * O link é devolvido **sempre**, tenha o email saído ou não. É a lição da D48:
 * um link que só existe dentro de uma mensagem que pode nunca chegar é um
 * convite que ninguém consegue destrancar — e o administrador que o enviou não
 * tem como saber que assim ficou. Com o link no ecrã, um envio falhado
 * resolve-se copiando o endereço e mandando-o por outra via.
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

  const { nome, papel } = r.data;
  const email = r.data.email.trim().toLowerCase();
  const base = db();

  /*
   * Já lá está, ou já foi convidado?
   *
   * As duas perguntas têm respostas diferentes e saídas diferentes: uma pessoa
   * que já é da equipa não se convida (muda-se-lhe o papel), e um convite
   * pendente não se duplica — duplicá-lo dava dois links válidos para o mesmo
   * endereço, e quem os recebesse não saberia qual usar. O que sobra é
   * reenviar, que é outra ação.
   */
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
      logotipoAtualizadoEm: organizacao.logotipoAtualizadoEm,
    })
    .from(organizacao)
    .where(eq(organizacao.id, eu.organizacaoId))
    .limit(1);

  /*
   * A partir daqui, cada passo no seu próprio `try` (D46).
   *
   * O convite está gravado. O que vem a seguir — montar o link, enviar o email,
   * escrever a auditoria — não pode transformar um convite criado numa ação que
   * rebentou e não disse nada: era exatamente a forma do defeito do
   * `criarProcesso`, com o registo na base e o ecrã a dizer que o servidor não
   * respondeu.
   */
  let link = "";
  let emailEnviado = false;
  let erroEmail: string | undefined;

  try {
    link = `${await origemPublica()}/convite/${token}`;
  } catch (e) {
    // Sem `origemPublica` não há link para mostrar nem para enviar. Devolve-se
    // o token em bruto, que é melhor do que nada: quem administra sabe colar o
    // domínio à frente, e o alternativo era um convite inalcançável.
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
      // O hash e nunca o token em claro: quem tiver leitura do `email_log` não
      // fica com a chave de nenhum convite (D4/D34).
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

  return { ok: true, link, email, emailEnviado, erroEmail };
}

/* ------------------------------------------------------------- reenviar */

export type ResultadoReenvio =
  | { ok: true; link: string; emailEnviado: boolean; erroEmail?: string }
  | { ok: false; mensagem: string };

/**
 * Reenvia um convite — com um **token novo**.
 *
 * O token antigo deixa de servir, e é de propósito: reenviar o mesmo link não
 * resolve o caso mais comum, que é o convite ter expirado, e no caso de um
 * endereço trocado deixaria um link válido na caixa de correio errada.
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
 * A guarda que importa não é a de quem chama — é a de **não ficar sem
 * administradores**. Um administrador que se despromova a assistente fecha a
 * porta da administração por dentro, e a única saída passa a ser o servidor.
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
 * Ativa ou desativa alguém.
 *
 * Desativar não apaga: `sessaoAtual()` deixa de resolver a sessão dessa pessoa
 * e ela deixa de entrar, mas tudo o que ela escreveu — passos gravados,
 * documentos carregados, linhas de auditoria — continua a apontar para ela. Num
 * sistema sujeito a sete anos de retenção, apagar o autor de um ato é apagar
 * metade do ato.
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
 * A regra que esta função existe para defender é a da D3/D38: a versão **tem de
 * mudar** quando o documento muda. Substituir o PDF mantendo a versão apaga a
 * diferença entre o que cada cliente e cada advogado aceitou e o que passou a
 * estar escrito — que é precisamente a prova que esta parte do sistema existe
 * para guardar. Por isso a versão é obrigatória, e por isso repeti-la é
 * recusado com a versão em vigor à frente.
 *
 * O documento anterior fica em soft delete e as aceitações antigas continuam a
 * apontar para a versão que quem as deu viu de facto.
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

  // Um documento de T&C vivo por sociedade (mesma regra da D52): duas linhas
  // vivas obrigariam a escolher uma por ordenação, que é como um cliente acaba
  // a aceitar o articulado errado sem ninguém dar por isso.
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

  revalidatePath("/gestao/sociedade");
  return { ok: true, versao };
}
