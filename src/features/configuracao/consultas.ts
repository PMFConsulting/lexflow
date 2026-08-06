import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { eventoAuditoria } from "@/db/schema/auditoria";
import {
  configuracaoDaOrganizacao,
  estadoDaConfiguracao,
  type ConfiguracaoArmazenamento,
  type EstadoLigacao,
} from "@/lib/storage";

export type EstadoArmazenamento = {
  config: ConfiguracaoArmazenamento | null;
  estado: EstadoLigacao;
  ultimosEventos: {
    id: string;
    acao: string;
    criadoEm: Date;
    detalhe: string | null;
  }[];
};

const ACOES = ["armazenamento.sincronizado", "armazenamento.erro"];

/**
 * O que o ecrã de configuração precisa de saber: o estado da ligação e as
 * últimas sincronizações. Os parâmetros cifrados nunca saem daqui — nem
 * decifrados, nem em envelope.
 */
export async function estadoArmazenamento(organizacaoId: string): Promise<EstadoArmazenamento> {
  const config = await configuracaoDaOrganizacao(organizacaoId);

  const eventos = await db()
    .select({
      id: eventoAuditoria.id,
      acao: eventoAuditoria.acao,
      criadoEm: eventoAuditoria.criadoEm,
      valorNovo: eventoAuditoria.valorNovo,
    })
    .from(eventoAuditoria)
    .where(
      and(
        eq(eventoAuditoria.organizacaoId, organizacaoId),
        inArray(eventoAuditoria.acao, ACOES),
      ),
    )
    .orderBy(desc(eventoAuditoria.criadoEm))
    .limit(8);

  return {
    config,
    estado: estadoDaConfiguracao(config),
    ultimosEventos: eventos.map((e) => ({
      id: e.id,
      acao: e.acao,
      criadoEm: e.criadoEm,
      detalhe:
        typeof e.valorNovo?.pasta === "string"
          ? e.valorNovo.pasta
          : typeof e.valorNovo?.erro === "string"
            ? e.valorNovo.erro
            : null,
    })),
  };
}
