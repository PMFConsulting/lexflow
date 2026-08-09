"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contadorReferencia, organizacao } from "@/db/schema/organizacao";
import { processoOnboarding } from "@/db/schema/processo";
import { registarEvento } from "@/features/auditoria/registar";
import { enviarEmail } from "@/lib/email";
import { ASSUNTO_REGISTO, emailRegisto } from "@/lib/emails/jmassano";
import { origemPublica } from "@/lib/origem";
import { expiraDaquiA, gerarToken, hashToken } from "@/lib/token";
import { novoProcesso, type NovoProcesso } from "./schemas";

/** Mesma forma em todas as saídas por erro — o `campo` fica sempre no tipo. */
const falha = (erro: string, campo?: string) => ({ ok: false as const, erro, campo });

/**
 * Cria um processo e devolve o link mágico.
 *
 * O token em claro é devolvido uma única vez, aqui — depois disto só existe o
 * hash na base de dados. Quem perder o link pede outro; ninguém o recupera.
 *
 * Os dados de abertura (nome/denominação, NIPC, email) ficam gravados no
 * processo. Antes não ficavam em lado nenhum: o nome servia a saudação de um
 * email que a D33 tirou, e o processo nascia sem uma pista de quem era até o
 * cliente chegar ao passo 1. Numa pessoa coletiva são obrigatórios — é por eles
 * que a sociedade identifica a entidade que acabou de abrir.
 *
 * Com email, o link segue também por mensagem ("JMASSANO | Registro"). O envio
 * nunca faz falhar a criação: o processo já existe e o link continua a ser
 * mostrado no ecrã, que é a forma de o recuperar quando o email não sai.
 */
export async function criarProcesso(entrada: NovoProcesso) {
  // O cliente já validou, e isso é conforto. A decisão é aqui: um NIPC com o
  // checksum errado não entra por a janela ter sido contornada.
  const analise = novoProcesso.safeParse(entrada);
  if (!analise.success) {
    const problema = analise.error.issues[0];
    // O `campo` é o que permite pôr o erro por baixo da caixa certa em vez de
    // um aviso genérico no fundo da janela — com dois campos obrigatórios no
    // percurso Empresa, "dados inválidos" deixa de dizer o que corrigir.
    return falha(
      problema?.message ?? "Dados inválidos.",
      typeof problema?.path[0] === "string" ? problema.path[0] : undefined,
    );
  }

  const { tipoCliente, nome, email } = analise.data;
  const nif = analise.data.tipoCliente === "empresa" ? analise.data.nif : undefined;
  const emailCliente = email?.toLowerCase();

  // A primeira linha do rasto, escrita antes de haver processo: diz o que a
  // Server Action recebeu de facto. Sem ela, "o cliente não recebeu nada" tinha
  // de ser investigado sem saber sequer se o endereço chegou ao servidor — e
  // uma janela que manda um endereço e um servidor que não o recebe é um
  // problema completamente diferente de um envio que falha.
  console.info(
    `[processo] pedido de criação tipo=${tipoCliente} email=${emailCliente ?? "(nenhum)"}`,
  );

  const base = db();

  const [org] = await base.select().from(organizacao).limit(1);
  if (!org) {
    return falha("Não há organização criada. Corra `pnpm db:seed`.");
  }

  const ano = new Date().getFullYear();

  // Sequencial atómico: um UPDATE ... RETURNING não deixa dois processos
  // apanharem o mesmo número, ao contrário de um SELECT max()+1.
  await base
    .insert(contadorReferencia)
    .values({ organizacaoId: org.id, ano, ultimo: 0 })
    .onConflictDoNothing({ target: [contadorReferencia.organizacaoId, contadorReferencia.ano] });

  const token = gerarToken();

  let processo: typeof processoOnboarding.$inferSelect | undefined;
  let referencia = "";

  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    const [contador] = await base
      .update(contadorReferencia)
      .set({ ultimo: sql`${contadorReferencia.ultimo} + 1` })
      .where(
        and(eq(contadorReferencia.organizacaoId, org.id), eq(contadorReferencia.ano, ano)),
      )
      .returning({ ultimo: contadorReferencia.ultimo });

    referencia = `${org.prefixoReferencia}-${ano}-${String(contador.ultimo).padStart(4, "0")}`;

    try {
      [processo] = await base
        .insert(processoOnboarding)
        .values({
          organizacaoId: org.id,
          referencia,
          tipoCliente,
          nomeCliente: nome ?? null,
          nifCliente: nif ?? null,
          emailCliente: emailCliente ?? null,
          tokenAcessoHash: hashToken(token),
          expiraEm: expiraDaquiA(30),
        })
        .returning();
      break;
    } catch (erro) {
      if ((erro as { code?: string }).code === "23505" && tentativa < 5) {
        continue;
      }
      if ((erro as { code?: string }).code === "23505") {
        return falha("Não foi possível criar o processo. Tente novamente.");
      }
      throw erro;
    }
  }

  if (!processo) {
    return falha("Não foi possível criar o processo. Tente novamente.");
  }

  const h = await headers();
  await registarEvento({
    organizacaoId: org.id,
    processoId: processo.id,
    acao: "processo.criado",
    entidade: "processo_onboarding",
    entidadeId: processo.id,
    // Os dados de abertura entram no evento: é a prova de com que identificação
    // o dossier nasceu, antes de o cliente ter tocado nele.
    valorNovo: { referencia, tipoCliente, nome: nome ?? null, nif: nif ?? null },
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
  });

  const link = `${await origemPublica()}/onboarding/${token}`;
  let emailEnviado = false;
  /** O motivo, quando não saiu. Vai para a janela — ver a nota em baixo. */
  let erroEmail: string | undefined;

  if (emailCliente) {
    // Nada daqui para baixo pode fazer a criação falhar: o processo já existe e
    // o link já foi gerado, e perdê-lo por causa de um email é trocar o que
    // importa pelo acessório. O `try` cobre o envio *e* a auditoria — um erro a
    // escrever o evento propagava-se na mesma e deixava quem criou o processo
    // sem o link, com o processo criado do outro lado.
    try {
      const r = await enviarEmail({
        para: emailCliente,
        assunto: ASSUNTO_REGISTO,
        html: emailRegisto({ nome, link }),
        template: "registo",
        organizacaoId: org.id,
        processoId: processo.id,
        // O mesmo hash que ficou em `processo_onboarding.token_acesso_hash`: é o
        // que permite dizer "foi este link que saiu nesta mensagem" sem guardar
        // o token em claro em mais um sítio (D4).
        tokenHash: processo.tokenAcessoHash,
      });
      emailEnviado = r.ok;
      if (!r.ok) erroEmail = r.erro;

      // O envio fica em auditoria mesmo quando falha: um link de acesso a um
      // processo que sai por email é um acontecimento, e saber que não saiu é
      // tão relevante como saber que saiu.
      await registarEvento({
        organizacaoId: org.id,
        processoId: processo.id,
        acao: r.ok ? "link.enviado" : "link.envio_falhou",
        entidade: "processo_onboarding",
        entidadeId: processo.id,
        valorNovo: { para: emailCliente, ...(r.ok ? {} : { erro: r.erro }) },
        ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: h.get("user-agent") ?? null,
      });
    } catch (erro) {
      emailEnviado = false;
      erroEmail = erro instanceof Error ? erro.message : String(erro);
      console.error(`[processo] ${referencia}: o email de registo rebentou`, erro);
    }
  } else {
    // O ramo que faltava, e é o que fecha a investigação de 09/08.
    //
    // Um processo criado sem endereço não deixava rasto nenhum: nem em
    // `email_log`, que só regista tentativas de envio e não pode registar um
    // envio que ninguém pediu, nem em `evento_auditoria`. O `/emails` a dizer
    // «0 mensagens» significava ao mesmo tempo "não havia endereço" e "havia
    // endereço e o envio evaporou-se" — as duas hipóteses que sobraram depois
    // de o `scripts/testar_email.mjs` provar que o Resend e a gravação do
    // diário funcionam a partir do contentor. Com este evento, a primeira
    // hipótese passa a ter prova positiva no dossier em vez de silêncio.
    console.warn(
      `[processo] ${referencia}: criado sem endereço de email — o email de registo não foi tentado.`,
    );
    // Com `try`, pela mesma razão do ramo de cima: o processo já existe e o
    // link em claro só existe nesta chamada. Perdê-lo porque a escrita de um
    // evento de diagnóstico falhou seria o remédio a fazer o mal da doença.
    try {
      await registarEvento({
        organizacaoId: org.id,
        processoId: processo.id,
        acao: "link.sem_email",
        entidade: "processo_onboarding",
        entidadeId: processo.id,
        valorNovo: { referencia },
        ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: h.get("user-agent") ?? null,
      });
    } catch (erro) {
      console.error(`[processo] ${referencia}: o evento link.sem_email não ficou gravado`, erro);
    }
  }

  revalidatePath("/");
  return {
    ok: true as const,
    referencia,
    token,
    processoId: processo.id,
    emailEnviado,
    /**
     * O endereço que o **servidor** recebeu, e não o que a janela julga ter
     * mandado. É a única forma de a janela distinguir "escrevi um endereço e o
     * envio falhou" de "escrevi um endereço e ele não chegou cá" — que se leem
     * as duas como um email que não sai, e não se resolvem no mesmo sítio.
     */
    paraServidor: emailCliente ?? null,
    // O motivo viaja até à janela de propósito. "Não foi possível enviar o
    // email" sozinho manda quem o lê procurar nos logs do contentor, e a
    // diferença entre um domínio por verificar no Resend, uma chave em falta e
    // uma saída para a Internet fechada resolve-se em segundos quando está
    // escrita no ecrã e em minutos ou horas quando não está.
    erroEmail,
  };
}
