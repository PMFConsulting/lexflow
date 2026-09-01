import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizacao } from "@/db/schema/organizacao";
import { enviarEmail, type AnexoEmail } from "@/lib/email";
import { urlLogotipoSociedade } from "./moldura";
import { resolverEmailCliente } from "./obter-modelo";
import type { processoOnboarding } from "@/db/schema/processo";

/**
 * Welcome email with three attachments. Sent on approval now (D20 removed
 * approval, this brought it back — was sent on submission in between).
 *
 * `summary.pdf` is generated from the same source as the archive copy. T&C
 * is the accepted wording. The fee proposal is the static PDF in `public/`
 * until per-client proposals exist. A failed attachment does not block the
 * email — it sends with whatever generated, and an honest list.
 */
export async function enviarBoasVindas(
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
      console.error(`[email] attachment "${nomeFicheiro}" was not generated`, e);
    }
  };

  // Labels come from the client's document, verbatim.
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
      const { termosEmVigor } = await import("@/lib/termos-sociedade");
      const termos = await termosEmVigor(processo.organizacaoId);
      
      if (termos.forma === "documento") {
        const { documentoOrganizacao } = await import("@/db/schema/sociedade");
        const { and, isNull } = await import("drizzle-orm");
        
        const [doc] = await db()
          .select({ dados: documentoOrganizacao.dados })
          .from(documentoOrganizacao)
          .where(
            and(
              eq(documentoOrganizacao.id, termos.documentoId),
              eq(documentoOrganizacao.organizacaoId, processo.organizacaoId),
              isNull(documentoOrganizacao.apagadoEm)
            )
          )
          .limit(1);

        if (doc?.dados) {
          return Buffer.from(doc.dados, "base64");
        }
      }
      
      const { gerarTermosPdf } = await import("@/lib/storage/termos-pdf");
      return gerarTermosPdf(new Date());
    },
  );

  const { documento } = await import("@/db/schema/documentos");
  const { and, isNull } = await import("drizzle-orm");
  const [proposta] = await db()
    .select({ nome: documento.nomeOriginal, dados: documento.dados, chaveStorage: documento.chaveStorage })
    .from(documento)
    .where(
      and(
        eq(documento.processoId, processo.id),
        eq(documento.tipo, "proposta_comercial"),
        isNull(documento.apagadoEm)
      )
    )
    .limit(1);

  if (proposta) {
    await juntar("Proposta de Honorários", proposta.nome, async () => {
      if (proposta.dados) {
        return Buffer.from(proposta.dados, "base64");
      } else {
        const { destinoDaOrganizacao } = await import("@/lib/storage");
        const ligacao = await destinoDaOrganizacao(processo.organizacaoId);
        if (ligacao?.destino.ler) {
          return ligacao.destino.ler(proposta.chaveStorage);
        }
        throw new Error("Não foi possível ler a proposta comercial do S3");
      }
    });
  } else {
    await juntar("Proposta de Honorários", "proposta_de_honorarios.pdf", async () => {
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      return readFile(join(process.cwd(), "public", "custos.pdf"));
    });
  }

  const [org] = await db()
    .select({
      id: organizacao.id,
      nome: organizacao.nome,
      logotipoDados: organizacao.logotipoDados,
      logotipoMime: organizacao.logotipoMime,
      logotipoAtualizadoEm: organizacao.logotipoAtualizadoEm,
    })
    .from(organizacao)
    .where(eq(organizacao.id, processo.organizacaoId))
    .limit(1);

  const logotipoUrl = urlLogotipoSociedade(org);

  const emailResolvido = await resolverEmailCliente({
    organizacaoId: processo.organizacaoId,
    template: "boas_vindas",
    variaveis: {
      nome_cliente: nome,
      referencia: processo.referencia,
      nome_sociedade: org?.nome,
    },
    logotipoUrl,
    anexosLista: rotulos,
  });

  return enviarEmail({
    para,
    assunto: emailResolvido.assunto,
    html: emailResolvido.html,
    anexos,
    template: "boas_vindas",
    organizacaoId: processo.organizacaoId,
    processoId: processo.id,
  });
}

