/**
 * Textos legais do passo 4 do registo de uma pessoa da equipa. Ficheiro
 * próprio (como `lib/termos.ts`), pensado para revisão jurídica sem tocar em
 * marcação.
 *
 * Texto de demonstração, escrito a partir dos artigos 13.º/14.º do RGPD e do
 * Estatuto da Ordem dos Advogados. Ao substituir: a informação de proteção de
 * dados é «tomei conhecimento», não «autorizo» — trocar o verbo transforma um
 * dever de informação num consentimento inválido (a base legal aqui é o
 * contrato/obrigação legal, não a vontade da pessoa).
 */

/** A informação do artigo 13.º do RGPD, em linguagem de quem a vai ler. */
export const INFORMACAO_RGPD: string[] = [
  "A sociedade trata os dados pessoais que aqui indica para constituir e manter o seu processo individual, cumprir as obrigações legais que lhe são aplicáveis — designadamente as decorrentes da Lei 83/2017 e do Estatuto da Ordem dos Advogados — e permitir o seu acesso a esta plataforma. O responsável pelo tratamento é a sociedade que o convidou.",
  "As bases legais do tratamento são a execução do contrato que o liga à sociedade e o cumprimento de obrigações legais. Não é pedido o seu consentimento para estas finalidades porque o consentimento não é a base legal aplicável — e um consentimento pedido onde não é a base correta não seria válido nem lhe daria qualquer controlo adicional.",
  "Os dados são conservados enquanto durar a relação e, depois disso, pelos prazos de retenção que a lei impõe. Os documentos de identificação e a cédula profissional ficam em armazenamento privado, acessíveis apenas a quem administra a conta da sociedade.",
  "Pode pedir o acesso, a retificação, a limitação e, quando a lei o permita, o apagamento dos seus dados, dirigindo-se à sociedade. O direito ao apagamento não abrange o que a lei obriga a conservar — e nesta plataforma o registo de auditoria é imutável por construção, precisamente para poder provar o que aconteceu.",
  "Tem também o direito de apresentar reclamação à Comissão Nacional de Proteção de Dados.",
];

/** A declaração de sigilo profissional. */
export const TEXTO_SIGILO =
  "Ao aceder a esta plataforma vai encontrar dados de identificação de clientes da sociedade, declarações de pessoa politicamente exposta, origens de fundos e documentos de identificação. Tudo isso está coberto pelo segredo profissional, nos termos do Estatuto da Ordem dos Advogados, e o dever mantém-se depois de terminar a sua relação com a sociedade. A declaração que assina em baixo fica registada com a data e o endereço de onde foi dada.";
