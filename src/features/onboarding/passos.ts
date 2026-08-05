import type { InferSelectModel } from "drizzle-orm";
import type { processoOnboarding } from "@/db/schema/processo";

export type Processo = InferSelectModel<typeof processoOnboarding>;

export const TOTAL_PASSOS = 5;

export type NumeroPasso = 1 | 2 | 3 | 4 | 5;

export const PASSOS = [
  {
    n: 1,
    chave: "identificacao",
    titulo: "Identificação do cliente",
    curto: "Identificação",
    descricao: "Dados do cliente final e morada de residência.",
  },
  {
    n: 2,
    chave: "fiscal",
    titulo: "Identificação fiscal",
    curto: "Fiscal",
    descricao: "NIF e documento de identificação. O NIF português é validado automaticamente.",
  },
  {
    n: 3,
    chave: "ppe",
    titulo: "PPE e relação de negócio",
    curto: "PPE",
    descricao:
      "Diligência de KYC. Se declarar ser pessoa politicamente exposta, o processo fica com risco elevado e exige aprovação da sociedade.",
  },
  {
    n: 4,
    chave: "faturacao",
    titulo: "Dados para faturação",
    curto: "Faturação",
    descricao: "Dados para a faturação. Pode indicar que são iguais aos do cliente.",
  },
  {
    n: 5,
    chave: "fecho",
    titulo: "T&C, aceitação de proposta e assinatura digital",
    curto: "Fecho",
    descricao: "Rever os dados, assinar e submeter o processo.",
  },
] as const;

export type Passo = (typeof PASSOS)[number];

export function passoPorNumero(n: number): Passo | undefined {
  return PASSOS.find((p) => p.n === n);
}

/** O passo seguinte. Devolve null quando não há mais — é para submeter. */
export function proximoPasso(atual: number): number | null {
  return atual < TOTAL_PASSOS ? atual + 1 : null;
}

export function passoAnterior(atual: number): number | null {
  return atual > 1 ? atual - 1 : null;
}
