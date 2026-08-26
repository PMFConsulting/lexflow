"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/db";
import { organizacao, utilizador } from "@/db/schema/organizacao";
import { registarEvento } from "@/features/auditoria/registar";
import {
  exigirGestorDeUtilizadores,
  exigirSuperAdmin,
  type Papel,
} from "@/lib/sessao";
import {
  criarConta,
  enviarCredenciaisPendentes,
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

  try {
    const conta = await criarConta({
      nome: lido.data.nome,
      email: lido.data.email,
      papel: lido.data.papel,
      organizacaoId: alvo,
    });

    const { ip, userAgent } = await ambiente();

    await auditar({
      organizacaoId: alvo,
      atorId: eu.id,
      acao: "utilizador.criado",
      entidade: "utilizador",
      entidadeId: conta.utilizadorId,
      // Sem a palavra-passe, obviamente: a auditoria dura sete anos. Com o
      // desfecho do envio, que é o que responde a "esta pessoa chegou a poder
      // entrar?" no dia em que alguém perguntar.
      valorNovo: {
        email: conta.email,
        papel: conta.papel,
        credenciaisEnviadas: conta.emailEnviado,
      },
      ip,
      userAgent,
    });

    revalidatePath("/admin");
    revalidatePath(`/admin/sociedades/${alvo}`);
    revalidatePath("/utilizadores");

    return { ok: true, conta };
  } catch (e) {
    if (e instanceof ErroDeConta) return { ok: false, erros: { email: e.motivo } };
    console.error("[plataforma] falhou a criar a conta:", e);
    return { ok: false, erros: { _: "Não foi possível criar a conta. Tente de novo." } };
  }
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

    /**
     * A auditoria é por organização (D6) e esta conta não tem nenhuma. Regista-se
     * na sociedade de... nenhuma — e como `registarEvento` exige uma, o evento
     * fica **sem** cadeia própria: escolhe-se não o registar em vez de o
     * pendurar numa sociedade a que ele não pertence, o que corromperia a
     * leitura de qualquer auditoria dessa sociedade. Fica o registo no console,
     * que é onde as operações de plataforma já vivem.
     */
    console.warn(
      `[plataforma] criada conta de administrador da plataforma: ${conta.email} (por ${eu.email}, ip ${ip ?? "?"}, ${userAgent ?? "?"})`,
    );

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

  const existentes = await db()
    .select({ email: utilizador.email })
    .from(utilizador)
    .where(and(eq(utilizador.organizacaoId, alvo), isNull(utilizador.apagadoEm)));

  const leitura = prepararImportacao(
    bytes,
    existentes.map((l) => l.email),
  );

  if (!leitura.ok) return { ok: false, erro: leitura.erro };

  const { validas, recusadas } = leitura.previsao;
  if (validas.length === 0) return { ok: true, criadas: [], recusadas };

  let criadas: ContaCriada[];

  /**
   * Os envios ficam à espera de a transação fechar.
   *
   * Enviados lá de dentro, um `ROLLBACK` na vigésima linha entregava
   * palavras-passe de dezanove contas que deixaram de existir — e prendia a
   * transação durante trinta chamadas HTTP a um fornecedor de email. O desfecho
   * de cada envio é escrito nos objetos que já estão em `criadas`, que são os
   * mesmos que vão para o ecrã.
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

  // As contas estão criadas e a transação fechou: agora sim, as credenciais.
  await enviarCredenciaisPendentes(pendentes);

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
      // Quantas contas ficaram sem forma de lá entrar. Nunca a palavra-passe —
      // a auditoria dura sete anos.
      credenciaisNaoEnviadas: criadas.filter((c) => c.emailEnviado === false).length,
    },
    ip,
    userAgent,
  });

  revalidatePath("/admin");
  revalidatePath(`/admin/sociedades/${alvo}`);
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

  if (alvo.organizacaoId) {
    await auditar({
      organizacaoId: alvo.organizacaoId,
      atorId: eu.id,
      acao: ativo ? "utilizador.reativado" : "utilizador.desativado",
      entidade: "utilizador",
      entidadeId: alvo.id,
      valorAnterior: { ativo: alvo.ativo },
      valorNovo: { ativo },
      ip,
      userAgent,
    });
  }

  revalidatePath("/admin");
  if (alvo.organizacaoId) revalidatePath(`/admin/sociedades/${alvo.organizacaoId}`);
  revalidatePath("/admin/utilizadores");
  revalidatePath("/utilizadores");

  return { ok: true };
}
