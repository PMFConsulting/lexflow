import "server-only";
import { enviarEmail, type AnexoEmail } from "@/lib/email";
import { ASSUNTO_BOAS_VINDAS, emailBoasVindas } from "./jmassano";
import type { processoOnboarding } from "@/db/schema/processo";

/**
 * O email de boas-vindas, com os três anexos.
 *
 * Partilhado entre a submissão e a aprovação: até à reposição do fluxo de
 * aprovação (D20 apagou-o; esta atualização repõe-no) ia na submissão, porque
 * não havia um segundo momento em que dar as boas-vindas. Com a aprovação de
 * volta, esse segundo momento existe — é ele quem passa a enviar isto — e a
 * função muda de sítio, não de conteúdo.
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
