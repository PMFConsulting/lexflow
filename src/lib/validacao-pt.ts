/**
 * Validações portuguesas. Implementadas aqui de propósito: as bibliotecas que
 * existem para isto são de uma estrela e o algoritmo são quinze linhas.
 *
 * As mensagens dizem o que falhou e como corrigir — nunca "Valor inválido".
 */

export type Resultado = { valido: true } | { valido: false; mensagem: string };

const ok: Resultado = { valido: true };
const erro = (mensagem: string): Resultado => ({ valido: false, mensagem });

/* -------------------------------------------------------------- NIF / NIPC */

/**
 * Primeiros dígitos válidos de um NIF/NIPC português.
 * 1–3 singulares · 5 coletivas · 6 organismos públicos · 8 ENI · 9 condomínios
 * e irregulares. Os prefixos de dois dígitos cobrem não residentes (45),
 * heranças indivisas (70, 74, 75, 77, 78, 79) e entidades equiparadas (90–99).
 */
const PREFIXOS_UM_DIGITO = ["1", "2", "3", "5", "6", "8", "9"];
const PREFIXOS_DOIS_DIGITOS = [
  "45", "70", "71", "72", "74", "75", "77", "78", "79", "90", "91", "98", "99",
];

export function normalizarNif(valor: string): string {
  return valor.replace(/\s/g, "");
}

export function validarNif(valor: string): Resultado {
  const nif = normalizarNif(valor);

  if (nif.length === 0) return erro("Indique o número de contribuinte.");
  if (!/^\d+$/.test(nif)) return erro("O NIF só pode ter dígitos, sem letras nem símbolos.");
  if (nif.length !== 9) {
    return erro(`O NIF tem de ter 9 dígitos — indicou ${nif.length}.`);
  }

  const prefixoValido =
    PREFIXOS_UM_DIGITO.includes(nif[0]) || PREFIXOS_DOIS_DIGITOS.includes(nif.slice(0, 2));

  if (!prefixoValido) {
    return erro("O NIF tem de começar por 1, 2, 3, 5, 6, 8 ou 9. Confirme o primeiro dígito.");
  }

  // Checksum mod-11: os oito primeiros dígitos com pesos de 9 a 2.
  let soma = 0;
  for (let i = 0; i < 8; i += 1) {
    soma += Number(nif[i]) * (9 - i);
  }
  const resto = soma % 11;
  const controlo = resto < 2 ? 0 : 11 - resto;

  if (controlo !== Number(nif[8])) {
    return erro("O NIF não é válido — verifique se trocou algum dígito.");
  }

  return ok;
}

/* ---------------------------------------------------------------- Código postal */

export function validarCodigoPostal(valor: string): Resultado {
  const cp = valor.trim();

  if (cp.length === 0) return erro("Indique o código postal.");
  if (!/^\d{4}-\d{3}$/.test(cp)) {
    return erro('O código postal tem de ter o formato 0000-000, com o hífen — por exemplo 1250-096.');
  }

  return ok;
}

export function formatarCodigoPostal(valor: string): string {
  const digitos = valor.replace(/\D/g, "").slice(0, 7);
  if (digitos.length <= 4) return digitos;
  return `${digitos.slice(0, 4)}-${digitos.slice(4)}`;
}

/* ------------------------------------------------------------------------ IBAN */

/** Comprimento total do IBAN por país. Cobre o EEE e os casos que aparecem cá. */
const COMPRIMENTO_IBAN: Record<string, number> = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18,
  EE: 20, ES: 24, FI: 18, FR: 27, GB: 22, GR: 27, HR: 21, HU: 28, IE: 22,
  IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31, NL: 18,
  NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27,
};

export function normalizarIban(valor: string): string {
  return valor.replace(/[\s-]/g, "").toUpperCase();
}

export function validarIban(valor: string): Resultado {
  const iban = normalizarIban(valor);

  if (iban.length === 0) return erro("Indique o IBAN.");
  if (!/^[A-Z]{2}[0-9A-Z]+$/.test(iban)) {
    return erro("O IBAN começa por duas letras do país, seguidas de dígitos — por exemplo PT50…");
  }

  const pais = iban.slice(0, 2);
  const esperado = COMPRIMENTO_IBAN[pais];

  if (!esperado) {
    return erro(`Não reconhecemos o país "${pais}". Confirme as duas primeiras letras do IBAN.`);
  }
  if (iban.length !== esperado) {
    return erro(
      `Um IBAN de ${pais} tem ${esperado} caracteres — este tem ${iban.length}. Confirme se não falta ou sobra algum dígito.`,
    );
  }

  // mod-97: os quatro primeiros caracteres passam para o fim e as letras viram
  // números (A=10 … Z=35). O resto tem de ser 1.
  const rearranjado = iban.slice(4) + iban.slice(0, 4);
  const numerico = rearranjado.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));

  // O número não cabe num Number, por isso o módulo faz-se por blocos.
  let resto = 0;
  for (const digito of numerico) {
    resto = (resto * 10 + Number(digito)) % 97;
  }

  if (resto !== 1) {
    return erro("O IBAN não é válido — verifique se trocou ou omitiu algum dígito.");
  }

  return ok;
}

/** Apresentação em grupos de 4, como manda o §3 do brief. */
export function formatarIban(valor: string): string {
  return normalizarIban(valor).replace(/(.{4})/g, "$1 ").trim();
}

/* ------------------------------------------------------------------ Telefone */

/** E.164 permissivo: aceita indicativo internacional e espaços de leitura. */
export function validarTelefone(valor: string): Resultado {
  const tel = valor.replace(/[\s-]/g, "");

  if (tel.length === 0) return erro("Indique o contacto telefónico.");
  if (!/^\+?\d{6,15}$/.test(tel)) {
    return erro("Indique o número com o indicativo do país — por exemplo +351 912 345 678.");
  }

  return ok;
}
