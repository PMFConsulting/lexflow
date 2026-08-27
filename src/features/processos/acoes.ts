"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { contadorReferencia, organizacao } from "@/db/schema/organizacao";
import { processoOnboarding } from "@/db/schema/processo";
import {
  areaInteresse,
  dadosFaturacao,
  dadosFiscais,
  dadosIdentificacao,
  declaracaoPpe,
  emailNewsletter,
  fechoProposta,
  nacionalidade,
  preferenciasContacto,
  relacaoNegocio,
  representanteLegal,
} from "@/db/schema/seccoes";
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
import { urlLogotipoSociedade } from "@/lib/emails/moldura";
import { resolverEmailCliente } from "@/lib/emails/obter-modelo";
import { origemPublica } from "@/lib/origem";
import {
  exigirEquipaOuSuperAdmin,
  podeAcederSociedade,
  podeAprovarProcesso,
  podeReabrirProcesso,
} from "@/lib/sessao";
import { expiraDaquiA, novoTokenAcesso } from "@/lib/token";
import {
  novoProcesso,
  reaberturaProcessoSchema,
  type NovoProcesso,
} from "./schemas";

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
export async function criarProcesso(entrada: NovoProcesso & { organizacaoId?: string }) {
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
  const { eu } = await exigirEquipaOuSuperAdmin();

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
   * A organização é a de quem está autenticado (para equipa da sociedade)
   * ou a indicada na entrada (para o super_admin transversal).
   */
  const orgId =
    eu.papel === "super_admin"
      ? (entrada.organizacaoId ?? eu.organizacaoId)
      : eu.organizacaoId;

  if (!orgId) {
    return falha("Escolha a sociedade onde criar o processo.", "organizacaoId");
  }

  const [org] = await base
    .select()
    .from(organizacao)
    .where(eq(organizacao.id, orgId))
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
        html: emailRegisto({ nome, link, logotipoUrl: urlLogotipoSociedade(org) }),
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
 * O `super_admin` tem acesso transversal a todas as organizações.
 */
async function processoParaDecisao(
  id: string,
): Promise<
  | { ok: true; processo: typeof processoOnboarding.$inferSelect; atorId: string }
  | { ok: false; erro: string }
> {
  const { eu } = await exigirEquipaOuSuperAdmin();
  if (!podeAprovarProcesso(eu.papel)) {
    return { ok: false, erro: "Não tem permissão para decidir este processo." };
  }

  const [processo] = await db()
    .select()
    .from(processoOnboarding)
    .where(eq(processoOnboarding.id, id))
    .limit(1);

  if (!processo || !podeAcederSociedade(eu, processo.organizacaoId)) {
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
  revalidatePath(`/admin/sociedades/${processo.organizacaoId}/processos/${id}`);
  revalidatePath(`/admin/sociedades/${processo.organizacaoId}`);
  revalidatePath("/admin");
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
      const [org] = await db()
        .select({
          id: organizacao.id,
          nome: organizacao.nome,
          logotipoDados: organizacao.logotipoDados,
          logotipoAtualizadoEm: organizacao.logotipoAtualizadoEm,
        })
        .from(organizacao)
        .where(eq(organizacao.id, processo.organizacaoId))
        .limit(1);

      const emailResolvido = await resolverEmailCliente({
        organizacaoId: processo.organizacaoId,
        template: "rejeicao",
        variaveis: {
          nome_cliente: nome,
          referencia: processo.referencia,
          nome_sociedade: org?.nome,
          motivo,
        },
        logotipoUrl: urlLogotipoSociedade(org),
      });

      await enviarEmail({
        para: email,
        assunto: emailResolvido.assunto,
        html: emailResolvido.html,
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
  revalidatePath(`/admin/sociedades/${processo.organizacaoId}/processos/${id}`);
  revalidatePath(`/admin/sociedades/${processo.organizacaoId}`);
  revalidatePath("/admin");
  revalidatePath("/");

  return { ok: true };
}

/**
 * Reabre um processo (Frente M): muda o estado, renova o acesso do cliente,
 * grava o motivo na auditoria e notifica o cliente por email com o modelo de reabertura.
 *
 * Apenas permitido para processos nos estados `aprovado`, `arquivado` ou `rejeitado`.
 *
 * Transições de estado:
 * - `aprovado` -> `em_revisao`
 * - `arquivado` -> `em_revisao`
 * - `rejeitado` -> `pendente_cliente`
 */
export async function reabrirProcesso(
  id: string,
  motivoBruto: string,
): Promise<ResultadoDecisao> {
  const analise = reaberturaProcessoSchema.safeParse({
    processoId: id,
    motivo: motivoBruto,
  });

  if (!analise.success) {
    const problema = analise.error.issues[0];
    return falha(problema?.message ?? "Indique o motivo da reabertura.");
  }

  const { motivo } = analise.data;

  const { eu } = await exigirEquipaOuSuperAdmin();
  if (!podeReabrirProcesso(eu.papel)) {
    return falha("Não tem permissão para reabrir este processo.");
  }

  const [processo] = await db()
    .select()
    .from(processoOnboarding)
    .where(eq(processoOnboarding.id, id))
    .limit(1);

  if (!processo || !podeAcederSociedade(eu, processo.organizacaoId)) {
    return falha("Processo não encontrado.");
  }

  const ESTADOS_REABERTURA: Record<string, "em_revisao" | "pendente_cliente"> = {
    aprovado: "em_revisao",
    arquivado: "em_revisao",
    rejeitado: "pendente_cliente",
  };

  const novoEstado = ESTADOS_REABERTURA[processo.estado];
  if (!novoEstado) {
    return falha("Apenas processos aprovados, arquivados ou rejeitados podem ser reabertos.");
  }

  const { token, hash } = novoTokenAcesso();
  const expiraEm = expiraDaquiA(30);

  await db()
    .update(processoOnboarding)
    .set({
      estado: novoEstado,
      tokenAcessoHash: hash,
      expiraEm,
      apagadoEm: null,
      atualizadoEm: new Date(),
    })
    .where(eq(processoOnboarding.id, id));

  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    userAgent = h.get("user-agent") ?? null;
  } catch {
    // Headers outside request context
  }

  try {
    await registarEvento({
      organizacaoId: processo.organizacaoId,
      processoId: processo.id,
      atorId: eu.id,
      acao: "reabertura",
      entidade: "processo_onboarding",
      entidadeId: processo.id,
      valorAnterior: { estado: processo.estado },
      valorNovo: { estado: novoEstado, motivo },
      ip,
      userAgent,
    });
  } catch (e) {
    console.error(`[processo] ${processo.referencia}: falhou auditoria de reabertura`, e);
  }

  try {
    let linkProcesso = `/onboarding/${token}`;
    try {
      linkProcesso = `${await origemPublica()}/onboarding/${token}`;
    } catch (erro) {
      console.error(`[processo] ${processo.referencia}: origemPublica falhou; link relativo`, erro);
    }

    const { email, nome } = await emailDoCliente(id);
    if (email) {
      const [org] = await db()
        .select({
          id: organizacao.id,
          nome: organizacao.nome,
          logotipoDados: organizacao.logotipoDados,
          logotipoAtualizadoEm: organizacao.logotipoAtualizadoEm,
        })
        .from(organizacao)
        .where(eq(organizacao.id, processo.organizacaoId))
        .limit(1);

      const emailResolvido = await resolverEmailCliente({
        organizacaoId: processo.organizacaoId,
        template: "reabertura",
        variaveis: {
          nome_cliente: nome,
          referencia: processo.referencia,
          nome_sociedade: org?.nome,
          motivo,
          link_processo: linkProcesso,
        },
        logotipoUrl: urlLogotipoSociedade(org),
      });

      await enviarEmail({
        para: email,
        assunto: emailResolvido.assunto,
        html: emailResolvido.html,
        template: "reabertura",
        organizacaoId: processo.organizacaoId,
        processoId: processo.id,
        tokenHash: hash,
      });
    } else {
      console.warn(
        `[processo] ${processo.referencia}: reaberto sem endereço de email — notificação não enviada.`,
      );
    }
  } catch (e) {
    console.error(`[processo] ${processo.referencia}: o email de reabertura não foi enviado`, e);
  }

  try {
    revalidatePath("/processos");
    revalidatePath(`/processos/${id}`);
    revalidatePath(`/admin/sociedades/${processo.organizacaoId}/processos/${id}`);
    revalidatePath(`/admin/sociedades/${processo.organizacaoId}`);
    revalidatePath("/admin");
    revalidatePath("/");
  } catch {
    // revalidatePath outside request context
  }

  return { ok: true };
}

/* ------------------------------------------------------------- edição de dados */

export type ResultadoEdicao =
  | { ok: true }
  | { ok: false; erro: string };

/**
 * Atualiza os dados de uma secção de um processo (passos 1 a 7).
 *
 * Permite ao `super_admin` e à equipa da sociedade editar/corrigir/preencher
 * qualquer campo de dados de um processo. Toda a alteração é registada na auditoria.
 */
export async function atualizarSeccaoProcesso(
  processoId: string,
  passo: number,
  dados: Record<string, unknown>,
): Promise<ResultadoEdicao> {
  const { eu } = await exigirEquipaOuSuperAdmin();

  const base = db();
  const [processo] = await base
    .select()
    .from(processoOnboarding)
    .where(and(eq(processoOnboarding.id, processoId), isNull(processoOnboarding.apagadoEm)))
    .limit(1);

  if (!processo || !podeAcederSociedade(eu, processo.organizacaoId)) {
    return { ok: false, erro: "Processo não encontrado." };
  }

  if (processo.estado === "aprovado" || processo.estado === "arquivado") {
    return { ok: false, erro: "Processo aprovado — já não é editável." };
  }

  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    userAgent = h.get("user-agent") ?? null;
  } catch {
    // Headers might fail outside request context
  }

  const insere = <T>(extra: Record<string, unknown>) => ({ processoId: processo.id, ...extra }) as T;

  switch (passo) {
    case 1: {
      const {
        nome,
        profissao,
        entidadePatronal,
        dataNascimento,
        naturezaJuridica,
        dataConstituicao,
        telefone,
        email,
        morada,
        codigoPostal,
        localidade,
        freguesia,
        concelho,
        distrito,
        pais,
        nacionalidades,
      } = dados as {
        nome?: string;
        profissao?: string;
        entidadePatronal?: string;
        dataNascimento?: string;
        naturezaJuridica?: string;
        dataConstituicao?: string;
        telefone?: string;
        email?: string;
        morada?: string;
        codigoPostal?: string;
        localidade?: string;
        freguesia?: string;
        concelho?: string;
        distrito?: string;
        pais?: string;
        nacionalidades?: string[];
      };

      if (!nome?.trim()) {
        return { ok: false, erro: "O nome é obrigatório." };
      }

      const valoresIdentificacao = {
        nome: nome.trim(),
        profissao: profissao?.trim() || null,
        entidadePatronal: entidadePatronal?.trim() || null,
        dataNascimento: dataNascimento?.trim() || null,
        naturezaJuridica: naturezaJuridica?.trim() || null,
        dataConstituicao: dataConstituicao?.trim() || null,
        telefone: telefone?.trim() || "",
        email: email?.trim().toLowerCase() || "",
        morada: morada?.trim() || "",
        codigoPostal: codigoPostal?.trim() || "",
        localidade: localidade?.trim() || "",
        freguesia: freguesia?.trim() || "",
        concelho: concelho?.trim() || "",
        distrito: distrito?.trim() || "",
        pais: pais?.trim() || "Portugal",
      };

      await base
        .insert(dadosIdentificacao)
        .values(insere<typeof dadosIdentificacao.$inferInsert>(valoresIdentificacao))
        .onConflictDoUpdate({
          target: dadosIdentificacao.processoId,
          set: valoresIdentificacao,
        });

      if (Array.isArray(nacionalidades)) {
        await base
          .delete(nacionalidade)
          .where(
            and(
              eq(nacionalidade.processoId, processo.id),
              eq(nacionalidade.titular, "cliente"),
            ),
          );
        if (nacionalidades.length) {
          await base.insert(nacionalidade).values(
            nacionalidades.map((p) => ({
              processoId: processo.id,
              titular: "cliente" as const,
              pais: p,
            })),
          );
        }
      }

      await base
        .update(processoOnboarding)
        .set({
          nomeCliente: nome.trim(),
          emailCliente: email?.trim().toLowerCase() || processo.emailCliente,
          atualizadoEm: new Date(),
        })
        .where(eq(processoOnboarding.id, processo.id));
      break;
    }

    case 2: {
      const {
        nif,
        nifPortugues,
        resideEmPortugal,
        docTipo,
        docNumero,
        docValidade,
        cae,
        codigoCertidaoPermanente,
        regimeIva,
      } = dados as {
        nif?: string;
        nifPortugues?: boolean;
        resideEmPortugal?: boolean;
        docTipo?: "cartao_cidadao" | "passaporte" | "titulo_residencia" | "outro";
        docNumero?: string;
        docValidade?: string;
        cae?: string;
        codigoCertidaoPermanente?: string;
        regimeIva?: "normal" | "isento_art53" | "isento_art9" | "misto";
      };

      if (!nif?.trim()) {
        return { ok: false, erro: "O NIF é obrigatório." };
      }

      const valoresFiscais = {
        nif: nif.trim(),
        nifPortugues: nifPortugues ?? true,
        resideEmPortugal: resideEmPortugal ?? true,
        docTipo: docTipo || "cartao_cidadao",
        docNumero: docNumero?.trim() || "",
        docValidade: docValidade?.trim() || new Date().toISOString().slice(0, 10),
        cae: cae?.trim() || null,
        codigoCertidaoPermanente: codigoCertidaoPermanente?.trim() || null,
        regimeIva: regimeIva === "normal" || regimeIva === "isento_art53" || regimeIva === "isento_art9" || regimeIva === "misto" ? regimeIva : null,
      };

      await base
        .insert(dadosFiscais)
        .values(insere<typeof dadosFiscais.$inferInsert>(valoresFiscais))
        .onConflictDoUpdate({
          target: dadosFiscais.processoId,
          set: valoresFiscais,
        });

      await base
        .update(processoOnboarding)
        .set({ nifCliente: nif.trim(), atualizadoEm: new Date() })
        .where(eq(processoOnboarding.id, processo.id));
      break;
    }

    case 3: {
      const {
        eRepresentante,
        relacao,
        nome,
        dataNascimento,
        profissao,
        telefone,
        email,
        morada,
        pais,
        localidade,
        codigoPostal,
        freguesia,
        concelho,
        distrito,
        nif,
        docTipo,
        docNumero,
        docValidade,
        nacionalidades,
      } = dados as {
        eRepresentante?: boolean;
        relacao?: string;
        nome?: string;
        dataNascimento?: string;
        profissao?: string;
        telefone?: string;
        email?: string;
        morada?: string;
        pais?: string;
        localidade?: string;
        codigoPostal?: string;
        freguesia?: string;
        concelho?: string;
        distrito?: string;
        nif?: string;
        docTipo?: "cartao_cidadao" | "passaporte" | "titulo_residencia" | "outro";
        docNumero?: string;
        docValidade?: string;
        nacionalidades?: string[];
      };

      const valoresRep = {
        eRepresentante: Boolean(eRepresentante),
        relacao: relacao?.trim() || null,
        nome: nome?.trim() || null,
        dataNascimento: dataNascimento?.trim() || null,
        profissao: profissao?.trim() || null,
        telefone: telefone?.trim() || null,
        email: email?.trim() || null,
        morada: morada?.trim() || null,
        pais: pais?.trim() || null,
        localidade: localidade?.trim() || null,
        codigoPostal: codigoPostal?.trim() || null,
        freguesia: freguesia?.trim() || null,
        concelho: concelho?.trim() || null,
        distrito: distrito?.trim() || null,
        nif: nif?.trim() || null,
        docTipo: docTipo || null,
        docNumero: docNumero?.trim() || null,
        docValidade: docValidade?.trim() || null,
      };

      await base
        .insert(representanteLegal)
        .values(insere<typeof representanteLegal.$inferInsert>(valoresRep))
        .onConflictDoUpdate({
          target: representanteLegal.processoId,
          set: valoresRep,
        });

      if (Array.isArray(nacionalidades)) {
        await base
          .delete(nacionalidade)
          .where(
            and(
              eq(nacionalidade.processoId, processo.id),
              eq(nacionalidade.titular, "representante"),
            ),
          );
        if (nacionalidades.length) {
          await base.insert(nacionalidade).values(
            nacionalidades.map((p) => ({
              processoId: processo.id,
              titular: "representante" as const,
              pais: p,
            })),
          );
        }
      }
      break;
    }

    case 4: {
      const {
        ePpe,
        ppeCargo,
        ppePais,
        ppeEntidade,
        ppeInicio,
        ppeFim,
        eRelacionadoPpe,
        relacaoPpe,
        ppeRelacionadaNome,
        ppeRelacionadaCargo,
        ppeRelacionadaPais,
        servicos,
        origemFundos,
      } = dados as {
        ePpe?: boolean;
        ppeCargo?: string;
        ppePais?: string;
        ppeEntidade?: string;
        ppeInicio?: string;
        ppeFim?: string;
        eRelacionadoPpe?: boolean;
        relacaoPpe?: string;
        ppeRelacionadaNome?: string;
        ppeRelacionadaCargo?: string;
        ppeRelacionadaPais?: string;
        servicos?: string;
        origemFundos?: string;
      };

      const valoresPpe = {
        ePpe: Boolean(ePpe),
        ppeCargo: ppeCargo?.trim() || null,
        ppePais: ppePais?.trim() || null,
        ppeEntidade: ppeEntidade?.trim() || null,
        ppeInicio: ppeInicio?.trim() || null,
        ppeFim: ppeFim?.trim() || null,
        eRelacionadoPpe: Boolean(eRelacionadoPpe),
        relacaoPpe: relacaoPpe?.trim() || null,
        ppeRelacionadaNome: ppeRelacionadaNome?.trim() || null,
        ppeRelacionadaCargo: ppeRelacionadaCargo?.trim() || null,
        ppeRelacionadaPais: ppeRelacionadaPais?.trim() || null,
      };

      await base
        .insert(declaracaoPpe)
        .values(insere<typeof declaracaoPpe.$inferInsert>(valoresPpe))
        .onConflictDoUpdate({
          target: declaracaoPpe.processoId,
          set: valoresPpe,
        });

      if (servicos !== undefined || origemFundos !== undefined) {
        await base
          .insert(relacaoNegocio)
          .values({
            processoId: processo.id,
            servicos: servicos?.trim() || "",
            origemFundos: origemFundos?.trim() || "",
          })
          .onConflictDoUpdate({
            target: relacaoNegocio.processoId,
            set: {
              servicos: servicos?.trim() || "",
              origemFundos: origemFundos?.trim() || "",
            },
          });
      }

      const eraElevado = processo.nivelRisco === "elevado";

      if (ePpe) {
        await base
          .update(processoOnboarding)
          .set({
            nivelRisco: "elevado",
            fatoresRisco: [
              {
                codigo: "ppe",
                descricao: "Pessoa politicamente exposta declarada",
                peso: 100,
              },
            ],
            atualizadoEm: new Date(),
          })
          .where(eq(processoOnboarding.id, processo.id));

        if (!eraElevado) {
          try {
            await registarEvento({
              organizacaoId: processo.organizacaoId,
              processoId: processo.id,
              atorId: eu.id,
              acao: "risco.elevado",
              entidade: "processo_onboarding",
              entidadeId: processo.id,
              valorNovo: { nivelRisco: "elevado", motivo: "ppe" },
              ip,
              userAgent,
            });
          } catch (e) {
            console.error(`[processo] ${processo.referencia}: falhou auditoria de risco`, e);
          }
        }
      } else if (eraElevado) {
        await base
          .update(processoOnboarding)
          .set({
            nivelRisco: "baixo",
            fatoresRisco: [],
            atualizadoEm: new Date(),
          })
          .where(eq(processoOnboarding.id, processo.id));

        try {
          await registarEvento({
            organizacaoId: processo.organizacaoId,
            processoId: processo.id,
            atorId: eu.id,
            acao: "risco.reposto",
            entidade: "processo_onboarding",
            entidadeId: processo.id,
            valorAnterior: { nivelRisco: "elevado", motivo: "ppe" },
            valorNovo: { nivelRisco: "baixo", motivo: "ppe_retirada" },
            ip,
            userAgent,
          });
        } catch (e) {
          console.error(`[processo] ${processo.referencia}: falhou auditoria de risco reposto`, e);
        }
      }
      break;
    }

    case 5: {
      const {
        igualAoCliente,
        nome,
        nif,
        email,
        acIgualAoCliente,
        acNome,
        acEmail,
        acTelefone,
        morada,
        codigoPostal,
        localidade,
        freguesia,
        concelho,
        distrito,
        pais,
      } = dados as {
        igualAoCliente?: boolean;
        nome?: string;
        nif?: string;
        email?: string;
        acIgualAoCliente?: boolean;
        acNome?: string;
        acEmail?: string;
        acTelefone?: string;
        morada?: string;
        codigoPostal?: string;
        localidade?: string;
        freguesia?: string;
        concelho?: string;
        distrito?: string;
        pais?: string;
      };

      if (!nome?.trim() || !nif?.trim() || !email?.trim()) {
        return { ok: false, erro: "Nome, NIF e email de faturação são obrigatórios." };
      }

      const valoresFaturacao = {
        igualAoCliente: Boolean(igualAoCliente),
        nome: nome.trim(),
        nif: nif.trim(),
        email: email.trim().toLowerCase(),
        acIgualAoCliente: Boolean(acIgualAoCliente),
        acNome: acNome?.trim() || null,
        acEmail: acEmail?.trim() || null,
        acTelefone: acTelefone?.trim() || null,
        morada: morada?.trim() || "",
        codigoPostal: codigoPostal?.trim() || "",
        localidade: localidade?.trim() || "",
        freguesia: freguesia?.trim() || "",
        concelho: concelho?.trim() || "",
        distrito: distrito?.trim() || "",
        pais: pais?.trim() || "Portugal",
      };

      await base
        .insert(dadosFaturacao)
        .values(insere<typeof dadosFaturacao.$inferInsert>(valoresFaturacao))
        .onConflictDoUpdate({
          target: dadosFaturacao.processoId,
          set: valoresFaturacao,
        });
      break;
    }

    case 6: {
      const {
        origemContacto,
        origemDetalhe,
        newsletter,
        emailsNewsletter,
        areasInteresse,
        convitesIniciativas,
        convitesNome,
        convitesEmail,
      } = dados as {
        origemContacto?: "evento_conferencia" | "recomendacao" | "pesquisa_online" | "outro";
        origemDetalhe?: string;
        newsletter?: boolean;
        emailsNewsletter?: string[];
        areasInteresse?: string[];
        convitesIniciativas?: boolean;
        convitesNome?: string;
        convitesEmail?: string;
      };

      const valoresPrefs = {
        origemContacto: origemContacto || null,
        origemDetalhe: origemDetalhe?.trim() || null,
        newsletter: Boolean(newsletter),
        convitesIniciativas: Boolean(convitesIniciativas),
        convitesNome: convitesNome?.trim() || null,
        convitesEmail: convitesEmail?.trim() || null,
      };

      await base
        .insert(preferenciasContacto)
        .values(insere<typeof preferenciasContacto.$inferInsert>(valoresPrefs))
        .onConflictDoUpdate({
          target: preferenciasContacto.processoId,
          set: valoresPrefs,
        });

      if (Array.isArray(emailsNewsletter)) {
        await base
          .delete(emailNewsletter)
          .where(eq(emailNewsletter.processoId, processo.id));
        if (emailsNewsletter.length) {
          await base.insert(emailNewsletter).values(
            emailsNewsletter.map((e) => ({
              processoId: processo.id,
              email: e.trim().toLowerCase(),
            })),
          );
        }
      }

      if (Array.isArray(areasInteresse)) {
        await base
          .delete(areaInteresse)
          .where(eq(areaInteresse.processoId, processo.id));
        if (areasInteresse.length) {
          await base
            .insert(areaInteresse)
            .values(areasInteresse.map((a) => ({ processoId: processo.id, area: a.trim() })));
        }
      }
      break;
    }

    case 7: {
      const { declaracaoVeracidade, tcAceitacao, propostaAceitacao } = dados as {
        declaracaoVeracidade?: boolean;
        tcAceitacao?: boolean;
        propostaAceitacao?: boolean;
      };

      const valoresFecho = {
        declaracaoVeracidade: Boolean(declaracaoVeracidade),
        tcAceitacao: Boolean(tcAceitacao),
        propostaAceitacao: Boolean(propostaAceitacao),
      };

      await base
        .insert(fechoProposta)
        .values(insere<typeof fechoProposta.$inferInsert>(valoresFecho))
        .onConflictDoUpdate({
          target: fechoProposta.processoId,
          set: valoresFecho,
        });
      break;
    }

    default:
      return { ok: false, erro: "Passo inválido." };
  }

  await base
    .update(processoOnboarding)
    .set({ atualizadoEm: new Date() })
    .where(eq(processoOnboarding.id, processo.id));

  try {
    await registarEvento({
      organizacaoId: processo.organizacaoId,
      processoId: processo.id,
      atorId: eu.id,
      acao: "processo.dados_atualizados",
      entidade: "processo_onboarding",
      entidadeId: processo.id,
      valorNovo: { passo, papel: eu.papel },
      ip,
      userAgent,
    });
  } catch (e) {
    console.error(`[processo] ${processo.referencia}: falhou registo de auditoria da edição`, e);
  }

  try {
    revalidatePath("/processos");
    revalidatePath(`/processos/${processo.id}`);
    revalidatePath(`/admin/sociedades/${processo.organizacaoId}/processos/${processo.id}`);
    revalidatePath(`/admin/sociedades/${processo.organizacaoId}`);
  } catch {
    // revalidatePath outside request context
  }

  return { ok: true };
}

