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
 * Depois de um processo submetido: uma pasta por cliente, no destino da
 * sociedade, com o resumo e os anexos que o cliente carregou.
 *
 * A regra que manda em tudo o resto neste ficheiro: **isto nunca bloqueia uma
 * submissão**. O cliente já preencheu sete ecrãs e carregou o cartão de
 * cidadão; um refresh token expirado do lado da sociedade não pode ser o que
 * lhe aparece no fim. Falha o que falhar, fica em `evento_auditoria` com a
 * ação `armazenamento.erro` e na coluna `ultimo_erro` da configuração, que é
 * o que o back-office mostra.
 */

export type ResultadoSincronizacao =
  | { ok: true; ignorado: true; motivo: string }
  | { ok: true; ignorado: false; pasta: string; ficheiros: number }
  | { ok: false; erro: string };

const SUMARIO = "summary.pdf";

/**
 * A capa da pasta. O nome não é escolha nossa: é o que o auxiliar em Python
 * já deixava em cada pasta do OneDrive, e é por ele que se procura o dossier.
 */
const CAPA = "dados_cliente.pdf";

export async function sincronizarCliente(
  processo: typeof processoOnboarding.$inferSelect,
): Promise<ResultadoSincronizacao> {
  const ligacao = await destinoDaOrganizacao(processo.organizacaoId);
  if (!ligacao) {
    // Sem credenciais configuradas não há nada a fazer, e não é um erro: é o
    // estado de origem de uma instalação nova.
    return { ok: true, ignorado: true, motivo: "Armazenamento por configurar." };
  }

  const { destino, config } = ligacao;
  const base = db();

  try {
    const seccoes = await seccoesDoProcesso(processo.id);

    const dados: DadosResumo = {
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

    // Os anexos só se leem agora — são megabytes por processo e não têm de
    // atravessar o servidor para desenhar o resumo.
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

      // Dois anexos com o mesmo nome não podem esmagar-se dentro da pasta.
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

    // A capa é o último a gerar-se e o primeiro a entrar na pasta: só aqui se
    // sabe que ficheiros ela tem de indexar. Não se indexa a si própria — o
    // tamanho dela ainda não existe quando o conteúdo é desenhado.
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

    // Em série e não em paralelo: são poucos ficheiros, e um OneDrive
    // respondeu com 429 a menos do que isto.
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
        tipo: config.tipo,
        pasta: segmentos.join("/"),
        ficheiros: ficheiros.map((f) => f.nome),
      },
    });

    return { ok: true, ignorado: false, pasta: segmentos.join("/"), ficheiros: ficheiros.length };
  } catch (e) {
    const erro = mensagemSegura(e);
    console.error(`[armazenamento] falha a sincronizar ${processo.referencia}: ${erro}`);

    // O registo da falha também não pode rebentar por cima da submissão.
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
        valorNovo: { tipo: config.tipo, erro },
      });
    } catch (interno) {
      console.error("[armazenamento] falha a registar o erro", mensagemSegura(interno));
    }

    return { ok: false, erro };
  }
}
