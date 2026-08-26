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
    titulo: "Identificação",
    curto: "Identificação",
    descricao:
      "Nome, NIPC, forma jurídica e número de inscrição na Ordem dos Advogados.",
  },
  {
    n: 2,
    chave: "contactos",
    titulo: "Contactos",
    curto: "Contactos",
    descricao: "Morada da sede e contactos gerais da sociedade.",
  },
  {
    n: 3,
    chave: "documentos",
    titulo: "Documentos",
    curto: "Documentos",
    descricao: "Certidão permanente da sociedade para validação dos dados.",
  },
  {
    n: 4,
    chave: "termos",
    titulo: "Termos e Condições",
    curto: "Termos e Condições",
    descricao:
      "Termos e Condições da sociedade a apresentar aos clientes e à equipa.",
  },
  {
    n: 5,
    chave: "administrador",
    titulo: "Administrador",
    curto: "Administrador",
    descricao:
      "Identificação e contacto do responsável pela administração da conta.",
  },
  {
    n: 6,
    chave: "fecho",
    titulo: "Conclusão",
    curto: "Conclusão",
    descricao: "Revisão dos dados preenchidos e submissão do registo.",
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
