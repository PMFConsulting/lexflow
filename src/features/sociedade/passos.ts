/**
 * O percurso de onboarding de uma sociedade.
 *
 * Seis passos, e a ordem não é decorativa. A sociedade identifica-se, diz onde
 * está, prova que existe, entrega o articulado que vai vincular os seus
 * clientes, nomeia quem administra a conta e assina por tudo isso. Cada passo
 * depende do anterior ter sido respondido: não se pede o articulado a quem
 * ainda não disse quem é.
 *
 * A numeração é fixa, como a do cliente e pela mesma razão (D28): os rótulos de
 * auditoria (`sociedade.passo.N.gravado`), a restrição `passo_sociedade_valido`
 * e qualquer link de "Corrigir" já gravado dependem dela. Um passo que deixe de
 * se aplicar salta-se; não se renumera.
 */

export const TOTAL_PASSOS_SOCIEDADE = 6;

export type NumeroPassoSociedade = 1 | 2 | 3 | 4 | 5 | 6;

export const PASSOS_SOCIEDADE = [
  {
    n: 1,
    chave: "identificacao",
    titulo: "Identificação da sociedade",
    curto: "Identificação",
    descricao:
      "Nome, NIPC e forma jurídica da sociedade, e o número de inscrição na Ordem dos Advogados.",
  },
  {
    n: 2,
    chave: "contactos",
    titulo: "Morada e contactos",
    curto: "Contactos",
    descricao: "A morada da sede e os contactos gerais da sociedade.",
  },
  {
    n: 3,
    chave: "documentos",
    titulo: "Documentos da sociedade",
    curto: "Documentos",
    descricao: "Certidão permanente da sociedade, para confirmarmos os dados que indicou.",
  },
  {
    n: 4,
    chave: "termos",
    titulo: "Termos e Condições da sociedade",
    curto: "T&C",
    descricao:
      "O articulado que os vossos clientes vão aceitar. É este documento que a plataforma passa a apresentar, em vez do texto genérico.",
  },
  {
    n: 5,
    chave: "administrador",
    titulo: "Administrador da conta",
    curto: "Administrador",
    descricao:
      "Quem vai administrar a plataforma do vosso lado. Recebe um convite próprio para criar a conta.",
  },
  {
    n: 6,
    chave: "fecho",
    titulo: "Revisão e submissão",
    curto: "Fecho",
    descricao: "Rever o que foi preenchido e submeter.",
  },
] as const;

export type PassoSociedade = (typeof PASSOS_SOCIEDADE)[number];

export function passoSociedadePorNumero(n: number): PassoSociedade | undefined {
  return PASSOS_SOCIEDADE.find((p) => p.n === n);
}

export function proximoPassoSociedade(atual: number): number | null {
  return atual < TOTAL_PASSOS_SOCIEDADE ? atual + 1 : null;
}

export function passoAnteriorSociedade(atual: number): number | null {
  return atual > 1 ? atual - 1 : null;
}
