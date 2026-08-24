import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { armazenamentoSociedade } from "@/db/schema/armazenamento";
import { documento } from "@/db/schema/documentos";
import type { processoOnboarding } from "@/db/schema/processo";
import { registarEvento } from "@/features/auditoria/registar";
import { seccoesDoProcesso } from "@/features/onboarding/dados";
import { gerarCapaPdf } from "./capa";
import { destinoDaOrganizacao } from "./index";
import { gerarResumoPdf, type DadosResumo } from "./resumo";
import { mensagemSegura, nomeDaPasta } from "./sanitizacao";
import { nomeSeguro, nomeSeguroDeFicheiro, type Ficheiro } from "./tipos";

/**
 * After a matter is submitted: one folder per client, at the firm's
 * destination, with the summary and the attachments the client uploaded.
 *
 * The rule that governs everything else in this file: **this never blocks a
 * submission**. The client has already filled in every screen and uploaded
 * their ID card; a password changed on the firm's side cannot be what shows up
 * at the end. Whatever fails is recorded in `evento_auditoria` with the
 * `armazenamento.erro` action and in the configuration's `ultimo_erro` column,
 * which is what the back-office shows.
 */

export type ResultadoSincronizacao =
  | { ok: true; ignorado: true; motivo: string }
  | { ok: true; ignorado: false; pasta: string; ficheiros: number }
  | { ok: false; erro: string };

const SUMARIO = "summary.pdf";

/**
 * The folder's cover page. The name is not our choice: it is what the Python
 * helper already left in each client folder, and it is what the case file is
 * searched by.
 */
const CAPA = "dados_cliente.pdf";

/**
 * The summary's data, read from the matter.
 *
 * Separate from the sync because the same summary goes out by two paths — the
 * folder in the archive and the welcome email's attachment — and the client and
 * the firm cannot end up with different versions of the same document.
 */
async function dadosDoResumo(
  processo: typeof processoOnboarding.$inferSelect,
): Promise<DadosResumo> {
  const seccoes = await seccoesDoProcesso(processo.id);

  return {
    referencia: processo.referencia,
    nome: seccoes.identificacao?.nome ?? "Sem nome",
    tipoCliente: processo.tipoCliente,
    nif: seccoes.fiscais?.nif ?? null,
    email: seccoes.identificacao?.email ?? null,
    telefone: seccoes.identificacao?.telefone ?? null,
    nacionalidades: seccoes.nacionalidades,
    servicos: seccoes.negocio?.servicos ?? null,
    faturacaoNome: seccoes.faturacao?.nome ?? null,
    faturacaoNif: seccoes.faturacao?.nif ?? null,
    faturacaoEmail: seccoes.faturacao?.email ?? null,
    origemContacto: seccoes.preferencias?.origemContacto ?? null,
    areasInteresse: seccoes.areasInteresse,
    newsletter: seccoes.preferencias?.newsletter ?? false,
    submetidoEm: processo.submetidoEm,
    documentos: seccoes.documentos.map((d) => ({
      nome: d.nome,
      tipo: d.tipo,
      bytes: d.bytes,
    })),
    geradoEm: new Date(),
  };
}

/** A matter's `summary.pdf`, for whoever wants it outside the sync. */
export async function resumoDoProcesso(
  processo: typeof processoOnboarding.$inferSelect,
): Promise<Buffer> {
  return gerarResumoPdf(await dadosDoResumo(processo));
}

export async function sincronizarCliente(
  processo: typeof processoOnboarding.$inferSelect,
): Promise<ResultadoSincronizacao> {
  const ligacao = await destinoDaOrganizacao(processo.organizacaoId);
  if (!ligacao) {
    // With no credentials configured there is nothing to do, and it is not an
    // error: it is the starting state of a new installation.
    return { ok: true, ignorado: true, motivo: "Armazenamento por configurar." };
  }

  const { destino, config } = ligacao;
  const base = db();

  try {
    const dados = await dadosDoResumo(processo);

    const pasta = nomeDaPasta(dados.nome, dados.nif);
    const raiz = config.pastaRaiz.split("/").filter(Boolean).map((s) => nomeSeguro(s, "Clientes"));
    const segmentos = [...raiz, pasta, processo.referencia];

    await destino.garantirPasta(segmentos);

    const ficheiros: Ficheiro[] = [
      {
        nome: SUMARIO,
        mime: "application/pdf",
        conteudo: await gerarResumoPdf(dados),
      },
    ];

    // The attachments are only read now — they are megabytes per matter and do
    // not have to cross the server just to draw the summary.
    const anexos = await base
      .select({
        nome: documento.nomeOriginal,
        mime: documento.mime,
        dados: documento.dados,
      })
      .from(documento)
      .where(and(eq(documento.processoId, processo.id), isNull(documento.apagadoEm)));

    const usados = new Set<string>([SUMARIO.toLowerCase(), CAPA.toLowerCase()]);
    for (const anexo of anexos) {
      if (!anexo.dados) continue;

      // Two attachments with the same name cannot overwrite each other inside
      // the folder.
      let nome = nomeSeguroDeFicheiro(anexo.nome);
      let n = 2;
      while (usados.has(nome.toLowerCase())) {
        const ponto = nome.lastIndexOf(".");
        const corpo = ponto > 0 ? nome.slice(0, ponto) : nome;
        const extensao = ponto > 0 ? nome.slice(ponto) : "";
        nome = `${corpo} (${n})${extensao}`;
        n += 1;
      }
      usados.add(nome.toLowerCase());

      ficheiros.push({
        nome,
        mime: anexo.mime,
        conteudo: Buffer.from(anexo.dados, "base64"),
      });
    }

    // The cover is the last to be generated and the first to enter the folder:
    // only here is it known which files it has to index. It does not index
    // itself — its size does not yet exist when the content is drawn.
    ficheiros.unshift({
      nome: CAPA,
      mime: "application/pdf",
      conteudo: await gerarCapaPdf({
        referencia: processo.referencia,
        nome: dados.nome,
        nif: dados.nif,
        submetidoEm: processo.submetidoEm,
        geradoEm: dados.geradoEm,
        ficheiros: ficheiros.map((f) => ({ nome: f.nome, bytes: f.conteudo.byteLength })),
      }),
    });

    // In series and not in parallel: there are few files, and each opens its
    // own SSH session — in parallel, the server cuts connections mid-upload.
    for (const ficheiro of ficheiros) {
      await destino.enviar(segmentos, ficheiro);
    }

    await base
      .update(armazenamentoSociedade)
      .set({ ultimaSincronizacaoEm: new Date(), ultimoErro: null })
      .where(eq(armazenamentoSociedade.id, config.id));

    await registarEvento({
      organizacaoId: processo.organizacaoId,
      processoId: processo.id,
      acao: "armazenamento.sincronizado",
      entidade: "armazenamento_sociedade",
      entidadeId: config.id,
      valorNovo: {
        pasta: segmentos.join("/"),
        ficheiros: ficheiros.map((f) => f.nome),
      },
    });

    return { ok: true, ignorado: false, pasta: segmentos.join("/"), ficheiros: ficheiros.length };
  } catch (e) {
    const erro = mensagemSegura(e);
    console.error(`[storage] failed to sync ${processo.referencia}: ${erro}`);

    // Recording the failure cannot blow up over the submission either.
    try {
      await base
        .update(armazenamentoSociedade)
        .set({ ultimoErro: erro })
        .where(eq(armazenamentoSociedade.id, config.id));

      await registarEvento({
        organizacaoId: processo.organizacaoId,
        processoId: processo.id,
        acao: "armazenamento.erro",
        entidade: "armazenamento_sociedade",
        entidadeId: config.id,
        valorNovo: { erro },
      });
    } catch (interno) {
      console.error("[storage] failed to record the error", mensagemSegura(interno));
    }

    return { ok: false, erro };
  }
}
