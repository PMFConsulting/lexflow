/**
 * O percurso de quem se junta a uma sociedade.
 *
 * Seis passos, e a ordem tem uma razão: identifica-se, diz o que é
 * profissionalmente, prova-o com documentos, toma conhecimento de como os seus
 * dados são tratados e assume o sigilo, aceita o articulado da sociedade, e só
 * então define a palavra-passe. A conta **não existe** até ao último passo — e
 * é isso que impede que alguém possa entrar na plataforma sem ter acabado de se
 * identificar.
 *
 * O passo 4 é o que a validação jurídica vai procurar primeiro, e não é um
 * passo de conforto: sem ele, a recolha dos dados pessoais de um advogado fica
 * sem dever de informação cumprido (artigos 13.º/14.º do RGPD) e sem declaração
 * de sigilo de alguém que está prestes a ver documentos de identificação de
 * clientes, declarações de PPE e origens de fundos.
 */

export const TOTAL_PASSOS_CONVITE = 6;

export const PASSOS_CONVITE = [
  {
    n: 1,
    chave: "pessoais",
    titulo: "Os seus dados",
    curto: "Dados",
    descricao: "Identificação, contacto e morada. É o que fica associado à sua conta.",
  },
  {
    n: 2,
    chave: "profissionais",
    titulo: "Dados profissionais",
    curto: "Profissão",
    descricao:
      "Cédula profissional e conselho regional, quando aplicável. Nem todos os perfis têm cédula — o campo só é obrigatório para advogados e sócios.",
  },
  {
    n: 3,
    chave: "documentos",
    titulo: "Documentos",
    curto: "Documentos",
    descricao: "Documento de identificação e, para advogados, a cédula profissional.",
  },
  {
    n: 4,
    chave: "rgpd",
    titulo: "Proteção de dados e sigilo profissional",
    curto: "RGPD",
    descricao:
      "Como a sociedade trata os seus dados, e a declaração de sigilo sobre o que vai encontrar nesta plataforma.",
  },
  {
    n: 5,
    chave: "termos",
    titulo: "Termos e Condições da sociedade",
    curto: "T&C",
    descricao:
      "O articulado da sociedade, o mesmo que é apresentado aos clientes. A aceitação fica registada com a versão, a data e o endereço de onde foi dada.",
  },
  {
    n: 6,
    chave: "conta",
    titulo: "Palavra-passe e conclusão",
    curto: "Conta",
    descricao: "Define a palavra-passe e a conta fica criada. É a partir daqui que pode entrar.",
  },
] as const;

export type PassoConvite = (typeof PASSOS_CONVITE)[number];

export function passoConvitePorNumero(n: number): PassoConvite | undefined {
  return PASSOS_CONVITE.find((p) => p.n === n);
}

export function proximoPassoConvite(atual: number): number | null {
  return atual < TOTAL_PASSOS_CONVITE ? atual + 1 : null;
}

export function passoAnteriorConvite(atual: number): number | null {
  return atual > 1 ? atual - 1 : null;
}

/**
 * Os papéis que exercem advocacia, e por isso têm cédula.
 *
 * Um assistente não tem cédula profissional, e exigir-lha tornava o passo 2
 * impossível de fechar para um perfil que legitimamente não a tem — o mesmo
 * erro que o passo 3 do cliente tinha antes da D28, com a diferença de que aqui
 * é dentro do passo e não o passo inteiro.
 */
export function exerceAdvocacia(papel: string): boolean {
  return papel === "utilizador" || papel === "society_admin";
}
