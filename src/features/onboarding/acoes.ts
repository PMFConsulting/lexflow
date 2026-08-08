"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { env } from "@/env";
import { enviarEmail, type AnexoEmail } from "@/lib/email";
import {
  ASSUNTO_BOAS_VINDAS,
  ASSUNTO_CONFIRMACAO,
  emailBoasVindas,
  emailConfirmacaoRececao,
} from "@/lib/emails/jmassano";
import { origemPublica } from "@/lib/origem";
import { assinatura } from "@/db/schema/documentos";
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
import { processoPorToken, seccoesDoProcesso } from "./dados";
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

export async function guardarPasso(
  token: string,
  n: number,
  dados: unknown,
): Promise<Resultado> {
  const processo = await processoPorToken(token);
  if (!processo) {
    return {
      ok: false,
      erros: {},
      mensagem: "Este link já não é válido. Peça um novo ao seu contacto.",
    };
  }
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

  const r = schema.safeParse(dados);
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

    case 2:
      await base
        .insert(dadosFiscais)
        .values(insere<typeof dadosFiscais.$inferInsert>(v))
        .onConflictDoUpdate({
          target: dadosFiscais.processoId,
          set: v as Partial<typeof dadosFiscais.$inferInsert>,
        });
      break;

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

  await base
    .update(processoOnboarding)
    .set({ passoAtual: seguinte ?? n })
    .where(eq(processoOnboarding.id, processo.id));

  revalidatePath(`/onboarding/${token}`, "layout");
  return { ok: true, proximo: seguinte };
}

/** Submissão final: fecha o processo e passa-o para a fila de revisão. */
export async function submeter(token: string): Promise<Resultado> {
  const processo = await processoPorToken(token);
  if (!processo) {
    return { ok: false, erros: {}, mensagem: "Este link já não é válido." };
  }

  const [fecho] = await db()
    .select()
    .from(fechoProposta)
    .where(eq(fechoProposta.processoId, processo.id))
    .limit(1);

  if (!fecho?.tcAceitacao) {
    return {
      ok: false,
      erros: { tcAceitacao: ["Tem de aceitar os Termos e Condições e a proposta."] },
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

  const { ip, userAgent } = await contexto();

  // `returning` e não um segundo SELECT: o resumo em PDF precisa da data de
  // submissão, e a linha que já estava em memória ainda a tem a null.
  const [submetido] = await db()
    .update(processoOnboarding)
    .set({ estado: "submetido", submetidoEm: new Date() })
    .where(eq(processoOnboarding.id, processo.id))
    .returning();

  await registarEvento({
    organizacaoId: processo.organizacaoId,
    processoId: processo.id,
    acao: "processo.submetido",
    entidade: "processo_onboarding",
    entidadeId: processo.id,
    valorAnterior: { estado: processo.estado },
    valorNovo: { estado: "submetido" },
    ip,
    userAgent,
  });

  await notificarSubmissao(processo);
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
 * Dois para o cliente — a confirmação de receção e, logo a seguir, as
 * boas-vindas com os anexos — e um para a sociedade. Nenhum deles pode impedir
 * a submissão: o processo já está gravado, e um erro do Resend não transforma
 * um formulário bem preenchido num ecrã de erro. Daí o `Promise.allSettled` e o
 * facto de nada aqui lançar.
 *
 * A confirmação e as boas-vindas vão as duas na submissão porque a POC não tem
 * passo de aprovação (D20) — não há um segundo momento em que dar as
 * boas-vindas. Se o fluxo de aprovação voltar, o segundo email muda de sítio,
 * não de conteúdo.
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
  const nomeCliente = identificacao?.nome ?? null;

  // Sem valor por omissão. Aqui estava um endereço pessoal escrito à mão, e
  // numa instalação a que faltasse a variável eram os dados de processos de
  // clientes — referência, tipo, link para o dossier — a sair para a caixa de
  // correio de quem escreveu o código. Não havendo destino configurado, o
  // aviso não sai: os dois emails ao cliente e o arquivo não dependem disto.
  const emailBackoffice = env().EMAIL_NOTIFICACOES;

  const envios: Promise<unknown>[] = [];

  if (emailCliente) {
    envios.push(
      enviarEmail({
        para: emailCliente,
        assunto: ASSUNTO_CONFIRMACAO,
        html: emailConfirmacaoRececao(),
        template: "confirmacao_rececao",
        organizacaoId: processo.organizacaoId,
        processoId: processo.id,
      }),
    );

    envios.push(enviarBoasVindas(processo, emailCliente, nomeCliente));
  }

  if (emailBackoffice) {
    // O anfitrião sai dos cabeçalhos do pedido, como o link do email de
    // registo: estava aqui `https://poc.terlicalabs.com` escrito à mão, e numa
    // segunda instalação o aviso mandava a equipa para o dossier da primeira.
    const endereco = await origemPublica();
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

/**
 * O email de boas-vindas, com os três anexos.
 *
 * O resumo das informações é o mesmo `summary.pdf` que vai para a pasta do
 * cliente no arquivo — gerado do mesmo sítio, para o cliente e a sociedade não
 * ficarem com versões diferentes do mesmo documento. Os T&C são a cópia do
 * articulado que ele aceitou. A proposta de honorários é o PDF que está em
 * `public/`, e é o único dos três que não é gerado: enquanto não houver
 * proposta por cliente, é o mesmo documento para todos.
 *
 * Um anexo que falhe a gerar-se não trava o email — vale mais chegar com dois
 * anexos e uma lista honesta do que não chegar de todo.
 */
async function enviarBoasVindas(
  processo: typeof processoOnboarding.$inferSelect,
  para: string,
  nome: string | null,
) {
  const anexos: AnexoEmail[] = [];
  const rotulos: string[] = [];

  const juntar = async (
    rotulo: string,
    nomeFicheiro: string,
    produzir: () => Promise<Buffer>,
  ) => {
    try {
      anexos.push({ nome: nomeFicheiro, conteudo: await produzir() });
      rotulos.push(rotulo);
    } catch (e) {
      console.error(`[email] anexo "${nomeFicheiro}" não foi gerado`, e);
    }
  };

  // Os rótulos são os do documento de análise do cliente: é esta a lista que
  // ele escreveu no corpo do email de boas-vindas.
  await juntar(
    "Resumo das informações fornecidas durante o processo de registo",
    "resumo_do_processo.pdf",
    async () => {
      const { resumoDoProcesso } = await import("@/lib/storage/sincronizar");
      return resumoDoProcesso(processo);
    },
  );

  await juntar(
    "Termos e Condições de Prestação de Serviços (T&C)",
    "termos_e_condicoes.pdf",
    async () => {
      const { gerarTermosPdf } = await import("@/lib/storage/termos-pdf");
      return gerarTermosPdf(new Date());
    },
  );

  await juntar("Proposta de Honorários", "proposta_de_honorarios.pdf", async () => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    return readFile(join(process.cwd(), "public", "custos.pdf"));
  });

  return enviarEmail({
    para,
    assunto: ASSUNTO_BOAS_VINDAS,
    html: emailBoasVindas({ nome, referencia: processo.referencia, anexos: rotulos }),
    anexos,
    template: "boas_vindas",
    organizacaoId: processo.organizacaoId,
    processoId: processo.id,
  });
}
