"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { documento } from "@/db/schema/documentos";
import { processoOnboarding } from "@/db/schema/processo";
import { registarEvento } from "@/features/auditoria/registar";
import { assinaturaConfere, mensagemConteudo } from "@/features/onboarding/formatos";
import { exigirEquipaOuSuperAdmin, podeAcederSociedade } from "@/lib/sessao";

/**
 * A proposta comercial que segue com o convite.
 *
 * Até aqui o passo 7 mostrava sempre o mesmo documento — o `/custos.html` que
 * vive em `public/`, igual para toda a gente. Isso serve para demonstrar o
 * mecanismo e não serve para trabalhar: a proposta é o documento que fixa o que
 * **este** cliente vai pagar, e o cliente estava a aceitar uma proposta que não
 * era a dele. É a única aceitação do fecho em que o documento aceite não
 * correspondia ao que a sociedade negociou.
 *
 * O upload é do lado da sociedade e não do cliente, e por isso não passa pelo
 * `documentos.ts` do onboarding: aqui há sessão, papel e organização a
 * verificar, e lá há um token mágico. São duas portas com duas fechaduras.
 *
 * Só PDF. Os anexos do cliente aceitam fotografias porque o que se lhe pede é o
 * cartão de cidadão tirado com o telemóvel; uma proposta comercial é um
 * documento que a sociedade produz, e um JPEG de uma proposta é uma proposta que
 * ninguém consegue ler no ecrã nem imprimir sem perder metade.
 */

/** O mesmo tamanho dos anexos do cliente: o `bodySizeLimit` são 6 MB (base64 incluído). */
const MAX_BYTES = 4 * 1024 * 1024;

export type ResultadoProposta =
  | { ok: true; id: string; nome: string; bytes: number }
  | { ok: false; erro: string };

export async function carregarPropostaComercial(
  processoId: string,
  formData: FormData,
): Promise<ResultadoProposta> {
  const { eu } = await exigirEquipaOuSuperAdmin();

  const ficheiro = formData.get("ficheiro");
  if (!(ficheiro instanceof File) || ficheiro.size === 0) {
    return { ok: false, erro: "Escolha o ficheiro da proposta comercial." };
  }
  if (ficheiro.size > MAX_BYTES) {
    const mb = (ficheiro.size / 1024 / 1024).toFixed(1);
    return { ok: false, erro: `A proposta tem ${mb} MB. O máximo são 4 MB.` };
  }

  // O tipo declarado pelo browser é o primeiro filtro; a extensão fecha o caso
  // do browser que não se compromete. Mesma lógica de `formatos.ts`, reduzida a
  // um formato só — ver a nota em cima.
  const tipo = (ficheiro.type ?? "").trim().toLowerCase();
  const pdfPeloNome = ficheiro.name.toLowerCase().endsWith(".pdf");
  const indeciso = tipo === "" || tipo === "application/octet-stream";
  if (!(tipo === "application/pdf" || (indeciso && pdfPeloNome))) {
    return {
      ok: false,
      erro: `«${ficheiro.name}» não é um PDF. A proposta comercial tem de ser um ficheiro PDF.`,
    };
  }

  const base = db();

  const [processo] = await base
    .select({
      id: processoOnboarding.id,
      organizacaoId: processoOnboarding.organizacaoId,
      referencia: processoOnboarding.referencia,
      estado: processoOnboarding.estado,
    })
    .from(processoOnboarding)
    .where(and(eq(processoOnboarding.id, processoId), isNull(processoOnboarding.apagadoEm)))
    .limit(1);

  // Um processo de outra organização responde o mesmo que um que não existe —
  // a regra da rota de download e do detalhe do processo.
  // O super_admin tem acesso transversal.
  if (!processo || !podeAcederSociedade(eu, processo.organizacaoId)) {
    return { ok: false, erro: "Processo não encontrado." };
  }

  if (processo.estado === "aprovado" || processo.estado === "arquivado") {
    return { ok: false, erro: "Processo aprovado — já não é editável." };
  }

  const bytes = Buffer.from(await ficheiro.arrayBuffer());

  /*
   * Os primeiros bytes, que é a única coisa aqui que quem envia não escolheu.
   *
   * O nome e o MIME vêm ambos do browser, e um ficheiro com HTML lá dentro,
   * chamado `proposta.pdf` e declarado `application/pdf`, passava as duas
   * verificações em cima. Ficava gravado com `mime: "application/pdf"` escrito
   * à mão no INSERT — e a rota `/onboarding/[token]/proposta` serve-o **inline**
   * ao cliente com esse `Content-Type`, porque é para ser lido. É o único
   * ficheiro desta plataforma que é servido inline a alguém, e por isso é o
   * único onde a diferença entre "diz que é PDF" e "é PDF" tem consequência.
   *
   * Cinco bytes: `%PDF-`. Não valida o interior do documento — um PDF com
   * JavaScript continua a ser um PDF —, fecha o degrau de baixo.
   */
  if (!assinaturaConfere("application/pdf", bytes)) {
    console.warn(
      `[proposta] «${ficheiro.name}» diz ser PDF e o conteúdo não começa por %PDF- — recusada.`,
    );
    return { ok: false, erro: mensagemConteudo(ficheiro.name) };
  }

  const hash = createHash("sha256").update(bytes).digest("hex");

  /*
   * Uma proposta de cada vez.
   *
   * Substituir e não acumular: o passo 7 mostra ao cliente **a** proposta, no
   * singular, e duas linhas vivas obrigariam a escolher uma — com a escolha a
   * ser feita por uma ordenação, que é a forma de o cliente aceitar a proposta
   * errada sem ninguém dar por isso. A anterior fica em soft delete, que é o que
   * a retenção obriga e o que permite provar depois qual foi substituída por
   * qual.
   */
  await base
    .update(documento)
    .set({ apagadoEm: new Date() })
    .where(
      and(
        eq(documento.processoId, processo.id),
        eq(documento.tipo, "proposta_comercial"),
        isNull(documento.apagadoEm),
      ),
    );

  const [linha] = await base
    .insert(documento)
    .values({
      processoId: processo.id,
      tipo: "proposta_comercial",
      nomeOriginal: ficheiro.name.slice(0, 200),
      mime: "application/pdf",
      tamanhoBytes: ficheiro.size,
      hashSha256: hash,
      chaveStorage: `processos/${processo.id}/${hash}`,
      dados: bytes.toString("base64"),
      // Ao contrário dos anexos do cliente, este tem autor: foi alguém da
      // sociedade, com sessão iniciada, que o pôs no dossier.
      carregadoPor: eu.id,
    })
    .returning({ id: documento.id, nome: documento.nomeOriginal });

  const h = await headers();
  await registarEvento({
    organizacaoId: processo.organizacaoId,
    processoId: processo.id,
    atorId: eu.id,
    acao: "proposta.carregada",
    entidade: "documento",
    entidadeId: linha.id,
    valorNovo: { nome: linha.nome, bytes: ficheiro.size, hash },
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
  });

  revalidatePath(`/processos/${processo.id}`);

  return { ok: true, id: linha.id, nome: linha.nome, bytes: ficheiro.size };
}
