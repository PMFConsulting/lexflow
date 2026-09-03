import "server-only";
import { and, count, gte, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { notificacoesPendentes } from "@/db/schema/notificacao";
import { processoOnboarding } from "@/db/schema/processo";
import { enviarEmail } from "@/lib/email";
import {
  ARQUIVO,
  botao,
  escapar,
  FONTE_CORPO,
  FONTE_MONO,
  LINHA,
  moldura,
  p,
  TINTA,
  TINTA_SUAVE,
} from "@/lib/emails/moldura";
import { env } from "@/env";
import { consultarNotificacoesPendentes } from "./consultas";

/**
 * O Resumo Diário ao Dono da plataforma — o consumidor da fila que
 * `notificarDonoSociedadeCriada` e `notificarDonoNovoUtilizador` alimentam.
 *
 * A fila existia e ninguém a lia: as duas funções escreviam em
 * `notificacoes_pendentes` («zero emails imediatos», dizia o comentário),
 * `consultarNotificacoesPendentes` não tinha chamador nenhum, e o
 * `scripts/resumo_diario.mjs` não estava registado em lado nenhum — nem no
 * `package.json`, nem na imagem, nem num cron. O resultado é o pior dos
 * silêncios desta plataforma, do mesmo feitio do D46: a operação principal
 * corria bem, a linha ficava gravada, e o aviso simplesmente nunca saía — sem
 * erro, sem linha em `email_log`, sem nada a que perguntar porquê. Uma
 * sociedade nova podia entrar e ficar semanas sem ninguém do lado da plataforma
 * saber.
 *
 * Esta é a implementação que a aplicação corre (agendada em
 * `src/instrumentation.ts`). O `scripts/resumo_diario.mjs` mantém-se como a via
 * manual — correr o resumo à mão contra a base de dados, sem esperar pela hora.
 */

/** Quantas linhas da fila entram num resumo. O resto fica para o dia seguinte. */
const LIMITE_PENDENTES = 500;

/** Estados que contam como "processo submetido" na contagem das últimas 24h. */
const ESTADOS_SUBMETIDOS = ["aguardar_aprovacao", "aprovado", "rejeitado"] as const;

export type ResultadoResumoDiario =
  | { enviado: false; motivo: "sem_destino" | "sem_eventos" | "falha_envio"; erro?: string }
  | { enviado: true; pendentes: number; processos24h: number };

/**
 * Recolhe a fila, envia um email único e marca as linhas como processadas.
 *
 * Nunca lança: é chamado por um temporizador, e uma exceção aqui morria numa
 * `unhandledRejection` sem deixar rasto. Tudo o que corre mal sai como
 * `enviado: false` com o motivo.
 *
 * As linhas só são marcadas **depois** de o fornecedor aceitar a mensagem. Ao
 * contrário, um envio falhado apagava a fila e os eventos desse dia
 * desapareciam para sempre — a fila é a única cópia que deles existe.
 */
export async function executarResumoDiario(
  opcoes: { forcar?: boolean } = {},
): Promise<ResultadoResumoDiario> {
  let destino: string | undefined;
  try {
    destino = env().EMAIL_NOTIFICACOES;
  } catch (e) {
    // `env()` valida o ambiente todo e lança por qualquer variável em falta —
    // a mesma armadilha do D42, aqui apanhada antes de matar o temporizador.
    console.warn("[resumo-diario] ambiente inválido — resumo omitido:", e);
    return { enviado: false, motivo: "sem_destino" };
  }

  if (!destino) {
    // Sem destino não há aviso, e é uma decisão e não uma falha (D37).
    console.info("[resumo-diario] EMAIL_NOTIFICACOES por definir — resumo omitido.");
    return { enviado: false, motivo: "sem_destino" };
  }

  let pendentes: Awaited<ReturnType<typeof consultarNotificacoesPendentes>> = [];
  let processos24h = 0;

  try {
    pendentes = await consultarNotificacoesPendentes(LIMITE_PENDENTES);
  } catch (e) {
    console.error("[resumo-diario] não foi possível ler a fila de pendentes:", e);
  }

  try {
    const desde = new Date(Date.now() - 24 * 60 * 60_000);
    const [linha] = await db()
      .select({ total: count() })
      .from(processoOnboarding)
      .where(
        and(
          inArray(processoOnboarding.estado, [...ESTADOS_SUBMETIDOS]),
          isNotNull(processoOnboarding.submetidoEm),
          gte(processoOnboarding.submetidoEm, desde),
        ),
      );
    processos24h = Number(linha?.total ?? 0);
  } catch (e) {
    console.error("[resumo-diario] não foi possível contar os processos das 24h:", e);
  }

  if (pendentes.length === 0 && processos24h === 0 && !opcoes.forcar) {
    return { enviado: false, motivo: "sem_eventos" };
  }

  const sociedades = pendentes
    .filter((n) => n.tipo === "sociedade_criada")
    .map((n) => n.dados);
  const utilizadores = pendentes
    .filter((n) => n.tipo === "novo_utilizador")
    .map((n) => n.dados);

  const envio = await enviarEmail({
    para: destino,
    assunto: assuntoResumo(sociedades.length, utilizadores.length),
    html: htmlResumo({ sociedades, utilizadores, processos24h }),
    // O mesmo template do aviso interno: é a mesma pergunta em `/emails`
    // («o dono foi avisado?»), e um valor novo no enum obrigava a migração.
    template: "notificacao_backoffice",
  });

  if (!envio.ok) {
    // A fila fica por marcar de propósito — o dia seguinte volta a tentar com
    // os mesmos eventos em vez de os perder.
    console.error(`[resumo-diario] envio falhado, fila intacta: ${envio.erro}`);
    return { enviado: false, motivo: "falha_envio", erro: envio.erro };
  }

  if (pendentes.length > 0) {
    try {
      await db()
        .update(notificacoesPendentes)
        .set({ processadoEm: new Date() })
        .where(
          inArray(
            notificacoesPendentes.id,
            pendentes.map((n) => n.id),
          ),
        );
    } catch (e) {
      // Aviso enviado e fila por limpar: o resumo de amanhã repete estes
      // eventos. Repetido é melhor do que perdido, e é dito aqui para não
      // parecer um defeito de contagem.
      console.error(
        `[resumo-diario] resumo enviado mas ${pendentes.length} linha(s) ficaram por marcar — ` +
          "vão repetir-se no resumo seguinte:",
        e,
      );
    }
  }

  console.info(
    `[resumo-diario] enviado para ${destino}: ${sociedades.length} sociedade(s), ` +
      `${utilizadores.length} utilizador(es), ${processos24h} processo(s) nas últimas 24h.`,
  );

  return { enviado: true, pendentes: pendentes.length, processos24h };
}

/* ------------------------------------------------------------------ composição */

function dataDeHoje(): string {
  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
}

/**
 * O assunto diz o que aconteceu antes de a mensagem ser aberta — é o que
 * distingue, na lista da caixa de correio, um dia com uma sociedade nova de um
 * dia parado.
 */
function assuntoResumo(nSociedades: number, nUtilizadores: number): string {
  const partes: string[] = [];
  if (nSociedades > 0) {
    partes.push(`${nSociedades} nova${nSociedades > 1 ? "s" : ""} sociedade${nSociedades > 1 ? "s" : ""}`);
  }
  if (nUtilizadores > 0) {
    partes.push(
      `${nUtilizadores} novo${nUtilizadores > 1 ? "s" : ""} utilizador${nUtilizadores > 1 ? "es" : ""}`,
    );
  }

  return partes.length > 0
    ? `LexFlow | Resumo Diário: ${partes.join(", ")} (${dataDeHoje()})`
    : `LexFlow | Resumo Diário — ${dataDeHoje()}`;
}

/** Um valor do `dados` da fila, sem confiar no que lá está: é `jsonb`. */
function texto(dados: Record<string, unknown>, chave: string): string {
  const valor = dados[chave];
  return typeof valor === "string" && valor.trim() ? valor.trim() : "—";
}

function linhaDaLista(titulo: string, detalhe: string): string {
  return `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid ${LINHA};">
        <span style="font-family:${FONTE_CORPO};font-size:14px;color:${TINTA};">${escapar(titulo)}</span><br>
        <span style="font-family:${FONTE_MONO};font-size:12px;color:${TINTA_SUAVE};">${escapar(detalhe)}</span>
      </td>
    </tr>`;
}

function seccao(titulo: string, linhas: string[]): string {
  if (linhas.length === 0) return "";
  return `
    <p style="font-family:${FONTE_CORPO};font-size:13px;font-weight:600;color:${TINTA_SUAVE};
              text-transform:uppercase;letter-spacing:.06em;margin:22px 0 6px;">${escapar(titulo)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      ${linhas.join("")}
    </table>`;
}

function htmlResumo({
  sociedades,
  utilizadores,
  processos24h,
}: {
  sociedades: Record<string, unknown>[];
  utilizadores: Record<string, unknown>[];
  processos24h: number;
}): string {
  const base = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");

  return moldura(
    `
    ${p(`Resumo da atividade da plataforma em ${dataDeHoje()}.`)}
    ${p(
      `<strong>${sociedades.length}</strong> sociedade(s) nova(s) · ` +
        `<strong>${utilizadores.length}</strong> utilizador(es) novo(s) · ` +
        `<strong>${processos24h}</strong> processo(s) submetido(s) nas últimas 24 horas.`,
    )}
    ${seccao(
      "Sociedades",
      sociedades.map((s) =>
        linhaDaLista(
          texto(s, "nome"),
          `NIPC ${texto(s, "nif")} · prefixo ${texto(s, "prefixo")} · admin ${texto(s, "adminEmail")}`,
        ),
      ),
    )}
    ${seccao(
      "Utilizadores",
      utilizadores.map((u) =>
        linhaDaLista(texto(u, "nome"), `${texto(u, "email")} · ${texto(u, "papel")}`),
      ),
    )}
    ${botao(`${base}/admin`, "Abrir a administração")}
  `,
    ARQUIVO,
  );
}
