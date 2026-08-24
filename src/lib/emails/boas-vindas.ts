import "server-only";
import { enviarEmail, type AnexoEmail } from "@/lib/email";
import { ASSUNTO_BOAS_VINDAS, emailBoasVindas } from "./jmassano";
import type { processoOnboarding } from "@/db/schema/processo";

/**
 * The welcome email, with its three attachments.
 *
 * Shared between submission and approval: until the approval flow was restored
 * (D20 deleted it; this update brings it back) it went out on submission,
 * because there was no second moment at which to welcome anyone. With approval
 * back, that second moment exists — it is the one that now sends this — and the
 * function changes place, not content.
 *
 * The summary of the information is the same `summary.pdf` that goes to the
 * client's folder in the archive — generated from the same place, so the client
 * and the firm do not end up with different versions of the same document. The
 * T&C are a copy of the wording they accepted. The fee proposal is the PDF in
 * `public/`, and it is the only one of the three that is not generated: as long
 * as there is no per-client proposal, it is the same document for everyone.
 *
 * An attachment that fails to generate does not stop the email — it is worth
 * more to arrive with two attachments and an honest list than not to arrive at
 * all.
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

  // The labels are those from the client's analysis document: this is the list
  // they wrote in the body of the welcome email.
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
