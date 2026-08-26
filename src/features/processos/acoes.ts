"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contadorReferencia, organizacao } from "@/db/schema/organizacao";
import { processoOnboarding } from "@/db/schema/processo";
import { dadosFaturacao, dadosIdentificacao } from "@/db/schema/seccoes";
import { registarEvento } from "@/features/auditoria/registar";
import { acessoPorToken } from "@/features/onboarding/dados";
import { enviarEmail } from "@/lib/email";
import { enviarBoasVindas } from "@/lib/emails/boas-vindas";
import {
  ASSUNTO_REGISTO,
  ASSUNTO_REJEICAO,
  emailRegisto,
  emailRejeicao,
} from "@/lib/emails/jmassano";
import { origemPublica } from "@/lib/origem";
import { exigirEquipaDaSociedade, podeAprovarProcesso } from "@/lib/sessao";
import { expiraDaquiA, novoTokenAcesso } from "@/lib/token";
import { novoProcesso, type NovoProcesso } from "./schemas";

/** Mesma forma em todas as saídas por erro — o `campo` fica sempre no tipo. */
const falha = (erro: string, campo?: string) => ({ ok: false as const, erro, campo });

/** O nome da restrição que um 23505 violou, venha ele em que campo vier. */
function restricaoViolada(erro: unknown): string {
  const e = erro as { constraint_name?: string; constraint?: string; message?: string };
  return e.constraint_name ?? e.constraint ?? e.message ?? "";
}

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
 *
 * **Exige sessão** (D59). Era uma Server Action pública: um `POST` direto ao
 * identificador da ação criava processos e fazia sair o email "JMASSANO |
 * Registro" para qualquer endereço, em nome da sociedade e à custa da quota do
 * fornecedor. A organização deixa de ser "a primeira que a base de dados
 * devolver" e passa a ser a de quem está autenticado — que é a mesma regra que
 * o `processoParaDecisao` e o download de documentos já aplicavam.
 *
 * **A partir do `INSERT` do processo esta função não rejeita** (D46). Cada passo
 * a seguir — cabeçalhos, auditoria, endereço público, envio, revalidação —
 * corre dentro do seu próprio `try`, e nenhum pode impedir o seguinte. Não é
 * zelo: o token em claro só existe nesta chamada, e o envio está atrás de um
 * `if` a que se chegava por três `await` sem rede por baixo. Qualquer um deles
 * a lançar dava um processo gravado, um `/emails` a zero e uma janela a dizer
 * "o servidor não respondeu" — uma avaria de auditoria com a cara de uma avaria
 * de email, e sem rasto nenhum a desfazer a confusão.
 */
export async function criarProcesso(entrada: NovoProcesso) {
  /*
   * A primeira linha do rasto, e é a **primeira instrução da ação** de
   * propósito: diz o que a Server Action recebeu de facto, antes de qualquer
   * coisa poder recusá-lo. Estava depois do `safeParse`, e por isso uma carga
   * rejeitada pelo schema não deixava linha nenhuma no servidor — que é
   * precisamente o caso em que se precisa de saber o que chegou cá.
   *
   * Regista a **forma** e não só os valores. Se algum dia aparecer aqui
   * `string:particular` em vez de `{tipoCliente,nome,email}`, a resposta está
   * dada sem mais investigação: o separador aberto no browser está a chamar
   * esta ação com a assinatura antiga, de três argumentos posicionais
   * (`criarProcesso(tipo, email, nome)`), contra um servidor que já espera um
   * objeto — e o email cai no chão entre os dois sem deixar rasto em `email_log`,
   * porque o `enviarEmail` nunca chega a ser chamado. Recarregar a página é a
   * cura; saber que é isso é o que custava horas.
   */
  const bruto: unknown = entrada;
  const forma =
    typeof bruto === "object" && bruto !== null
      ? `{${Object.keys(bruto).join(",")}}`
      : `${typeof bruto}:${String(bruto)}`;
  console.info(`[processo] pedido de criação recebido — carga=${forma}`);

  /*
   * Sessão primeiro, antes de qualquer trabalho e antes de qualquer email.
   *
   * Uma Server Action é um endpoint HTTP como outro qualquer — a mesma nota que
   * o `guardarPasso` do onboarding traz há muito, e que aqui faltava. Sem esta
   * linha, quem descobrisse o identificador da ação (que vai no HTML de
   * qualquer página do back-office, e chega a viajar em separadores abertos)
   * tinha um botão para abrir processos e disparar o email de registo para
   * endereços à escolha, com o remetente e o domínio da sociedade à frente.
   *
   * `exigirSessao` redireciona para `/entrar` quando não há sessão — o mesmo
   * comportamento do `processoParaDecisao` e das páginas do back-office. Numa
   * chamada sem sessão a ação não devolve resultado nenhum, que é exatamente o
   * que se pretende.
   */
  const { eu } = await exigirEquipaDaSociedade();

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

  console.info(
    `[processo] carga aceite pelo schema tipo=${tipoCliente} email=${emailCliente ?? "(nenhum)"}`,
  );

  const base = db();

  /*
   * A organização é a de quem está autenticado, e não a primeira da tabela.
   *
   * O `limit(1)` sem `where` funcionava enquanto houvesse uma organização só —
   * e é assim na POC —, mas escreve a regra errada: no dia em que houver duas,
   * um utilizador da segunda abria processos com a referência, o contador e a
   * cadeia de auditoria da primeira, sem erro nenhum a assinalá-lo.
   */
  const [org] = await base
    .select()
    .from(organizacao)
    .where(eq(organizacao.id, eu.organizacaoId))
    .limit(1);
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

  /*
   * O token e o seu hash saem do mesmo sítio e da mesma chamada.
   *
   * Estavam em duas linhas — `gerarToken()` aqui, `hashToken(token)` lá em
   * baixo, dentro do `values` — e enquanto ninguém lhes tocasse davam sempre o
   * mesmo par. O que se guarda contra é o dia em que deixem de dar: um token
   * gravado com o hash de outra coisa é um processo real, visível em
   * `/processos`, com um link que a consulta por hash nunca encontra. O cliente
   * carrega no botão do email e leva com um ecrã de "não existe" — e não há
   * nada, do lado dele, que possa estar errado.
   */
  const { token, hash } = novoTokenAcesso();
  const expiraEm = expiraDaquiA(30);

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
          tokenAcessoHash: hash,
          expiraEm,
        })
        .returning();
      break;
    } catch (erro) {
      if ((erro as { code?: string }).code !== "23505") throw erro;

      /*
       * Duas restrições únicas nesta tabela, e a diferença entre elas é a
       * diferença entre repetir e não poder repetir.
       *
       * `processo_referencia_org` é a colisão que se espera — dois pedidos ao
       * mesmo tempo a apanharem o mesmo número — e a resposta é tirar outro
       * número e tentar de novo, que é o que já estava.
       *
       * `processo_token` é outra coisa: significa que **já existe uma linha
       * gravada com este token**, quase sempre porque o INSERT anterior chegou
       * a ser confirmado pelo Postgres e a resposta perdeu-se a caminho.
       * Repetir com o mesmo token nunca pode funcionar, e o que estava aqui
       * repetia-o mais quatro vezes e desistia com "tente novamente" — deixando
       * atrás um processo real, a que ninguém volta a chegar, porque o único
       * token que o abre estava nesta chamada e ia ser deitado fora com ela.
       * Recupera-se a linha pelo mesmo caminho que o cliente vai usar.
       */
      if (restricaoViolada(erro).includes("processo_token")) {
        const recuperado = await acessoPorToken(token);
        if (recuperado.estado === "ok") {
          console.warn(
            `[processo] o INSERT colidiu no token; recuperada a linha ${recuperado.processo.referencia}`,
          );
          processo = recuperado.processo;
          referencia = recuperado.processo.referencia;
          break;
        }
        return falha("Não foi possível criar o processo. Tente novamente.");
      }

      if (tentativa >= 5) {
        return falha("Não foi possível criar o processo. Tente novamente.");
      }
    }
  }

  if (!processo) {
    return falha("Não foi possível criar o processo. Tente novamente.");
  }

  /**
   * A mesma linha, numa constante.
   *
   * O `processo` é um `let` — tem de ser, o ciclo atribui-lhe —, e o
   * TypeScript não leva a garantia de "já não é `undefined`" para dentro de uma
   * função criada a seguir. O `auditar` aqui em baixo é uma dessas funções.
   */
  const dossier = processo;

  /*
   * ------------------------------------------------------------------------
   * Daqui para baixo o processo **já está gravado**, e nada pode rebentar.
   *
   * É este o defeito que sobreviveu às três passagens anteriores. O envio do
   * email está atrás de um `if`, e chegar a esse `if` dependia de três `await`
   * sem rede por baixo — `headers()`, o `registarEvento` do `processo.criado`
   * e o `origemPublica()`. Qualquer um deles a lançar produzia exatamente o
   * ecrã que foi relatado, e produzia-o **sem uma única pista**:
   *
   *   · o processo aparece em `/processos`, porque o INSERT já tinha sido
   *     confirmado;
   *   · o `/emails` fica a «0 mensagens», porque o `enviarEmail` — que é quem
   *     escreve em `email_log` (D34) — nunca chegou a ser chamado;
   *   · não há `link.enviado`, nem `link.envio_falhou`, nem `link.sem_email`;
   *   · e a janela, que só vê uma promessa rejeitada, diz "o servidor não
   *     respondeu" — uma frase que se lê como falha de rede e não como
   *     "o teu email nunca vai sair".
   *
   * Ou seja: um erro em código que **não tem nada a ver com email** apresenta-se
   * como um email que não sai, e apaga-se a si próprio pelo caminho. Foi por
   * isso que a leitura do caminho do envio nunca fechou o caso — o caminho do
   * envio estava certo; o que estava errado era o que havia antes dele.
   *
   * A regra passa a ser uma só: **cada peça daqui para baixo corre dentro do
   * seu próprio `try`**, e nenhuma pode impedir a seguinte. A auditoria fica
   * onde estava — a ordem dos eventos no dossier não muda —, mas deixa de ser
   * um passo por onde a ação possa morrer.
   * ------------------------------------------------------------------------
   */

  /*
   * O link é experimentado **antes** de ser entregue a alguém.
   *
   * Toda a gente confia neste caminho porque ele é curto: gera-se o token,
   * grava-se o hash, devolve-se o token. Só que entre as duas pontas está o
   * Postgres, e o que sai de lá pode não ser o que se pensa que entrou — uma
   * coluna que o schema mudou, um trigger, um `apagado_em` com valor por
   * omissão, um `expira_em` que o relógio do contentor põe no passado. Em
   * qualquer desses casos o processo fica gravado, a janela mostra um link com
   * ar perfeitamente normal, e o 404 só aparece do lado do cliente — dias
   * depois, e sem ninguém saber ligá-lo ao momento em que o processo nasceu.
   *
   * Uma consulta, pela mesma função que serve a página do cliente. Se a linha
   * não responder a este token, repõe-se o hash e a validade uma vez; e se nem
   * assim, quem criou o processo fica a saber **no ecrã** que o link não abre,
   * em vez de o enviar ao cliente e descobrir pela reclamação.
   *
   * Dentro de `try`, como tudo o resto daqui para baixo: uma verificação que
   * rebentasse repunha, sozinha, o defeito que esta função inteira existe para
   * não ter — a consulta a matar o email do cliente por não ter que ver com ele.
   */
  const linkAbre = async () => {
    try {
      return (await acessoPorToken(token)).estado === "ok";
    } catch (erro) {
      console.error(`[processo] ${referencia}: não foi possível verificar o link`, erro);
      return false;
    }
  };

  let linkVerificado = await linkAbre();

  if (!linkVerificado) {
    console.error(
      `[processo] ${referencia}: o token gravado não abre o processo — a repor o hash`,
    );
    try {
      await base
        .update(processoOnboarding)
        .set({ tokenAcessoHash: hash, expiraEm, apagadoEm: null })
        .where(eq(processoOnboarding.id, dossier.id));
      linkVerificado = await linkAbre();
    } catch (erro) {
      console.error(`[processo] ${referencia}: a reposição do token falhou`, erro);
    }
  }

  /** Cabeçalhos do pedido, para a auditoria. Falhar aqui não custa um email. */
  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    userAgent = h.get("user-agent") ?? null;
  } catch (erro) {
    console.error(`[processo] ${referencia}: não foi possível ler os cabeçalhos`, erro);
  }

  /**
   * Um evento de auditoria que nunca propaga.
   *
   * A cadeia de hashes continua a ser escrita pelo mesmo `registarEvento`, com
   * as mesmas garantias; o que muda é que a **falha** a escrevê-la deixa de
   * poder interromper o resto da ação. Um registo que se perde é mau; um
   * registo que se perde *e* leva com ele o email do cliente e o link do
   * dossier é a avaria que se esteve três sessões a perseguir.
   */
  const auditar = async (acao: string, valorNovo: Record<string, unknown>) => {
    try {
      await registarEvento({
        organizacaoId: org.id,
        processoId: dossier.id,
        // Agora há autor: o processo nasce de alguém com sessão iniciada, e é
        // essa a pergunta que o dossier passa a responder por escrito.
        atorId: eu.id,
        acao,
        entidade: "processo_onboarding",
        entidadeId: dossier.id,
        valorNovo,
        ip,
        userAgent,
      });
    } catch (erro) {
      console.error(`[processo] ${referencia}: o evento ${acao} não ficou gravado`, erro);
    }
  };

  // Os dados de abertura entram no evento: é a prova de com que identificação o
  // dossier nasceu, antes de o cliente ter tocado nele.
  await auditar("processo.criado", {
    referencia,
    tipoCliente,
    nome: nome ?? null,
    nif: nif ?? null,
  });

  // Um link que não resolveu à primeira é um acontecimento do dossier, não uma
  // linha de log: é a prova escrita de que o acesso esteve em risco, e a única
  // maneira de o descobrir mais tarde sem ter a consola do contentor à mão.
  if (!linkVerificado) {
    await auditar("link.nao_resolve", { referencia });
  }

  /*
   * O link, uma vez só, para os dois destinos.
   *
   * Estava dentro do `if (emailCliente)`, e por isso a janela não recebia link
   * nenhum: montava-o à parte, com o `window.location.origin` do browser de
   * quem estava a criar o processo. Os dois coincidem quase sempre e é por isso
   * que a diferença passa despercebida — até alguém abrir o back-office por um
   * túnel, por `localhost`, por um IP ou por um segundo domínio que aponte para
   * a mesma instalação. Aí o link copiado da janela leva o anfitrião do
   * back-office e o link do email leva o do pedido: o cliente recebe um
   * endereço que não existe para ele, e o que vê é um 404. Um só sítio a
   * montá-lo é um só endereço possível.
   */
  let link = `/onboarding/${token}`;
  try {
    link = `${await origemPublica()}/onboarding/${token}`;
  } catch (erro) {
    // Um link com o anfitrião em falta ainda se corrige a olho; um email que
    // não sai por causa disso não se corrige de todo. A janela completa-o com
    // a própria origem, que é o que ela sabe de melhor.
    console.error(`[processo] ${referencia}: origemPublica falhou; link relativo`, erro);
  }

  let emailEnviado = false;
  /** O motivo, quando não saiu. Vai para a janela — ver a nota em baixo. */
  let erroEmail: string | undefined;

  if (emailCliente) {
    // O `enviarEmail` já promete não propagar (D42) e o `auditar` também. Este
    // `try` é o terceiro fecho, para o dia em que um deles deixe de o cumprir:
    // o token em claro só existe nesta chamada, e uma exceção aqui não pode
    // custar o link de um dossier que já está gravado.
    try {
      const r = await enviarEmail({
        para: emailCliente,
        assunto: ASSUNTO_REGISTO,
        html: emailRegisto({ nome, link }),
        template: "registo",
        organizacaoId: org.id,
        processoId: dossier.id,
        // O mesmo hash que ficou em `processo_onboarding.token_acesso_hash`: é o
        // que permite dizer "foi este link que saiu nesta mensagem" sem guardar
        // o token em claro em mais um sítio (D4). Vem da constante e não da
        // linha devolvida pelo INSERT — é o hash **deste** token, o mesmo que a
        // verificação em cima experimentou, e não o que a base de dados diz ter
        // gravado. Divergindo os dois, o diário do canal apontaria para um link
        // que não é o que saiu na mensagem.
        tokenHash: hash,
      });
      emailEnviado = r.ok;
      if (!r.ok) erroEmail = r.erro;

      // O envio fica em auditoria mesmo quando falha: um link de acesso a um
      // processo que sai por email é um acontecimento, e saber que não saiu é
      // tão relevante como saber que saiu.
      await auditar(r.ok ? "link.enviado" : "link.envio_falhou", {
        para: emailCliente,
        ...(r.ok ? {} : { erro: r.erro }),
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
    await auditar("link.sem_email", { referencia });
  }

  // Também com rede: uma revalidação de cache que rebente não pode ser a razão
  // de o token em claro — que só existe nesta chamada — nunca chegar à janela.
  try {
    revalidatePath("/");
  } catch (erro) {
    console.error(`[processo] ${referencia}: revalidatePath falhou`, erro);
  }

  return {
    ok: true as const,
    referencia,
    token,
    /**
     * O link tal e qual como ele vai no email. A janela mostra este, e não um
     * que monte por sua conta — o que se copia do ecrã e o que o cliente recebe
     * têm de ser o mesmo texto, senão há dois links a existir e só um funciona.
     * Relativo (`/onboarding/…`) quando o anfitrião não se conseguiu apurar; a
     * janela completa-o com a origem dela.
     */
    link,
    /**
     * Se o link chegou a ser experimentado com sucesso contra a base de dados.
     * A falso, o processo existe e o link **não abre** — quem o está a criar
     * precisa de o saber antes de o enviar, não depois da reclamação.
     */
    linkVerificado,
    processoId: dossier.id,
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

/* ------------------------------------------------------------- aprovação */

type ResultadoDecisao = { ok: true } | { ok: false; erro: string };

/**
 * O email do cliente, para as duas decisões — o mesmo par de tabelas e a
 * mesma prioridade que `notificarSubmissao` usa em `features/onboarding/acoes.ts`:
 * a identificação, e a faturação como recurso quando o passo 1 não chegou a
 * ser gravado.
 */
async function emailDoCliente(processoId: string) {
  const base = db();
  const [identificacao] = await base
    .select({ email: dadosIdentificacao.email, nome: dadosIdentificacao.nome })
    .from(dadosIdentificacao)
    .where(eq(dadosIdentificacao.processoId, processoId))
    .limit(1);
  const [faturacao] = await base
    .select({ email: dadosFaturacao.email })
    .from(dadosFaturacao)
    .where(eq(dadosFaturacao.processoId, processoId))
    .limit(1);
  return {
    email: identificacao?.email ?? faturacao?.email ?? null,
    nome: identificacao?.nome ?? null,
  };
}

/**
 * Sessão, permissão e estado — as três guardas comuns a aprovar e a rejeitar.
 *
 * A mesma regra do detalhe do processo (`processoPorId` + a comparação de
 * organização): um processo de outra organização responde como se não
 * existisse, e não com um erro que revele que existe algures noutra conta.
 */
async function processoParaDecisao(
  id: string,
): Promise<
  | { ok: true; processo: typeof processoOnboarding.$inferSelect; atorId: string }
  | { ok: false; erro: string }
> {
  const { eu } = await exigirEquipaDaSociedade();
  if (!podeAprovarProcesso(eu.papel)) {
    return { ok: false, erro: "Não tem permissão para decidir este processo." };
  }

  const [processo] = await db()
    .select()
    .from(processoOnboarding)
    .where(eq(processoOnboarding.id, id))
    .limit(1);

  if (!processo || processo.organizacaoId !== eu.organizacaoId) {
    return { ok: false, erro: "Processo não encontrado." };
  }
  if (processo.estado !== "aguardar_aprovacao") {
    return { ok: false, erro: "Este processo não está à espera de aprovação." };
  }

  return { ok: true, processo, atorId: eu.id };
}

/**
 * Aprova um processo: muda o estado, grava quem e quando, e envia as
 * boas-vindas ao cliente com os três anexos (`enviarBoasVindas`, partilhada
 * com a submissão — que já não a envia, ver D46 e a atualização do fluxo de
 * aprovação).
 *
 * O email é o último passo e corre dentro do seu próprio `try`, pelo mesmo
 * motivo do `criarProcesso`: a decisão já está gravada e um Resend em baixo
 * não pode transformar uma aprovação bem-sucedida num ecrã de erro.
 */
export async function aprovarProcesso(id: string): Promise<ResultadoDecisao> {
  const verificacao = await processoParaDecisao(id);
  if (!verificacao.ok) return verificacao;
  const { processo, atorId } = verificacao;

  const [atualizado] = await db()
    .update(processoOnboarding)
    .set({ estado: "aprovado", aprovadoEm: new Date(), aprovadoPor: atorId })
    .where(eq(processoOnboarding.id, id))
    .returning();

  await registarEvento({
    organizacaoId: processo.organizacaoId,
    processoId: processo.id,
    atorId,
    acao: "processo.aprovado",
    entidade: "processo_onboarding",
    entidadeId: processo.id,
    valorAnterior: { estado: processo.estado },
    valorNovo: { estado: "aprovado" },
  });

  try {
    const { email, nome } = await emailDoCliente(id);
    if (email) {
      await enviarBoasVindas(atualizado ?? processo, email, nome);
    } else {
      console.warn(
        `[processo] ${processo.referencia}: aprovado sem endereço de email — boas-vindas não enviadas.`,
      );
    }
  } catch (e) {
    console.error(`[processo] ${processo.referencia}: as boas-vindas não foram enviadas`, e);
  }

  revalidatePath("/processos");
  revalidatePath(`/processos/${id}`);
  revalidatePath("/");

  return { ok: true };
}

/**
 * Rejeita um processo: muda o estado, grava o motivo, e avisa o cliente por
 * email. O motivo é obrigatório — uma rejeição sem motivo é uma decisão que
 * ninguém, do lado do cliente, consegue perceber nem contestar.
 */
export async function rejeitarProcesso(id: string, motivoBruto: string): Promise<ResultadoDecisao> {
  const motivo = motivoBruto.trim();
  if (!motivo) {
    return { ok: false, erro: "Indique o motivo da rejeição." };
  }

  const verificacao = await processoParaDecisao(id);
  if (!verificacao.ok) return verificacao;
  const { processo, atorId } = verificacao;

  await db()
    .update(processoOnboarding)
    .set({ estado: "rejeitado", motivoRejeicao: motivo })
    .where(eq(processoOnboarding.id, id));

  await registarEvento({
    organizacaoId: processo.organizacaoId,
    processoId: processo.id,
    atorId,
    acao: "processo.rejeitado",
    entidade: "processo_onboarding",
    entidadeId: processo.id,
    valorAnterior: { estado: processo.estado },
    valorNovo: { estado: "rejeitado", motivo },
  });

  try {
    const { email, nome } = await emailDoCliente(id);
    if (email) {
      await enviarEmail({
        para: email,
        assunto: ASSUNTO_REJEICAO,
        html: emailRejeicao({ nome, referencia: processo.referencia }),
        template: "rejeicao",
        organizacaoId: processo.organizacaoId,
        processoId: processo.id,
      });
    } else {
      console.warn(
        `[processo] ${processo.referencia}: rejeitado sem endereço de email — decisão não notificada.`,
      );
    }
  } catch (e) {
    console.error(`[processo] ${processo.referencia}: o email de rejeição não foi enviado`, e);
  }

  revalidatePath("/processos");
  revalidatePath(`/processos/${id}`);
  revalidatePath("/");

  return { ok: true };
}
