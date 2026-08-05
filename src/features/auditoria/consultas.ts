import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { eventoAuditoria } from "@/db/schema/auditoria";
import { utilizador } from "@/db/schema/organizacao";

/** A linha do tempo de um processo. Imutável, por construção. */
export async function auditoriaDoProcesso(processoId: string) {
  return db()
    .select({
      id: eventoAuditoria.id,
      acao: eventoAuditoria.acao,
      entidade: eventoAuditoria.entidade,
      valorNovo: eventoAuditoria.valorNovo,
      ip: eventoAuditoria.ip,
      criadoEm: eventoAuditoria.criadoEm,
      hash: eventoAuditoria.hash,
      ator: utilizador.nome,
    })
    .from(eventoAuditoria)
    .leftJoin(utilizador, eq(utilizador.id, eventoAuditoria.atorId))
    .where(eq(eventoAuditoria.processoId, processoId))
    .orderBy(asc(eventoAuditoria.criadoEm));
}

/** Rótulos legíveis. Um registo que só a equipa técnica lê não serve de prova. */
export const ACOES: Record<string, string> = {
  "processo.criado": "Processo criado",
  "processo.submetido": "Processo submetido pelo cliente",
  "risco.elevado": "Nível de risco elevado para elevado",
  "assinatura.criada": "Assinatura recolhida",
  "documento.carregado": "Documento carregado",
  "documento.removido": "Documento removido",
  "conta.ligada": "Conta de utilizador associada",
  "passo.1.gravado": "Passo 1 — Identificação gravado",
  "passo.2.gravado": "Passo 2 — Fiscal gravado",
  "passo.3.gravado": "Passo 3 — PPE gravado",
  "passo.4.gravado": "Passo 4 — Faturação gravado",
  "passo.5.gravado": "Passo 5 — Declaração gravado",
  "processo.consultado": "Processo consultado",
  "processo.consultado.sem_ppe": "Processo consultado (sem PPE)",
  "processo.em_revisao": "Processo marcado em revisão",
  "processo.aprovado": "Processo aprovado",
  "processo.rejeitado": "Processo rejeitado",
};
