"use server";

import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { env } from "@/env";
import { enviarEmail } from "@/lib/email";
import {
  ASSUNTO_CONFIRMACAO,
  ASSUNTO_OTP,
  emailCodigoOtp,
  emailConfirmacaoRececao,
} from "@/lib/emails/jmassano";
import { origemPublica } from "@/lib/origem";
import { assinatura, documento } from "@/db/schema/documentos";
import { codigoOtp } from "@/db/schema/otp";
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
import { canonico } from "@/features/auditoria/hash";
import { registarEvento } from "@/features/auditoria/registar";
import { registarConsentimento } from "./consentimentos";
import {
  acessoPorToken,
  motivoDoAcesso,
  seccoesDoProcesso,
  type AcessoOnboarding,
  type Processo,
} from "./dados";
import { SCHEMAS } from "./schemas";
import { passoAplicavel, proximoPasso } from "./passos";

/**
 * Guardar um passo.
 *
 * O token vem do URL e é revalidado aqui: uma Server Action é um endpoint
 * público como qualquer outro, e confiar em quem a chama seria deixar a porta
 * aberta. A validação Zod corre outra vez do lado do servidor pela mesma razão.
 */

export type Resultado =
  | { ok: true; proximo: number | null }
  | { ok: false; erros: Record<string, string[]>; mensagem?: string };

type Linha = Record<string, unknown>;

async function contexto() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
  };
}

/**
 * Os tipos dos documentos vivos de um processo.
 *
 * `isNull(apagadoEm)` porque a remoção pelo cliente é soft delete (a lei manda
 * reter): sem o filtro, anexar o cartão de cidadão e removê-lo a seguir deixava
 * o passo 2 a dar-se por satisfeito com um documento que já não está lá.
 */
async function tiposAnexados(processoId: string): Promise<string[]> {
  const linhas = await db()
    .select({ tipo: documento.tipo })
    .from(documento)
    .where(and(eq(documento.processoId, processoId), isNull(documento.apagadoEm)));
  return linhas.map((l) => l.tipo);
}

/**
 * A mesma explicação que a página dá, para a Server Action não dizer outra.
 *
 * Um cliente que veja "o link expirou" no ecrã e "este link já não é válido"
 * ao carregar em Guardar não tem como saber que é o mesmo problema — e a
 * segunda frase, sozinha, não diz o que fazer a seguir.
 */
function recusaDeAcesso(acesso: AcessoOnboarding): Resultado {
  const { titulo, descricao } = motivoDoAcesso(acesso);
  return { ok: false, erros: {}, mensagem: `${titulo} ${descricao}` };
}

export async function guardarPasso(
  bruto: string,
  n: number,
  dados: unknown,
): Promise<Resultado> {
  const acesso = await acessoPorToken(bruto);
  if (acesso.estado !== "ok") return recusaDeAcesso(acesso);

  const { processo, token } = acesso;
  if (processo.estado !== "rascunho" && processo.estado !== "pendente_cliente") {
    return {
      ok: false,
      erros: {},
      mensagem: "Este processo já foi submetido e não pode ser alterado.",
    };
  }

  const schema = SCHEMAS[n as keyof typeof SCHEMAS];
  if (!schema) return { ok: false, erros: {}, mensagem: "Passo inválido." };

  // O tipo de cliente decide o percurso, e é o passo 1 que o pode mudar a meio
  // desta chamada — daí a variável, atualizada no `case 1` antes de se calcular
  // qual é o passo seguinte.
  let tipoCliente = processo.tipoCliente;

  if (!passoAplicavel(n, tipoCliente)) {
    return {
      ok: false,
      erros: {},
      mensagem: "Este passo não se aplica a este processo.",
    };
  }

  /*
   * A verificação por email é condição da assinatura, e a pergunta é feita
   * **antes do Zod**, não depois.
   *
   * Não é ordem arbitrária. Enquanto o código não estiver verificado, o ecrã não
   * desenha o quadro da assinatura — e um campo que não está no ecrã não entra
   * no `FormData`, por isso o `passo7` recusaria a carga com «Assine no quadro
   * antes de submeter», que é a resposta certa à pergunta errada: quem lê isso
   * vai procurar um quadro de assinatura que a plataforma está deliberadamente a
   * esconder. A primeira coisa que falta é a que tem de ser dita.
   *
   * E não chega travar o `submeter`: o que dá prova de quem assinou é a linha em
   * `assinatura` — com o hash do dossier e o relógio do servidor —, e deixá-la
   * ser escrita sem verificação era gravar a prova primeiro e pensar no fator de
   * autenticação depois. O ecrã é conforto; uma Server Action é um endpoint
   * público como qualquer outro.
   */
  if (n === 7 && !(await verificacaoValida(processo.id))) return RECUSA_SEM_OTP;

  /*
   * O passo 2 é validado contra dois factos que o formulário não tem como
   * enviar, e não deve: o percurso do processo e os documentos que estão mesmo
   * anexados.
   *
   * O primeiro decide se o NIF leva a régua de pessoa coletiva (primeiro dígito
   * 5, 6, 8 ou 9); o segundo decide se o passo fecha. Nenhum dos dois pode vir
   * da carga — o `Anexos` sobe por uma Server Action à parte e o input nem
   * `name` tem, por isso o `new FormData(form)` nunca soube de ficheiros, e o
   * `tipoCliente` que a janela mandasse era exatamente o que a regra existe para
   * não deixar escolher. Vêm daqui, e o que a carga trouxesse com estes nomes é
   * substituído, não acreditado.
   */
  const entrada =
    n === 2 && typeof dados === "object" && dados !== null
      ? {
          ...(dados as Record<string, unknown>),
          tipoCliente,
          documentos: await tiposAnexados(processo.id),
        }
      : dados;

  const r = schema.safeParse(entrada);
  if (!r.success) {
    const erros: Record<string, string[]> = {};
    for (const problema of r.error.issues) {
      const campo = problema.path.join(".") || "_";
      (erros[campo] ??= []).push(problema.message);
    }
    return { ok: false, erros };
  }

  const v = r.data as Linha;
  const base = db();
  const { ip, userAgent } = await contexto();

  // O Zod já garantiu a forma; o Drizzle só precisa de acreditar nela. Sem o
  // cast, cada tabela pedia o objeto literal completo em vez do espalhado.
  const insere = <T>(extra: Linha) => ({ processoId: processo.id, ...extra }) as T;

  switch (n) {
    case 1: {
      const { tipoCliente: escolhido, nacionalidades, ...resto } = v as {
        tipoCliente: "particular" | "empresa";
        nacionalidades: string[];
      } & Linha;

      tipoCliente = escolhido;

      await base
        .insert(dadosIdentificacao)
        .values(insere<typeof dadosIdentificacao.$inferInsert>(resto))
        .onConflictDoUpdate({
          target: dadosIdentificacao.processoId,
          set: resto as Partial<typeof dadosIdentificacao.$inferInsert>,
        });

      // As nacionalidades são uma lista: substituir é mais simples e correto do
      // que tentar reconciliar diferenças. Só as do cliente — as do
      // representante são gravadas no passo 3 e apagá-las aqui fazia com que
      // voltar atrás para corrigir uma vírgula no nome as levasse com ele.
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
          nacionalidades.map((pais) => ({
            processoId: processo.id,
            titular: "cliente" as const,
            pais,
          })),
        );
      }

      // O tipo de cliente vive no processo: ramifica tudo o resto.
      await base
        .update(processoOnboarding)
        .set({ tipoCliente })
        .where(eq(processoOnboarding.id, processo.id));

      // Trocar de empresa para pessoa singular tira o passo 3 do percurso. O
      // que lá tivesse sido gravado deixa de ter sentido e não pode ficar a
      // apodrecer no dossier: apareceria no PDF do arquivo e no back-office
      // como se ainda descrevesse o processo.
      if (tipoCliente === "particular") {
        await base
          .delete(representanteLegal)
          .where(eq(representanteLegal.processoId, processo.id));
        await base
          .delete(nacionalidade)
          .where(
            and(
              eq(nacionalidade.processoId, processo.id),
              eq(nacionalidade.titular, "representante"),
            ),
          );
      }
      break;
    }

    case 2: {
      // `tipoCliente` e `documentos` entram no schema para decidir as regras e
      // não são colunas de `dados_fiscais`: saem antes do INSERT, senão o
      // Drizzle escreve `insert into dados_fiscais ("tipo_cliente"…)` e rebenta
      // num campo que o cliente nunca viu.
      const fiscais = { ...v };
      delete fiscais.tipoCliente;
      delete fiscais.documentos;

      await base
        .insert(dadosFiscais)
        .values(insere<typeof dadosFiscais.$inferInsert>(fiscais))
        .onConflictDoUpdate({
          target: dadosFiscais.processoId,
          set: fiscais as Partial<typeof dadosFiscais.$inferInsert>,
        });
      break;
    }

    case 3: {
      const { eRepresentante, nacionalidades } = v as {
        eRepresentante: boolean;
        nacionalidades: string[];
      };

      // Um campo que ficou por preencher chega aqui como string vazia, e uma
      // data vazia numa coluna `date` rebenta — por isso o vazio vira null.
      const texto = (campo: string) => {
        const bruto = v[campo];
        return typeof bruto === "string" && bruto ? bruto : null;
      };

      // Com "Sim" — quem preenche é o representante legal — o passo grava-se na
      // mesma, com o interruptor a `true` e o resto a null. Uma linha em branco
      // é a prova de que a pergunta foi feita e respondida; a ausência de linha
      // não distingue isso de "ainda não chegou aqui".
      const valores = {
        eRepresentante,
        relacao: texto("relacao"),
        nome: texto("nome"),
        dataNascimento: texto("dataNascimento"),
        profissao: texto("profissao"),
        telefone: texto("telefone"),
        email: texto("email"),
        morada: texto("morada"),
        pais: texto("pais"),
        localidade: texto("localidade"),
        codigoPostal: texto("codigoPostal"),
        freguesia: texto("freguesia"),
        concelho: texto("concelho"),
        distrito: texto("distrito"),
      };

      await base
        .insert(representanteLegal)
        .values(insere<typeof representanteLegal.$inferInsert>(valores))
        .onConflictDoUpdate({
          target: representanteLegal.processoId,
          set: valores,
        });

      await base
        .delete(nacionalidade)
        .where(
          and(
            eq(nacionalidade.processoId, processo.id),
            eq(nacionalidade.titular, "representante"),
          ),
        );

      if (!eRepresentante && nacionalidades.length) {
        await base.insert(nacionalidade).values(
          nacionalidades.map((pais) => ({
            processoId: processo.id,
            titular: "representante" as const,
            pais,
          })),
        );
      }
      break;
    }

    case 4: {
      const { servicos, origemFundos, ...ppe } = v as {
        servicos: string;
        origemFundos: string;
      } & Linha;

      await base
        .insert(declaracaoPpe)
        .values(insere<typeof declaracaoPpe.$inferInsert>(ppe))
        .onConflictDoUpdate({
          target: declaracaoPpe.processoId,
          set: ppe as Partial<typeof declaracaoPpe.$inferInsert>,
        });

      await base
        .insert(relacaoNegocio)
        .values({ processoId: processo.id, servicos, origemFundos })
        .onConflictDoUpdate({
          target: relacaoNegocio.processoId,
          set: { servicos, origemFundos },
        });

      // Regra de negócio que não é opcional: PPE declarada força risco elevado.
      //
      // E o inverso também tem de valer. Antes, o risco só subia: quem
      // respondesse Sim, voltasse atrás e corrigisse para Não ficava com o
      // processo marcado como elevado para sempre, com um fator de risco a
      // dizer "pessoa politicamente exposta declarada" por baixo de uma
      // declaração que dizia o contrário. O risco não é mostrado em lado
      // nenhum (D21), o que torna isto ainda mais difícil de apanhar a olho —
      // mas é o valor gravado, e é dele que qualquer relatório vai viver.
      const eraElevado = processo.nivelRisco === "elevado";

      if (ppe.ePpe === true) {
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
          })
          .where(eq(processoOnboarding.id, processo.id));

        if (!eraElevado) {
          await registarEvento({
            organizacaoId: processo.organizacaoId,
            processoId: processo.id,
            acao: "risco.elevado",
            entidade: "processo_onboarding",
            entidadeId: processo.id,
            valorNovo: { nivelRisco: "elevado", motivo: "ppe" },
            ip,
            userAgent,
          });
        }
      } else if (eraElevado) {
        await base
          .update(processoOnboarding)
          .set({ nivelRisco: "baixo", fatoresRisco: [] })
          .where(eq(processoOnboarding.id, processo.id));

        await registarEvento({
          organizacaoId: processo.organizacaoId,
          processoId: processo.id,
          acao: "risco.reposto",
          entidade: "processo_onboarding",
          entidadeId: processo.id,
          valorAnterior: { nivelRisco: "elevado", motivo: "ppe" },
          valorNovo: { nivelRisco: "baixo", motivo: "ppe_retirada" },
          ip,
          userAgent,
        });
      }
      break;
    }

    case 5:
      await base
        .insert(dadosFaturacao)
        .values(insere<typeof dadosFaturacao.$inferInsert>(v))
        .onConflictDoUpdate({
          target: dadosFaturacao.processoId,
          set: v as Partial<typeof dadosFaturacao.$inferInsert>,
        });
      break;

    case 6: {
      const { emailsNewsletter, areasInteresse, ...prefs } = v as {
        emailsNewsletter: string[];
        areasInteresse: string[];
      } & Linha;

      await base
        .insert(preferenciasContacto)
        .values(insere<typeof preferenciasContacto.$inferInsert>(prefs))
        .onConflictDoUpdate({
          target: preferenciasContacto.processoId,
          set: prefs as Partial<typeof preferenciasContacto.$inferInsert>,
        });

      // Listas: substituir é mais simples e correto do que reconciliar diferenças.
      await base.delete(emailNewsletter).where(eq(emailNewsletter.processoId, processo.id));
      if (emailsNewsletter.length) {
        await base
          .insert(emailNewsletter)
          .values(emailsNewsletter.map((email) => ({ processoId: processo.id, email })));
      }

      await base.delete(areaInteresse).where(eq(areaInteresse.processoId, processo.id));
      if (areasInteresse.length) {
        await base
          .insert(areaInteresse)
          .values(areasInteresse.map((area) => ({ processoId: processo.id, area })));
      }

      await registarConsentimento({
        processoId: processo.id,
        finalidade: "newsletter",
        aceite: prefs.newsletter === true,
        ip,
        userAgent,
      });

      await registarConsentimento({
        processoId: processo.id,
        finalidade: "convites_iniciativas",
        aceite: prefs.convitesIniciativas === true,
        ip,
        userAgent,
      });
      break;
    }

    case 7: {
      // A assinatura vive na sua tabela; o fecho fica só com a declaração.
      const { assinatura: rubrica, ...fecho } = v as { assinatura: string } & Linha;

      await base
        .insert(fechoProposta)
        .values(insere<typeof fechoProposta.$inferInsert>(fecho))
        .onConflictDoUpdate({
          target: fechoProposta.processoId,
          set: fecho as Partial<typeof fechoProposta.$inferInsert>,
        });

      // O que se assina é o conteúdo, não o botão: o hash é do dossier inteiro
      // no momento da assinatura, em serialização canónica. Se alguém alterar
      // um campo depois disto, o hash deixa de bater.
      const dossier = await seccoesDoProcesso(processo.id);
      const hashDocumento = createHash("sha256")
        .update(canonico({ referencia: processo.referencia, dossier }), "utf8")
        .digest("hex");

      const valores = {
        processoId: processo.id,
        tipo: "simples",
        imagemDados: rubrica,
        hashDocumento,
        ip: ip ?? "desconhecido",
        userAgent: userAgent ?? "desconhecido",
        // Relógio do servidor. Nunca o do cliente — é trivial de alterar.
        assinadoEm: new Date(),
      };

      await base
        .insert(assinatura)
        .values(valores)
        .onConflictDoUpdate({ target: assinatura.processoId, set: valores });

      await registarConsentimento({
        processoId: processo.id,
        finalidade: "declaracao_veracidade",
        aceite: fecho.declaracaoVeracidade === true,
        ip,
        userAgent,
      });

      await registarEvento({
        organizacaoId: processo.organizacaoId,
        processoId: processo.id,
        acao: "assinatura.criada",
        entidade: "assinatura",
        entidadeId: processo.id,
        valorNovo: { hashDocumento, tipo: "simples" },
        ip,
        userAgent,
      });
      break;
    }
  }

  await registarEvento({
    organizacaoId: processo.organizacaoId,
    processoId: processo.id,
    acao: `passo.${n}.gravado`,
    entidade: "processo_onboarding",
    entidadeId: processo.id,
    valorNovo: { passo: n },
    ip,
    userAgent,
  });

  const seguinte = proximoPasso(n, tipoCliente);

  /*
   * `passo_atual` é o ponto onde o cliente retoma, e um retomar não anda para
   * trás.
   *
   * Estava `seguinte ?? n` à seca, e isso valia enquanto o formulário só se
   * percorresse para a frente. Com os links "Corrigir" da revisão a levarem de
   * volta ao passo 2, gravar lá punha o `passo_atual` a 3 — e quem fechasse o
   * separador e voltasse a abrir o link caía no passo 3 de um processo que já
   * ia no 7. O `max` guarda o mais avançado dos dois; o `check` da base de dados
   * (`between 1 and 7`) continua satisfeito porque nenhum dos dois o excede.
   */
  const marca = Math.max(processo.passoAtual, seguinte ?? n);

  await base
    .update(processoOnboarding)
    .set({ passoAtual: marca })
    .where(eq(processoOnboarding.id, processo.id));

  revalidatePath(`/onboarding/${token}`, "layout");
  return { ok: true, proximo: seguinte };
}

/* ── código de verificação por email (OTP) ───────────────────────────────── */

/**
 * A verificação do fecho.
 *
 * O passo 7 pedia uma caixa marcada, uma rubrica desenhada com o rato e um
 * clique. Nada disso prova **quem** está do outro lado: o link mágico é o único
 * fator, e um link mágico é um segredo que viaja por email, se cola em conversas
 * e fica em históricos de browser. Quem o apanhe assina em nome do cliente, e a
 * assinatura fica gravada com o hash do dossier a dizer que foi ele.
 *
 * O código fecha essa distância no único momento em que ela importa: quem assina
 * tem de provar, no momento de assinar, que continua a ter acesso à caixa de
 * correio para onde a sociedade escreveu. Não é autenticação forte e não se
 * apresenta como tal — é um segundo fator sobre o mesmo canal, e o que ele
 * apanha é o link reencaminhado, que é o caso real.
 */

/** Quanto tempo o código serve depois de gerado. */
const VALIDADE_OTP_MINUTOS = 10;

/**
 * Quanto tempo uma verificação bem-sucedida vale.
 *
 * Não é o mesmo prazo do código, e não podia ser: entre acertar no código e
 * carregar em Submeter há a leitura dos T&C, a leitura da proposta e a rubrica,
 * e obrigar a repetir a verificação a meio disso era transformar uma medida de
 * segurança num obstáculo que se contorna pedindo outro código. Uma hora chega
 * para fechar o passo e é curta o suficiente para não valer no dia seguinte.
 */
const VALIDADE_VERIFICACAO_MINUTOS = 60;

/** Ao quinto engano o código morre: seis dígitos são um milhão de hipóteses. */
const MAX_TENTATIVAS_OTP = 5;

/** Intervalo mínimo entre dois pedidos de código, em segundos. */
const INTERVALO_REENVIO_S = 60;

/**
 * O código nunca é guardado em claro, e o processo entra como sal.
 *
 * Sem o sal, dois processos com o mesmo código de seis dígitos — que acontece,
 * são só um milhão de hipóteses e a POC não vai ter um milhão de fechos —
 * partilhavam o hash, e uma tabela arco-íris de um milhão de linhas resolvia-os
 * todos de uma vez. Mesma regra do token do link mágico (D4).
 */
function hashCodigo(processoId: string, codigo: string): string {
  return createHash("sha256").update(`${processoId}:${codigo.trim()}`, "utf8").digest("hex");
}

/** `randomInt` e não `Math.random`: isto é um segredo, não um sorteio. */
function gerarCodigo(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Comparação em tempo constante — os dois lados são hashes hex de 64 caracteres. */
function hashesIguais(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * `joao.silva@exemplo.pt` → `j••••••••a@exemplo.pt`.
 *
 * O cliente já sabe qual é o seu endereço — escreveu-o no passo 1 —, por isso
 * isto não lhe esconde nada. O que evita é que um link reencaminhado mostre o
 * endereço completo a quem o abrir: quem tem o link não pode ficar a saber para
 * onde é que o código vai.
 */
function mascarar(email: string): string {
  const [local, dominio] = email.split("@");
  if (!dominio) return "•••";
  if (local.length <= 2) return `${local[0] ?? "•"}•••@${dominio}`;
  return `${local[0]}${"•".repeat(Math.min(local.length - 2, 8))}${local[local.length - 1]}@${dominio}`;
}

/** O endereço para onde o código vai, com as mesmas prioridades dos outros emails. */
async function emailDoProcesso(processo: Processo): Promise<string | null> {
  const base = db();
  const [identificacao] = await base
    .select({ email: dadosIdentificacao.email, nome: dadosIdentificacao.nome })
    .from(dadosIdentificacao)
    .where(eq(dadosIdentificacao.processoId, processo.id))
    .limit(1);
  const [faturacao] = await base
    .select({ email: dadosFaturacao.email })
    .from(dadosFaturacao)
    .where(eq(dadosFaturacao.processoId, processo.id))
    .limit(1);

  return identificacao?.email ?? faturacao?.email ?? processo.emailCliente ?? null;
}

/** O código mais recente de um processo, verificado ou não. */
async function ultimoCodigo(processoId: string) {
  const [linha] = await db()
    .select()
    .from(codigoOtp)
    .where(eq(codigoOtp.processoId, processoId))
    .orderBy(desc(codigoOtp.criadoEm))
    .limit(1);
  return linha ?? null;
}

/**
 * Há uma verificação válida para este processo?
 *
 * É esta a pergunta que trava a assinatura e a submissão, e é feita à base de
 * dados e não ao estado do browser — o `submeter` é um endpoint público como
 * qualquer outro, e um cliente que decida nunca lhe chamar `verificarCodigoOtp`
 * não pode ficar em vantagem sobre quem o fez.
 */
async function verificacaoValida(processoId: string): Promise<boolean> {
  const linha = await ultimoCodigo(processoId);
  if (!linha?.verificadoEm) return false;
  const limite = new Date(linha.verificadoEm.getTime() + VALIDADE_VERIFICACAO_MINUTOS * 60_000);
  return limite > new Date();
}

export type EstadoOtp = {
  /** Já há um código verificado e dentro do prazo. */
  verificado: boolean;
  /** Já foi pedido um código (e continua válido), logo há caixa a que ir. */
  pedido: boolean;
  /** O endereço mascarado do último código pedido. */
  para: string | null;
};

/** O que o passo 7 precisa de saber ao montar, sem pedir código nenhum. */
export async function estadoDoCodigo(bruto: string): Promise<EstadoOtp> {
  const acesso = await acessoPorToken(bruto);
  if (acesso.estado !== "ok") return { verificado: false, pedido: false, para: null };

  const linha = await ultimoCodigo(acesso.processo.id);
  if (!linha) return { verificado: false, pedido: false, para: null };

  return {
    verificado: await verificacaoValida(acesso.processo.id),
    pedido: linha.expiraEm > new Date() && !linha.verificadoEm,
    para: mascarar(linha.enviadoPara),
  };
}

export type ResultadoOtp =
  | { ok: true; para: string; expiraEmMinutos: number }
  | { ok: false; erro: string; esperarSegundos?: number };

/**
 * Gera um código, grava-lhe o hash e manda-o por email.
 *
 * Pedido explícito e não automático ao entrar no passo: o passo 7 é revisitado
 * (o cliente vai corrigir um campo e volta), e um envio por cada visita enchia a
 * caixa do cliente de códigos, gastava a quota do fornecedor e treinava-o a
 * ignorar exatamente a mensagem que ele precisa de ler.
 */
export async function enviarCodigoOtp(bruto: string): Promise<ResultadoOtp> {
  const acesso = await acessoPorToken(bruto);
  if (acesso.estado !== "ok") {
    const { titulo, descricao } = motivoDoAcesso(acesso);
    return { ok: false, erro: `${titulo} ${descricao}` };
  }

  const { processo } = acesso;
  if (processo.estado !== "rascunho" && processo.estado !== "pendente_cliente") {
    return { ok: false, erro: "Este processo já foi submetido." };
  }

  const destino = await emailDoProcesso(processo);
  if (!destino) {
    return {
      ok: false,
      erro:
        "Não há endereço de email neste processo. Volte ao passo 1, indique o seu email e tente de novo.",
    };
  }

  // Um pedido a cada minuto, no máximo. Sem isto, o botão "Enviar código" é um
  // botão para mandar emails a partir do domínio da sociedade — em nome dela e
  // à custa da quota dela.
  const anterior = await ultimoCodigo(processo.id);
  if (anterior) {
    const passaram = (Date.now() - anterior.criadoEm.getTime()) / 1000;
    if (passaram < INTERVALO_REENVIO_S) {
      const falta = Math.ceil(INTERVALO_REENVIO_S - passaram);
      return {
        ok: false,
        erro: `Já enviámos um código há instantes. Aguarde ${falta} segundos antes de pedir outro.`,
        esperarSegundos: falta,
      };
    }
  }

  const codigo = gerarCodigo();
  const expiraEm = new Date(Date.now() + VALIDADE_OTP_MINUTOS * 60_000);

  await db().insert(codigoOtp).values({
    processoId: processo.id,
    codigoHash: hashCodigo(processo.id, codigo),
    enviadoPara: destino,
    expiraEm,
  });

  const [identificacao] = await db()
    .select({ nome: dadosIdentificacao.nome })
    .from(dadosIdentificacao)
    .where(eq(dadosIdentificacao.processoId, processo.id))
    .limit(1);

  const envio = await enviarEmail({
    para: destino,
    assunto: ASSUNTO_OTP,
    html: emailCodigoOtp({
      nome: identificacao?.nome,
      codigo,
      referencia: processo.referencia,
      minutos: VALIDADE_OTP_MINUTOS,
    }),
    template: "otp",
    organizacaoId: processo.organizacaoId,
    processoId: processo.id,
  });

  const { ip, userAgent } = await contexto();

  // O **código nunca entra em auditoria**, nem mascarado: o registo é imutável
  // e legível por quem tem o back-office, e um segredo de dez minutos escrito
  // num sítio que dura sete anos é um segredo mal guardado. O que fica é que
  // foi pedido, para onde, e se saiu.
  await registarEvento({
    organizacaoId: processo.organizacaoId,
    processoId: processo.id,
    acao: envio.ok ? "otp.enviado" : "otp.envio_falhou",
    entidade: "codigo_otp",
    entidadeId: processo.id,
    valorNovo: { para: destino, ...(envio.ok ? {} : { erro: envio.erro }) },
    ip,
    userAgent,
  });

  if (!envio.ok) {
    return {
      ok: false,
      erro:
        "Não foi possível enviar o código por email. Tente novamente dentro de instantes ou contacte a sociedade.",
    };
  }

  return {
    ok: true,
    para: mascarar(destino),
    expiraEmMinutos: VALIDADE_OTP_MINUTOS,
  };
}

export type ResultadoVerificacao = { ok: true } | { ok: false; erro: string };

/** Confere o código introduzido pelo cliente e liberta a assinatura. */
export async function verificarCodigoOtp(
  bruto: string,
  codigoBruto: string,
): Promise<ResultadoVerificacao> {
  const acesso = await acessoPorToken(bruto);
  if (acesso.estado !== "ok") {
    const { titulo, descricao } = motivoDoAcesso(acesso);
    return { ok: false, erro: `${titulo} ${descricao}` };
  }

  const { processo } = acesso;

  // Só dígitos, e exatamente seis: um `912 345` colado com espaço não é engano
  // do cliente, é formatação, e não vale gastar-lhe uma tentativa por isso.
  const codigo = codigoBruto.replace(/\D/g, "");
  if (codigo.length !== 6) {
    return { ok: false, erro: "O código tem 6 dígitos. Confirme o que recebeu por email." };
  }

  const linha = await ultimoCodigo(processo.id);
  if (!linha) {
    return { ok: false, erro: "Ainda não pediu nenhum código. Carregue em «Enviar código»." };
  }
  if (linha.verificadoEm) return { ok: true };

  if (linha.expiraEm <= new Date()) {
    return { ok: false, erro: "Este código expirou. Peça um novo código." };
  }
  if (linha.tentativas >= MAX_TENTATIVAS_OTP) {
    return {
      ok: false,
      erro: "Este código foi bloqueado ao fim de 5 tentativas. Peça um novo código.",
    };
  }

  const { ip, userAgent } = await contexto();

  if (!hashesIguais(linha.codigoHash, hashCodigo(processo.id, codigo))) {
    const tentativas = linha.tentativas + 1;
    await db()
      .update(codigoOtp)
      .set({ tentativas })
      .where(eq(codigoOtp.id, linha.id));

    // As tentativas falhadas ficam em auditoria porque são o único sinal de
    // alguém a martelar o código de outra pessoa — e é um sinal que só se lê
    // depois, quando já se está a investigar.
    await registarEvento({
      organizacaoId: processo.organizacaoId,
      processoId: processo.id,
      acao: "otp.falhado",
      entidade: "codigo_otp",
      entidadeId: linha.id,
      valorNovo: { tentativas },
      ip,
      userAgent,
    });

    const restam = MAX_TENTATIVAS_OTP - tentativas;
    return {
      ok: false,
      erro:
        restam > 0
          ? `Código errado. ${restam === 1 ? "Resta 1 tentativa" : `Restam ${restam} tentativas`} antes de ter de pedir um novo.`
          : "Código errado. Esgotou as tentativas — peça um novo código.",
    };
  }

  await db()
    .update(codigoOtp)
    .set({ verificadoEm: new Date(), tentativas: linha.tentativas + 1 })
    .where(eq(codigoOtp.id, linha.id));

  await registarEvento({
    organizacaoId: processo.organizacaoId,
    processoId: processo.id,
    acao: "otp.verificado",
    entidade: "codigo_otp",
    entidadeId: linha.id,
    valorNovo: { para: linha.enviadoPara },
    ip,
    userAgent,
  });

  return { ok: true };
}

/** A mesma recusa nos dois sítios que a fazem — o passo 7 e a submissão. */
const RECUSA_SEM_OTP: Resultado = {
  ok: false,
  erros: {
    otp: ["Introduza o código de verificação que recebeu por email para poder assinar."],
  },
  mensagem: "Falta verificar o código enviado por email.",
};

/** Submissão final: fecha o processo e passa-o para a fila de revisão. */
export async function submeter(bruto: string): Promise<Resultado> {
  const acesso = await acessoPorToken(bruto);
  if (acesso.estado !== "ok") return recusaDeAcesso(acesso);

  const { processo, token } = acesso;

  const [fecho] = await db()
    .select()
    .from(fechoProposta)
    .where(eq(fechoProposta.processoId, processo.id))
    .limit(1);

  if (!fecho?.tcAceitacao) {
    return {
      ok: false,
      erros: { tcAceitacao: ["Tem de aceitar os Termos e Condições."] },
    };
  }

  if (!fecho?.propostaAceitacao) {
    return {
      ok: false,
      erros: { propostaAceitacao: ["Tem de aceitar a proposta de honorários."] },
    };
  }

  if (!fecho?.declaracaoVeracidade) {
    return {
      ok: false,
      erros: { declaracaoVeracidade: ["Tem de aceitar a declaração final."] },
    };
  }

  // A rubrica é o que dá prova de quem assinou: sem ela gravada, o processo
  // não pode ser submetido. A caixa de verificação sozinha não vale nada.
  const [ass] = await db()
    .select({ imagemDados: assinatura.imagemDados })
    .from(assinatura)
    .where(eq(assinatura.processoId, processo.id))
    .limit(1);

  if (!ass?.imagemDados || ass.imagemDados.length < 50) {
    return {
      ok: false,
      erros: { assinatura: ["Assine no quadro antes de submeter."] },
      mensagem: "A assinatura é obrigatória.",
    };
  }

  // Segunda fechadura na mesma porta. O `guardarPasso` já a exige antes de
  // escrever a rubrica, mas o `submeter` é uma Server Action à parte e chamável
  // por si: um processo com uma rubrica antiga na tabela e nenhuma verificação
  // válida agora não passa por aqui.
  if (!(await verificacaoValida(processo.id))) return RECUSA_SEM_OTP;

  const { ip, userAgent } = await contexto();

  // `returning` e não um segundo SELECT: o resumo em PDF precisa da data de
  // submissão, e a linha que já estava em memória ainda a tem a null.
  //
  // O estado passa a `aguardar_aprovacao`, não a `submetido`: a POC ganhou de
  // volta um fluxo de aprovação (a D20 apagou-o; esta atualização repõe-no), e
  // um processo submetido pelo cliente fica à espera da decisão de um sócio ou
  // advogado antes de `aprovado` ou `rejeitado`. `submetidoEm` continua a
  // marcar o momento da submissão em si.
  const [submetido] = await db()
    .update(processoOnboarding)
    .set({ estado: "aguardar_aprovacao", submetidoEm: new Date() })
    .where(eq(processoOnboarding.id, processo.id))
    .returning();

  await registarEvento({
    organizacaoId: processo.organizacaoId,
    processoId: processo.id,
    acao: "processo.submetido",
    entidade: "processo_onboarding",
    entidadeId: processo.id,
    valorAnterior: { estado: processo.estado },
    valorNovo: { estado: "aguardar_aprovacao" },
    ip,
    userAgent,
  });

  // Guardado, apesar de o `notificarSubmissao` prometer não lançar: a promessa
  // já não era verdade (o `env()` do destino do aviso interno lança, e lançava
  // *antes* de os emails ao cliente estarem sequer na fila), e uma submissão
  // gravada não pode virar ecrã de erro por causa de um email. O mesmo contrato
  // do `arquivarNoArmazenamento`, aqui em baixo.
  try {
    await notificarSubmissao(processo);
  } catch (e) {
    console.error(`[email] ${processo.referencia}: os emails de submissão não correram`, e);
  }
  await arquivarNoArmazenamento(submetido ?? processo);

  revalidatePath(`/onboarding/${token}`, "layout");
  return { ok: true, proximo: null };
}

/**
 * Pasta do cliente no destino da sociedade, depois de o processo já estar
 * submetido.
 *
 * Mesmo contrato dos emails, e pela mesma razão: o processo já está gravado, e
 * nada do que aconteça a seguir pode transformar uma submissão bem-sucedida
 * num ecrã de erro. A falha vai para `evento_auditoria` com a ação
 * `armazenamento.erro` e aparece no ecrã de configuração do back-office.
 */
async function arquivarNoArmazenamento(processo: typeof processoOnboarding.$inferSelect) {
  try {
    // Esperado, e não deitado fora: numa POC alojada em contentor, um
    // `void promessa()` é morto quando a resposta fecha, e a sincronização
    // desapareceria a meio sem deixar rasto.
    const { sincronizarCliente } = await import("@/lib/storage/sincronizar");
    await sincronizarCliente(processo);
  } catch (e) {
    // `sincronizarCliente` já não lança; isto cobre o próprio import falhar.
    console.error("[armazenamento] sincronização não chegou a correr", e);
  }
}

/**
 * Os emails que saem quando um processo é submetido.
 *
 * Um para o cliente — a confirmação de receção — e um para a sociedade.
 * Nenhum deles pode impedir a submissão: o processo já está gravado, e um erro
 * do Resend não transforma um formulário bem preenchido num ecrã de erro. Daí
 * o `Promise.allSettled` e o facto de nada aqui lançar.
 *
 * As boas-vindas (com os três anexos) já não vão aqui: com o fluxo de
 * aprovação de volta (D20 apagou-o, esta atualização repõe-no), esse email
 * passa a sair quando o processo é aprovado — `enviarBoasVindas`, em
 * `@/lib/emails/boas-vindas`, partilhada com `aprovarProcesso`.
 */
async function notificarSubmissao(processo: typeof processoOnboarding.$inferSelect) {
  const base = db();

  const [identificacao] = await base
    .select({ email: dadosIdentificacao.email, nome: dadosIdentificacao.nome })
    .from(dadosIdentificacao)
    .where(eq(dadosIdentificacao.processoId, processo.id))
    .limit(1);

  const [faturacao] = await base
    .select({ email: dadosFaturacao.email })
    .from(dadosFaturacao)
    .where(eq(dadosFaturacao.processoId, processo.id))
    .limit(1);

  const emailCliente = identificacao?.email ?? faturacao?.email;

  // Sem valor por omissão. Aqui estava um endereço pessoal escrito à mão, e
  // numa instalação a que faltasse a variável eram os dados de processos de
  // clientes — referência, tipo, link para o dossier — a sair para a caixa de
  // correio de quem escreveu o código. Não havendo destino configurado, o
  // aviso não sai: os dois emails ao cliente e o arquivo não dependem disto.
  //
  // Dentro de um `try` porque o `env()` **lança** — valida o ambiente inteiro,
  // e uma variável qualquer inválida rebentava aqui, três linhas antes de os
  // dois emails ao cliente entrarem na fila. O aviso interno é o acessório
  // desta função; deixá-lo derrubar o principal era ter a prioridade ao
  // contrário.
  let emailBackoffice: string | undefined;
  try {
    emailBackoffice = env().EMAIL_NOTIFICACOES;
  } catch (e) {
    console.error("[email] o ambiente não valida — o aviso ao back-office não sai", e);
  }

  const envios: Promise<unknown>[] = [];

  if (emailCliente) {
    envios.push(
      enviarEmail({
        para: emailCliente,
        assunto: ASSUNTO_CONFIRMACAO,
        html: emailConfirmacaoRececao({
          nome: identificacao?.nome,
          referencia: processo.referencia,
        }),
        template: "confirmacao_rececao",
        organizacaoId: processo.organizacaoId,
        processoId: processo.id,
      }),
    );
  }

  if (emailBackoffice) {
    // O anfitrião sai dos cabeçalhos do pedido, como o link do email de
    // registo: estava aqui `https://poc.terlicalabs.com` escrito à mão, e numa
    // segunda instalação o aviso mandava a equipa para o dossier da primeira.
    // Falhar a lê-lo dá um link relativo no aviso interno, não um `allSettled`
    // por correr com os dois emails do cliente já em voo e sem ninguém a ouvir.
    let endereco = "";
    try {
      endereco = await origemPublica();
    } catch (e) {
      console.error("[email] origemPublica falhou; o aviso interno leva link relativo", e);
    }
    envios.push(
      enviarEmail({
        para: emailBackoffice,
        template: "notificacao_backoffice",
        organizacaoId: processo.organizacaoId,
        processoId: processo.id,
        assunto: `Novo processo submetido: ${processo.referencia}`,
        html: `
        <p>Foi submetido um novo processo de onboarding.</p>
        <ul>
          <li>Referência: <strong>${processo.referencia}</strong></li>
          <li>Tipo de cliente: ${
            processo.tipoCliente === "empresa" ? "Empresa / Entidade Coletiva" : "Pessoa Singular"
          }</li>
        </ul>
        <p><a href="${endereco}/processos/${processo.id}">Ver processo no back-office</a></p>
      `,
      }),
    );
  } else {
    console.warn(
      "[email] EMAIL_NOTIFICACOES não está configurada — o aviso ao back-office não foi enviado.",
    );
  }

  const resultados = await Promise.allSettled(envios);
  for (const resultado of resultados) {
    if (resultado.status === "rejected") {
      console.error("[email] falha ao notificar submissão", resultado.reason);
    }
  }
}
