/**
 * Os países que aparecem nas listas de escolha.
 *
 * Uma lista curta e não a ISO 3166 inteira: são os países de que vem a
 * esmagadora maioria dos clientes e dos advogados desta sociedade, e uma caixa
 * com 249 entradas custa mais a usar do que a que tem as dez certas. O `pais`
 * do schema aceita qualquer código de dois caracteres — o dia em que faltar um,
 * acrescenta-se aqui e mais nada muda.
 *
 * Ficava dentro do formulário do cliente. Saiu quando o registo da sociedade
 * passou a pedir a morada da sede pelo mesmo campo: duas listas de países é
 * como se tem um país escolhível num formulário e não no outro.
 */
export const PAISES = [
  { valor: "PT", texto: "Portugal" },
  { valor: "ES", texto: "Espanha" },
  { valor: "FR", texto: "França" },
  { valor: "GB", texto: "Reino Unido" },
  { valor: "DE", texto: "Alemanha" },
  { valor: "BR", texto: "Brasil" },
  { valor: "AO", texto: "Angola" },
  { valor: "MZ", texto: "Moçambique" },
  { valor: "CV", texto: "Cabo Verde" },
  { valor: "US", texto: "Estados Unidos" },
];

/** Os tipos de documento de identificação vistos no formulário real. */
export const DOCUMENTOS_ID = [
  { valor: "cartao_cidadao", texto: "Cartão de Cidadão" },
  { valor: "passaporte", texto: "Passaporte" },
  { valor: "titulo_residencia", texto: "Título de residência" },
  { valor: "outro", texto: "Outro" },
];
