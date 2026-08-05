import type { InferSelectModel } from "drizzle-orm";
import type { processoOnboarding } from "@/db/schema/processo";
import type { representanteLegal } from "@/db/schema/seccoes";

export type Processo = InferSelectModel<typeof processoOnboarding>;
export type Representante = InferSelectModel<typeof representanteLegal>;

export const TOTAL_PASSOS = 6;

export type NumeroPasso = 1 | 2 | 3 | 4 | 5 | 6;

export const PASSOS = [
  { n: 1, chave: "identificacao", titulo: "Identificação do cliente", curto: "Identificação" },
  { n: 2, chave: "fiscal", titulo: "Identificação fiscal", curto: "Fiscal" },
  { n: 3, chave: "representante", titulo: "Representante legal", curto: "Representante" },
  { n: 4, chave: "ppe", titulo: "PPE e relação de negócio", curto: "PPE" },
  { n: 5, chave: "faturacao", titulo: "Dados para faturação", curto: "Faturação" },
  { n: 6, chave: "fecho", titulo: "T&C, aceitação de proposta e assinatura digital", curto: "Fecho" },
] as const;

export type Passo = (typeof PASSOS)[number];

export function passoPorNumero(n: number): Passo | undefined {
  return PASSOS.find((p) => p.n === n);
}

/**
 * O passo 3 é o único condicional, e a condição não é simples: aplica-se a
 * empresas sempre, e a particulares só quando alguém age por procuração.
 *
 * O sinalizador vive no passo 1 (`representadoPorProcurador`) porque é aí que
 * se sabe quem é o cliente — mas o formulário atual tem o interruptor no topo
 * do próprio passo 3. Suportamos os dois: o interruptor continua a existir, e
 * quem já disse no passo 1 chega lá com ele ligado.
 */
export function passoAplicavel(
  n: number,
  ctx: { tipoCliente: "particular" | "empresa"; representadoPorProcurador?: boolean },
): boolean {
  if (n !== 3) return true;
  return ctx.tipoCliente === "empresa" || ctx.representadoPorProcurador === true;
}

/** Os passos que este processo tem mesmo de percorrer. */
export function passosAplicaveis(ctx: {
  tipoCliente: "particular" | "empresa";
  representadoPorProcurador?: boolean;
}) {
  return PASSOS.filter((p) => passoAplicavel(p.n, ctx));
}

/**
 * O passo seguinte, saltando os que não se aplicam.
 * Devolve null quando não há mais — ou seja, quando é para submeter.
 */
export function proximoPasso(
  atual: number,
  ctx: { tipoCliente: "particular" | "empresa"; representadoPorProcurador?: boolean },
): number | null {
  for (let n = atual + 1; n <= TOTAL_PASSOS; n += 1) {
    if (passoAplicavel(n, ctx)) return n;
  }
  return null;
}

export function passoAnterior(
  atual: number,
  ctx: { tipoCliente: "particular" | "empresa"; representadoPorProcurador?: boolean },
): number | null {
  for (let n = atual - 1; n >= 1; n -= 1) {
    if (passoAplicavel(n, ctx)) return n;
  }
  return null;
}
