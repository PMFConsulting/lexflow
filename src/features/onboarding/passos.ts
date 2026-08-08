import type { InferSelectModel } from "drizzle-orm";
import type { processoOnboarding } from "@/db/schema/processo";

export type Processo = InferSelectModel<typeof processoOnboarding>;

export type TipoCliente = "particular" | "empresa";

export const TOTAL_PASSOS = 7;

export type NumeroPasso = 1 | 2 | 3 | 4 | 5 | 6 | 7;

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
    chave: "representante",
    titulo: "Representante Legal",
    curto: "Representante",
    descricao:
      "Quem representa legalmente a entidade. Se for o próprio a tratar do processo, responda Sim e siga em frente.",
  },
  {
    n: 4,
    chave: "ppe",
    titulo: "PPE e relação de negócio",
    curto: "PPE",
    // Sem promessa de aprovação (D20: o fluxo foi apagado) e sem falar de
    // nível de risco (D21: não é mostrado a ninguém, muito menos ao cliente).
    descricao:
      "Declaração exigida pela Lei 83/2017, e os serviços que nos confia. Responder Sim não impede nada — só obriga a sociedade a recolher mais alguns dados.",
  },
  {
    n: 5,
    chave: "faturacao",
    titulo: "Dados para faturação",
    curto: "Faturação",
    descricao: "Dados para a faturação. Pode indicar que são iguais aos do cliente.",
  },
  {
    n: 6,
    chave: "preferencias",
    titulo: "RGPD",
    curto: "RGPD",
    descricao: "Como nos conheceu, e se quer receber newsletter ou convites para iniciativas. Consentimentos ao abrigo do RGPD.",
  },
  {
    n: 7,
    chave: "fecho",
    titulo: "T&C, aceitação de proposta e assinatura digital",
    curto: "Fecho",
    descricao: "Rever os dados, assinar e submeter o processo.",
  },
] as const;

export type Passo = (typeof PASSOS)[number];

/**
 * O passo do Representante Legal só existe para pessoas coletivas.
 *
 * Uma pessoa singular representa-se a si própria: perguntar-lhe quem é o
 * representante legal é uma pergunta sem resposta possível, e era o que a
 * reunião de 07/08 apanhou. Numa empresa a pergunta é obrigatória — é alguém
 * que age em nome de outrem, e a Lei 83/2017 obriga a identificá-lo.
 *
 * A numeração não se mexe: o passo continua a ser o 3 e o Fecho continua a ser
 * o 7. Renumerar partia os rótulos de auditoria (`passo.N.gravado`), a
 * restrição `passo_valido` e os links de "Corrigir" já gravados. O que muda é
 * quais deles se percorrem.
 */
const SO_EMPRESA: number[] = [3];

export function passoAplicavel(n: number, tipoCliente: TipoCliente): boolean {
  return tipoCliente === "empresa" || !SO_EMPRESA.includes(n);
}

/** Os passos que este cliente percorre, pela ordem em que os percorre. */
export function passosDoProcesso(tipoCliente: TipoCliente): readonly Passo[] {
  return PASSOS.filter((p) => passoAplicavel(p.n, tipoCliente));
}

export function passoPorNumero(n: number): Passo | undefined {
  return PASSOS.find((p) => p.n === n);
}

/** O passo seguinte. Devolve null quando não há mais — é para submeter. */
export function proximoPasso(atual: number, tipoCliente: TipoCliente): number | null {
  for (let n = atual + 1; n <= TOTAL_PASSOS; n++) {
    if (passoAplicavel(n, tipoCliente)) return n;
  }
  return null;
}

export function passoAnterior(atual: number, tipoCliente: TipoCliente): number | null {
  for (let n = atual - 1; n >= 1; n--) {
    if (passoAplicavel(n, tipoCliente)) return n;
  }
  return null;
}

/**
 * Quantos passos do percurso ficam para trás de `n`.
 *
 * Serve as listagens, que só têm o `passo_atual` à mão: um `passoAtual - 1` num
 * particular carimbava também o Representante Legal, que ele nunca viu, porque
 * a numeração salta do 2 para o 4.
 */
export function passosAntesDe(n: number, tipoCliente: TipoCliente): number {
  return passosDoProcesso(tipoCliente).filter((p) => p.n < n).length;
}

/** O último passo deste percurso — onde o botão passa a dizer "Submeter". */
export function ultimoPasso(tipoCliente: TipoCliente): number {
  const percurso = passosDoProcesso(tipoCliente);
  return percurso[percurso.length - 1].n;
}
