"use server";

import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, count, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { env } from "@/env";
import { enviarEmail } from "@/lib/email";
import { consumir } from "@/lib/limites";
import {
  ASSUNTO_CONFIRMACAO,
  ASSUNTO_OTP,
  emailCodigoOtp,
  emailConfirmacaoRececao,
} from "@/lib/emails/jmassano";
import { urlLogotipoSociedade } from "@/lib/emails/moldura";
import { resolverEmailCliente } from "@/lib/emails/obter-modelo";
import { origemPublica } from "@/lib/origem";
import { termosEmVigor } from "@/lib/termos-sociedade";
import { assinatura, documento } from "@/db/schema/documentos";
import { organizacao } from "@/db/schema/organizacao";
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
import { registarNotificacao } from "@/features/notificacoes/servico";
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
 * Guarda um passo. Token revalidado aqui e Zod repetido no servidor — uma
 * Server Action é um endpoint público como qualquer outro.
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

/** Tipos de documentos vivos de um processo — remoção é soft delete (isNull(apagadoEm)), a lei manda reter. */
async function tiposAnexados(processoId: string): Promise<string[]> {
  const linhas = await db()
    .select({ tipo: documento.tipo })
    .from(documento)
    .where(and(eq(documento.processoId, processoId), isNull(documento.apagadoEm)));
  return linhas.map((l) => l.tipo);
}

/** Mesma explicação que a página dá — evita dizer ao cliente duas frases diferentes para o mesmo problema. */
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
  if (
    processo.estado !== "rascunho" &&
    processo.estado !== "pendente_cliente" &&
    processo.estado !== "em_revisao"
  ) {
    return {
      ok: false,
      erros: {},
      mensagem: "Este processo já foi submetido e não pode ser alterado.",
    };
  }

  const schema = SCHEMAS[n as keyof typeof SCHEMAS];
  if (!schema) return { ok: false, erros: {}, mensagem: "Passo inválido." };

  // Passo 1 pode mudar o tipo de cliente a meio desta chamada — daí a
  // variável, atualizada no case 1 antes de calcular o passo seguinte.
  let tipoCliente = processo.tipoCliente;

  if (!passoAplicavel(n, tipoCliente)) {
    return {
      ok: false,
      erros: {},
      mensagem: "Este passo não se aplica a este processo.",
    };
  }

  /*
   * Verificação por email antes do Zod, não depois (D57): sem código validado
   * o ecrã não desenha o quadro de assinatura, e o passo7 recusaria a carga
   * com "assine no quadro" — resposta certa à pergunta errada. Repete-se aqui
   * e não só no `submeter`, porque a Server Action é um endpoint público.
   */
  if (n === 7 && !(await verificacaoValida(processo.id))) return RECUSA_SEM_OTP;

  /*
   * Passo 2 validado contra dois factos que o formulário não pode enviar:
   * tipoCliente (decide a régua do NIF, D54) e os documentos realmente
   * anexados (Anexos sobe por Server Action à parte, sem `name`). Injetados
   * aqui, e o que a carga trouxer com estes nomes é substituído.
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

  // Zod já garantiu a forma; sem o cast o Drizzle exige o objeto literal completo em vez do espalhado.
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

      // Substituir a lista é mais simples que reconciliar diferenças. Só as
      // do cliente — apagar as do representante aqui também as perderia ao
      // corrigir uma vírgula no nome.
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

      // Trocar para pessoa singular tira o passo 3 do percurso — o que lá
      // estivesse gravado apareceria no PDF de arquivo como se ainda
      // descrevesse o processo, por isso apaga-se.
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
        await base
          .update(dadosFiscais)
          .set({ cae: null, codigoCertidaoPermanente: null, regimeIva: null })
          .where(eq(dadosFiscais.processoId, processo.id));
      }
      break;
    }

    case 2: {
      // tipoCliente e documentos entram no schema só para decidir regras — não
      // são colunas de dados_fiscais, saem antes do INSERT.
      const fiscais = { ...v };
      const ccDeclarado = fiscais.ccDeclarado;
      delete fiscais.tipoCliente;
      delete fiscais.documentos;
      delete fiscais.ccDeclarado;

      if (tipoCliente !== "empresa") {
        fiscais.cae = null;
        fiscais.codigoCertidaoPermanente = null;
        fiscais.regimeIva = null;
      }

      await base
        .insert(dadosFiscais)
        .values(insere<typeof dadosFiscais.$inferInsert>(fiscais))
        .onConflictDoUpdate({
          target: dadosFiscais.processoId,
          set: fiscais as Partial<typeof dadosFiscais.$inferInsert>,
        });

      if (fiscais.docTipo === "cartao_cidadao" && ccDeclarado) {
        // Log the CC declaration specifically for the audit log
        await registarEvento({
          organizacaoId: processo.organizacaoId,
          processoId: processo.id,
          acao: "documento.cc_declarado",
          entidade: "processo_onboarding",
          entidadeId: processo.id,
          valorNovo: { finalidade: "Identificação (AML)" },
          ip,
          userAgent,
        });
      }
      break;
    }

    case 3: {
      const { eRepresentante, nacionalidades } = v as {
        eRepresentante: boolean;
        nacionalidades: string[];
      };

      // Campo vazio chega como string vazia; numa coluna date isso rebenta — por isso vira null.
      const texto = (campo: string) => {
        const bruto = v[campo];
        return typeof bruto === "string" && bruto ? bruto : null;
      };

      // Com "Sim" o passo grava-se à mesma, interruptor true e resto null —
      // linha em branco prova que a pergunta foi feita; ausência de linha não
      // distingue isso de "ainda não chegou aqui".
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

      // PPE declarada força risco elevado — e o inverso também tem de valer:
      // antes, corrigir de Sim para Não deixava o processo elevado para
      // sempre. O risco não aparece em UI (D21), por isso um erro aqui só se
      // vê num relatório.
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

      // Versão do articulado gravada junto da aceitação, vinda de
      // termosEmVigor (a mesma função que decidiu o que o ecrã mostrou) — sem
      // isto uma versão nova apagava a diferença entre o texto lido e o atual
      // (D3/D38). Só quando aceitou de facto.
      if (fecho.tcAceitacao) {
        fecho.tcVersao = (await termosEmVigor(processo.organizacaoId)).versao;
      }

      await base
        .insert(fechoProposta)
        .values(insere<typeof fechoProposta.$inferInsert>(fecho))
        .onConflictDoUpdate({
          target: fechoProposta.processoId,
          set: fecho as Partial<typeof fechoProposta.$inferInsert>,
        });

      // O que se assina é o conteúdo, não o botão: hash do dossier inteiro em
      // serialização canónica — um campo alterado depois disto não bate.
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

  // passo_atual não anda para trás (D58): sem o max, corrigir o passo 2 via
  // link "Corrigir" da revisão devolvia um processo no passo 7 para o passo 3.
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
 * Verificação do fecho (D57). O link mágico é o único fator até aqui, e é um
 * segredo que viaja por email e se cola em conversas — quem o apanhe assina em
 * nome do cliente. O código exige provar, no momento de assinar, acesso à
 * caixa de correio; não é autenticação forte, é um segundo fator sobre o
 * mesmo canal, contra o caso real de um link reencaminhado.
 */

/** Quanto tempo o código serve depois de gerado. */
const VALIDADE_OTP_MINUTOS = 10;

/**
 * Prazo da verificação — maior que o do código de propósito: entre acertar o
 * código e submeter há T&C, proposta e rubrica para ler, e repetir a
 * verificação a meio disso viraria obstáculo. Uma hora fecha o passo sem valer
 * no dia seguinte.
 */
const VALIDADE_VERIFICACAO_MINUTOS = 60;

/** Ao quinto engano o código morre: seis dígitos são um milhão de hipóteses. */
const MAX_TENTATIVAS_OTP = 5;

/** Intervalo mínimo entre dois pedidos de código, em segundos. */
const INTERVALO_REENVIO_S = 60;

/**
 * Teto diário de códigos por processo. O intervalo de 60s limita o ritmo, não
 * o total — sem teto, 1440 códigos/dia dão 7200 tentativas contra um milhão.
 * Com 5/dia, o orçamento fica em 25 hipóteses; e o botão "Enviar código" não
 * vira gerador de emails à custa da quota da sociedade.
 */
const MAX_CODIGOS_POR_DIA = 5;

/**
 * Verificações por minuto, por processo — amortecedor à frente do limite duro
 * de `tentativas`: sem ele, um script esgota as cinco tentativas em
 * milissegundos, e cada verificação já custa uma consulta e uma escrita de auditoria.
 */
const MAX_VERIFICACOES_POR_MINUTO = 10;

/**
 * Código nunca gravado em claro; o processo entra como sal — sem ele, dois
 * processos com o mesmo código de seis dígitos partilhavam hash e uma tabela
 * arco-íris de um milhão de linhas resolvia-os todos (mesma regra do token, D4).
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
 * `joao.silva@exemplo.pt` → `j••••••••a@exemplo.pt`. O cliente já sabe o seu
 * endereço; isto evita que um link reencaminhado revele o endereço completo a
 * quem o abrir.
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

/** Quantos códigos este processo já pediu nas últimas 24 horas. */
async function codigosDoDia(processoId: string): Promise<number> {
  const desde = new Date(Date.now() - 24 * 60 * 60_000);
  const [linha] = await db()
    .select({ total: count() })
    .from(codigoOtp)
    .where(and(eq(codigoOtp.processoId, processoId), gte(codigoOtp.criadoEm, desde)));
  return Number(linha?.total ?? 0);
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
 * Há uma verificação válida para este processo? Pergunta feita à base de
 * dados, não ao estado do browser — `submeter` é um endpoint público como
 * qualquer outro.
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
 * Gera um código, grava o hash e manda por email. Pedido explícito, não
 * automático ao entrar no passo — o passo 7 é revisitado, e um envio por
 * visita encheria a caixa do cliente e gastaria a quota do fornecedor.
 */
export async function enviarCodigoOtp(bruto: string): Promise<ResultadoOtp> {
  const acesso = await acessoPorToken(bruto);
  if (acesso.estado !== "ok") {
    const { titulo, descricao } = motivoDoAcesso(acesso);
    return { ok: false, erro: `${titulo} ${descricao}` };
  }

  const { processo } = acesso;
  if (
    processo.estado !== "rascunho" &&
    processo.estado !== "pendente_cliente" &&
    processo.estado !== "em_revisao"
  ) {
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

  // No máximo um pedido por minuto — sem isto o botão vira um gerador de
  // emails à custa da quota da sociedade.
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

  // Teto diário contado na base de dados, não em memória — um contentor
  // reinicia, e um limite que se apaga com o reinício contorna-se sozinho.
  const doDia = await codigosDoDia(processo.id);
  if (doDia >= MAX_CODIGOS_POR_DIA) {
    await registarEvento({
      organizacaoId: processo.organizacaoId,
      processoId: processo.id,
      acao: "otp.limite_diario",
      entidade: "codigo_otp",
      entidadeId: processo.id,
      valorNovo: { pedidos: doDia, maximo: MAX_CODIGOS_POR_DIA },
      ...(await contexto()),
    });
    return {
      ok: false,
      erro: `Já foram pedidos ${MAX_CODIGOS_POR_DIA} códigos para este processo nas últimas 24 horas. Contacte a sociedade para concluir a submissão.`,
    };
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

  const [org] = await db()
    .select({
      id: organizacao.id,
      logotipoDados: organizacao.logotipoDados,
      logotipoAtualizadoEm: organizacao.logotipoAtualizadoEm,
    })
    .from(organizacao)
    .where(eq(organizacao.id, processo.organizacaoId))
    .limit(1);

  const envio = await enviarEmail({
    para: destino,
    assunto: ASSUNTO_OTP,
    html: emailCodigoOtp({
      nome: identificacao?.nome,
      codigo,
      referencia: processo.referencia,
      minutos: VALIDADE_OTP_MINUTOS,
      logotipoUrl: urlLogotipoSociedade(org),
    }),
    template: "otp",
    organizacaoId: processo.organizacaoId,
    processoId: processo.id,
  });

  const { ip, userAgent } = await contexto();

  // Código nunca entra em auditoria, nem mascarado: registo imutável de sete
  // anos não é sítio para um segredo de dez minutos. Fica só que foi pedido,
  // para onde, e se saiu.
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

  const { ip, userAgent } = await contexto();

  /*
   * O amortecedor, à frente do limite duro.
   *
   * Dez verificações por minuto por processo (e por IP, quando há IP) não
   * incomodam ninguém a escrever seis dígitos à mão, e tiram ao martelo a única
   * coisa que ele tem: velocidade. Fica **antes** de qualquer consulta, para
   * que um endpoint martelado não seja também uma consulta e uma escrita de
   * auditoria por cada golpe.
   */
  const veredicto = consumir(`otp:verificar:${processo.id}:${ip ?? "sem-ip"}`, MAX_VERIFICACOES_POR_MINUTO, 60_000);
  if (!veredicto.permitido) {
    return {
      ok: false,
      erro: `Demasiadas tentativas seguidas. Aguarde ${veredicto.esperarSegundos} segundos e tente de novo.`,
    };
  }

  const linha = await ultimoCodigo(processo.id);
  if (!linha) {
    return { ok: false, erro: "Ainda não pediu nenhum código. Carregue em «Enviar código»." };
  }

  // Um código já acertado só vale enquanto a verificação valer — devolver
  // "ok" sempre depois do acerto contrariava o verificacaoValida que trava a
  // submissão.
  if (linha.verificadoEm) {
    if (await verificacaoValida(processo.id)) return { ok: true };
    return {
      ok: false,
      erro: `A verificação anterior caducou (vale ${VALIDADE_VERIFICACAO_MINUTOS} minutos). Peça um novo código.`,
    };
  }

  if (linha.expiraEm <= new Date()) {
    return { ok: false, erro: "Este código expirou. Peça um novo código." };
  }

  // Tentativa consumida antes da comparação, num só UPDATE ... WHERE
  // tentativas < 5 — um read-modify-write em JS deixava dez pedidos
  // simultâneos lerem todos 0 e passarem todos, sem limite real.
  const [consumida] = await db()
    .update(codigoOtp)
    .set({ tentativas: sql`${codigoOtp.tentativas} + 1` })
    .where(and(eq(codigoOtp.id, linha.id), lt(codigoOtp.tentativas, MAX_TENTATIVAS_OTP)))
    .returning({ tentativas: codigoOtp.tentativas });

  if (!consumida) {
    return {
      ok: false,
      erro: `Este código foi bloqueado ao fim de ${MAX_TENTATIVAS_OTP} tentativas. Peça um novo código.`,
    };
  }

  const tentativas = Number(consumida.tentativas);

  if (!hashesIguais(linha.codigoHash, hashCodigo(processo.id, codigo))) {
    // Tentativas falhadas ficam em auditoria: único sinal de alguém a
    // martelar o código de outra pessoa.
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
    .set({ verificadoEm: new Date() })
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

  if (
    processo.estado !== "rascunho" &&
    processo.estado !== "pendente_cliente" &&
    processo.estado !== "em_revisao"
  ) {
    return {
      ok: false,
      erros: {},
      mensagem: "Este processo já foi submetido e não pode ser alterado.",
    };
  }

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

  const [propostaDoc] = await db()
    .select({ id: documento.id })
    .from(documento)
    .where(
      and(
        eq(documento.processoId, processo.id),
        eq(documento.tipo, "proposta_comercial"),
        isNull(documento.apagadoEm),
      ),
    )
    .limit(1);

  if (!propostaDoc) {
    return {
      ok: false,
      erros: {
        propostaAceitacao: [
          "A sociedade ainda não anexou a proposta deste processo. Para continuar, contacte-a.",
        ],
      },
      mensagem: "A sociedade ainda não anexou a proposta deste processo.",
    };
  }

  if (!fecho?.declaracaoVeracidade) {
    return {
      ok: false,
      erros: { declaracaoVeracidade: ["Tem de aceitar a declaração final."] },
    };
  }

  // A rubrica é a prova de quem assinou — a caixa de verificação sozinha não vale nada.
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

  // Segunda fechadura na mesma porta — submeter é uma Server Action à parte,
  // chamável por si, e uma rubrica antiga sem verificação válida não passa aqui.
  if (!(await verificacaoValida(processo.id))) return RECUSA_SEM_OTP;

  const { ip, userAgent } = await contexto();

  // `returning` e não um segundo SELECT: o resumo em PDF precisa da data de
  // submissão, e a linha em memória ainda a tem a null.
  //
  // Estado passa a aguardar_aprovacao, não submetido — fluxo de aprovação de
  // volta (D20 apagou-o, esta atualização repõe-no); espera decisão de sócio
  // ou advogado.
  //
  // Guarda de estado no próprio UPDATE: entre o SELECT do acesso e aqui,
  // outro pedido (duplo clique, dois separadores) pode ter submetido o mesmo processo.
  const [submetido] = await db()
    .update(processoOnboarding)
    .set({ estado: "aguardar_aprovacao", submetidoEm: new Date() })
    .where(
      and(
        eq(processoOnboarding.id, processo.id),
        inArray(processoOnboarding.estado, ["rascunho", "pendente_cliente", "em_revisao"]),
      ),
    )
    .returning();

  if (!submetido) {
    return {
      ok: false,
      erros: {},
      mensagem: "Este processo já foi submetido e não pode ser alterado.",
    };
  }

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

  // Guardado mesmo que notificarSubmissao lance (o env() do aviso interno já
  // lançou antes, D46) — uma submissão gravada não pode virar erro por causa
  // de um email. Mesmo contrato de arquivarNoArmazenamento, abaixo.
  try {
    await notificarSubmissao(processo);
  } catch (e) {
    console.error(`[email] ${processo.referencia}: os emails de submissão não correram`, e);
  }
  await arquivarNoArmazenamento(submetido);

  revalidatePath(`/onboarding/${token}`, "layout");
  return { ok: true, proximo: null };
}

/**
 * Pasta do cliente no destino da sociedade, após o processo submetido. Mesmo
 * contrato dos emails: o processo já está gravado, nada aqui pode virar erro.
 * A falha vai para evento_auditoria (`armazenamento.erro`) e aparece na
 * configuração do back-office.
 */
async function arquivarNoArmazenamento(processo: typeof processoOnboarding.$inferSelect) {
  try {
    // Esperado, não disparado e esquecido: um `void promessa()` morre com a
    // resposta, e a sincronização desapareceria a meio sem rasto.
    const { sincronizarCliente } = await import("@/lib/storage/sincronizar");
    await sincronizarCliente(processo);
  } catch (e) {
    // `sincronizarCliente` já não lança; isto cobre o próprio import falhar.
    console.error("[armazenamento] sincronização não chegou a correr", e);
  }
}

/**
 * Emails da submissão: confirmação de receção ao cliente e aviso à sociedade.
 * Nenhum impede a submissão — daí Promise.allSettled e nada a lançar.
 *
 * As boas-vindas (três anexos) não vão aqui: com o fluxo de aprovação de
 * volta (D20 apagou-o, esta atualização repõe-no), saem em `aprovarProcesso`
 * (`enviarBoasVindas`, `@/lib/emails/boas-vindas`).
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

  // Primeiro destino é o email geral da própria sociedade — EMAIL_NOTIFICACOES
  // é variável única de instalação, e numa plataforma multi-sociedade
  // entregaria dossiers de uma à caixa de outra. Fica só como recuo.
  //
  // Dentro de try porque env() lança e validaria o ambiente inteiro três
  // linhas antes dos emails ao cliente entrarem na fila — o aviso interno é
  // acessório, não pode derrubar o principal.
  let emailSociedade: string | undefined;
  try {
    const [dona] = await base
      .select({ email: organizacao.emailGeral })
      .from(organizacao)
      .where(eq(organizacao.id, processo.organizacaoId))
      .limit(1);
    emailSociedade = dona?.email?.trim() || undefined;
  } catch (e) {
    console.error("[email] não foi possível ler o contacto da sociedade", e);
  }

  // Sem valor por omissão (D37) — sem destino configurado, o aviso simplesmente
  // não sai; os emails ao cliente e o arquivo não dependem disto.
  let emailBackoffice = emailSociedade;
  if (!emailBackoffice) {
    try {
      emailBackoffice = env().EMAIL_NOTIFICACOES;
    } catch (e) {
      console.error("[email] o ambiente não valida — o aviso ao back-office não sai", e);
    }
  }

  const envios: Promise<unknown>[] = [];

  const [org] = await db()
    .select({
      id: organizacao.id,
      nome: organizacao.nome,
      logotipoDados: organizacao.logotipoDados,
      logotipoAtualizadoEm: organizacao.logotipoAtualizadoEm,
      notificarSubmissoesEmail: organizacao.notificarSubmissoesEmail,
    })
    .from(organizacao)
    .where(eq(organizacao.id, processo.organizacaoId))
    .limit(1);

  // Frente P: Notificação in-app no backoffice (badge/sino) — zero emails por omissão
  await registarNotificacao({
    organizacaoId: processo.organizacaoId,
    paraPapel: null,
    titulo: `Novo processo submetido: ${processo.referencia}`,
    corpo: `Foi submetido um novo processo de onboarding (${
      processo.tipoCliente === "empresa" ? "Empresa / Entidade Coletiva" : "Pessoa Singular"
    }).`,
    link: `/processos/${processo.id}`,
  });

  if (emailCliente) {
    const emailResolvido = await resolverEmailCliente({
      organizacaoId: processo.organizacaoId,
      template: "confirmacao_rececao",
      variaveis: {
        nome_cliente: identificacao?.nome,
        referencia: processo.referencia,
        nome_sociedade: org?.nome,
      },
      logotipoUrl: urlLogotipoSociedade(org),
    });

    envios.push(
      enviarEmail({
        para: emailCliente,
        assunto: emailResolvido.assunto,
        html: emailResolvido.html,
        template: "confirmacao_rececao",
        organizacaoId: processo.organizacaoId,
        processoId: processo.id,
      }),
    );
  }

  // Só enviar email ao backoffice se a sociedade tiver ativamente pedido (default OFF)
  if (org?.notificarSubmissoesEmail && emailBackoffice) {
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
  }

  const resultados = await Promise.allSettled(envios);
  for (const resultado of resultados) {
    if (resultado.status === "rejected") {
      console.error("[email] falha ao notificar submissão", resultado.reason);
    }
  }
}
