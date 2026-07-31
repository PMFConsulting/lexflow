import { createHash } from "node:crypto";

/**
 * Encadeamento por hash do registo de auditoria.
 *
 * Cada linha inclui o hash da anterior, o que torna o registo verificavelmente
 * íntegro: alterar uma linha antiga obriga a recalcular todas as seguintes, e
 * a base de dados não permite UPDATE nenhum (migração 0002).
 */

export type EntradaAuditoria = {
  id: string;
  organizacaoId: string;
  processoId: string | null;
  atorId: string | null;
  acao: string;
  entidade: string;
  entidadeId: string | null;
  valorAnterior: Record<string, unknown> | null;
  valorNovo: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  criadoEm: Date;
};

/**
 * Serialização canónica: chaves ordenadas em qualquer profundidade.
 *
 * Sem isto, o mesmo objeto serializado por dois caminhos diferentes dá hashes
 * diferentes e a cadeia parece adulterada quando não está.
 */
export function canonico(valor: unknown): string {
  if (valor === null || valor === undefined) return "null";
  if (valor instanceof Date) return JSON.stringify(valor.toISOString());
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(",")}]`;

  if (typeof valor === "object") {
    const entradas = Object.entries(valor as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonico(v)}`);
    return `{${entradas.join(",")}}`;
  }

  return JSON.stringify(valor);
}

export function calcularHash(entrada: EntradaAuditoria, hashAnterior: string | null): string {
  const carga = canonico({
    hashAnterior,
    id: entrada.id,
    organizacaoId: entrada.organizacaoId,
    processoId: entrada.processoId,
    atorId: entrada.atorId,
    acao: entrada.acao,
    entidade: entrada.entidade,
    entidadeId: entrada.entidadeId,
    valorAnterior: entrada.valorAnterior ?? null,
    valorNovo: entrada.valorNovo ?? null,
    ip: entrada.ip,
    userAgent: entrada.userAgent,
    criadoEm: entrada.criadoEm,
  });

  return createHash("sha256").update(carga, "utf8").digest("hex");
}
