"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { env } from "@/env";
import { enviarEmail } from "@/lib/email";
import { assinatura } from "@/db/schema/documentos";
import { processoOnboarding } from "@/db/schema/processo";
import {
  dadosFaturacao,
  dadosFiscais,
  dadosIdentificacao,
  declaracaoPpe,
  fechoProposta,
  nacionalidade,
  relacaoNegocio,
} from "@/db/schema/seccoes";
import { canonico } from "@/features/auditoria/hash";
import { registarEvento } from "@/features/auditoria/registar";
import { registarConsentimento } from "./consentimentos";
import { processoPorToken, seccoesDoProcesso } from "./dados";
import { SCHEMAS } from "./schemas";
import { proximoPasso } from "./passos";

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
      const { tipoCliente, nacionalidades, ...resto } = v as {
        tipoCliente: "particular" | "empresa";
        nacionalidades: string[];
      } & Linha;

      await base
        .insert(dadosIdentificacao)
        .values(insere<typeof dadosIdentificacao.$inferInsert>(resto))
        .onConflictDoUpdate({
          target: dadosIdentificacao.processoId,
          set: resto as Partial<typeof dadosIdentificacao.$inferInsert>,
        });

      // As nacionalidades são uma lista: substituir é mais simples e correto do
      // que tentar reconciliar diferenças.
      await base.delete(nacionalidade).where(eq(nacionalidade.processoId, processo.id));
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

      // Regra de negócio que não é opcional: PPE declarada força risco elevado
      // e tira a aprovação das mãos de quem não é sócio.
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
      break;
    }

    case 4:
      await base
        .insert(dadosFaturacao)
        .values(insere<typeof dadosFaturacao.$inferInsert>(v))
        .onConflictDoUpdate({
          target: dadosFaturacao.processoId,
          set: v as Partial<typeof dadosFaturacao.$inferInsert>,
        });
      break;

    case 5: {
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

  const seguinte = proximoPasso(n);

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

  const { ip, userAgent } = await contexto();

  await db()
    .update(processoOnboarding)
    .set({ estado: "submetido", submetidoEm: new Date() })
    .where(eq(processoOnboarding.id, processo.id));

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

  revalidatePath(`/onboarding/${token}`, "layout");
  return { ok: true, proximo: null };
}

/**
 * Emails de confirmação depois de o processo já estar submetido — uma falha
 * de envio não pode impedir a submissão, por isso vive à parte e nunca lança.
 */
async function notificarSubmissao(processo: typeof processoOnboarding.$inferSelect) {
  const base = db();

  const [identificacao] = await base
    .select({ email: dadosIdentificacao.email })
    .from(dadosIdentificacao)
    .where(eq(dadosIdentificacao.processoId, processo.id))
    .limit(1);

  const [faturacao] = await base
    .select({ email: dadosFaturacao.email })
    .from(dadosFaturacao)
    .where(eq(dadosFaturacao.processoId, processo.id))
    .limit(1);

  const emailCliente = identificacao?.email ?? faturacao?.email;
  const emailBackoffice = env().EMAIL_NOTIFICACOES ?? "ummgames88@gmail.com";

  const envios: Promise<unknown>[] = [];

  if (emailCliente) {
    envios.push(
      enviarEmail({
        para: emailCliente,
        assunto: `Processo ${processo.referencia} submetido com sucesso`,
        html: `
          <p>O seu processo <strong>${processo.referencia}</strong> foi submetido com sucesso.</p>
          <p>A nossa equipa vai analisar os dados e documentos enviados. Entraremos em
          contacto caso seja necessária alguma informação adicional.</p>
        `,
      }),
    );
  }

  envios.push(
    enviarEmail({
      para: emailBackoffice,
      assunto: `Novo processo submetido: ${processo.referencia}`,
      html: `
        <p>Foi submetido um novo processo de onboarding.</p>
        <ul>
          <li>Referência: <strong>${processo.referencia}</strong></li>
          <li>Tipo de cliente: ${processo.tipoCliente}</li>
        </ul>
        <p><a href="https://poc.terlicalabs.com/processos/${processo.id}">Ver processo no back-office</a></p>
      `,
    }),
  );

  const resultados = await Promise.allSettled(envios);
  for (const resultado of resultados) {
    if (resultado.status === "rejected") {
      console.error("[email] falha ao notificar submissão", resultado.reason);
    }
  }
}
