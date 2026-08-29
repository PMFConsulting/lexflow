/**
 * Portuguese validations. Implemented here on purpose: the libraries that exist
 * for this are one-star affairs and the algorithm is fifteen lines.
 *
 * The messages say what failed and how to fix it — never "Invalid value".
 */

export type Resultado = { valido: true } | { valido: false; mensagem: string };

const ok: Resultado = { valido: true };
const erro = (mensagem: string): Resultado => ({ valido: false, mensagem });

/* -------------------------------------------------------------- NIF / NIPC */

/**
 * Valid leading digits of a Portuguese tax number (NIF/NIPC).
 * 1–3 individuals · 5 companies · 6 public bodies · 8 sole traders · 9
 * condominiums and irregular entities. The two-digit prefixes cover
 * non-residents (45), undivided estates (70, 74, 75, 77, 78, 79) and equivalent
 * entities (90–99).
 */
const PREFIXOS_UM_DIGITO = ["1", "2", "3", "5", "6", "8", "9"];
const PREFIXOS_DOIS_DIGITOS = [
  "45", "70", "71", "72", "74", "75", "77", "78", "79", "90", "91", "98", "99",
];

export function normalizarNif(valor: string): string {
  return valor.replace(/\s/g, "");
}

/**
 * The shape a tax number is **stored** in.
 *
 * Validation tolerates `123 456 789` (how it's printed on the card), but
 * storing it that way breaks `ilike` search and NIF-based dedup in
 * `/clientes` — the same taxpayer ends up as two.
 *
 * Separators are only stripped when exactly nine digits remain (Portuguese).
 * A foreign TIN (`nifPortugues = false`, accepted at step 2 on purpose) may
 * need them as part of the number.
 */
export function normalizarNumeroFiscal(valor: string): string {
  const semEspacos = valor.replace(/\s/g, "");
  const semSeparadores = semEspacos.replace(/[.\-/]/g, "");
  return /^\d{9}$/.test(semSeparadores) ? semSeparadores : semEspacos;
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

  // mod-11 checksum: the first eight digits with weights from 9 down to 2.
  let soma = 0;
  for (let i = 0; i < 8; i += 1) {
    soma += Number(nif[i]) * (9 - i);
  }
  const resto = soma % 11;
  const controlo = resto < 2 ? 0 : 11 - resto;

  if (controlo !== Number(nif[8])) {
    // mod-11 is public arithmetic — stating the expected digit reveals
    // nothing, and tells the client which digit to recheck instead of just
    // "invalid".
    return erro(
      `O NIF não é válido — com estes oito primeiros dígitos, o último teria de ser ${controlo} e não ${nif[8]}. Verifique se trocou algum dígito.`,
    );
  }

  return ok;
}

/**
 * Leading digit of a corporate tax number.
 *
 * 5 commercial companies · 6 public bodies · 8 sole traders · 9 condominiums,
 * undivided estates and irregular legal persons. Left out are 1, 2 and 3
 * (individuals) and the two-digit prefixes starting with 4 and 7 —
 * non-residents and estates — which `validarNif` still accepts where the
 * question is "is this a valid tax number?".
 */
const PRIMEIRO_DIGITO_COLETIVA = ["5", "6", "8", "9"];

/**
 * NIPC — tax number of a legal person (D54).
 *
 * `validarNif` alone would accept an individual's NIF in the entity box — a
 * leading 2 or 3 is someone's personal number, a mistake that surfaces
 * months later with the matter already running. Prefix is checked before
 * the checksum: telling the user "the last digit would have to be 4" on a
 * number that was never corporate sends them to fix the wrong thing. Length
 * is already `validarNif`'s job.
 */
export function validarNipc(valor: string): Resultado {
  const nipc = normalizarNif(valor);

  if (nipc.length === 0) return erro("Indique o NIPC da entidade.");

  if (/^\d{9}$/.test(nipc) && !PRIMEIRO_DIGITO_COLETIVA.includes(nipc[0])) {
    return erro(
      `O NIPC de uma pessoa coletiva começa por 5, 6, 8 ou 9 — este começa por ${nipc[0]}. ` +
        "Confirme se não escreveu o NIF de uma pessoa singular.",
    );
  }

  return validarNif(nipc);
}

/* ------------------------------------------------------------------ Postcode */

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

/** Total IBAN length by country. Covers the EEA and the cases that turn up here. */
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

  // mod-97: the first four characters move to the end and the letters become
  // numbers (A=10 … Z=35). The remainder has to be 1.
  const rearranjado = iban.slice(4) + iban.slice(0, 4);
  const numerico = rearranjado.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));

  // The number does not fit in a Number, so the modulo is done in blocks.
  let resto = 0;
  for (const digito of numerico) {
    resto = (resto * 10 + Number(digito)) % 97;
  }

  if (resto !== 1) {
    return erro("O IBAN não é válido — verifique se trocou ou omitiu algum dígito.");
  }

  return ok;
}

/** Displayed in groups of 4, as §3 of the brief requires. */
export function formatarIban(valor: string): string {
  return normalizarIban(valor).replace(/(.{4})/g, "$1 ").trim();
}

/* --------------------------------------------------------------------- Phone */

/**
 * Strips the PT dialling code, if present. Returns `null` when the code
 * belongs to another country (different from "wrong length").
 *
 * A bare `351` only counts as a dialling code when exactly nine digits
 * remain after it — no national number starts with 3 (landlines start 2,
 * mobiles 9), so no legitimate number is mutilated by this.
 */
function semIndicativoPt(tel: string): string | null {
  if (tel.startsWith("+")) {
    return tel.startsWith("+351") ? tel.slice(4) : null;
  }
  if (tel.startsWith("00")) {
    return tel.startsWith("00351") ? tel.slice(5) : null;
  }
  if (tel.length === 12 && tel.startsWith("351")) return tel.slice(3);
  return tel;
}

/**
 * Phone number, storage and validation (D55): exactly nine national digits,
 * with or without +351/00351. The previous `^\+?\d{6,15}$` accepted `123`
 * and accepted `9123456789` — one digit too many looks like a valid mobile
 * number and only surfaces when someone tries to call, weeks later.
 *
 * Formatting (spaces, hyphens, dots, parentheses) is accepted and stripped
 * on storage, same reasoning as the tax number normaliser above — three
 * strings for the same number would make `ilike` miss it. A foreign dialling
 * code is refused with that reason stated, so it doesn't read as a counting
 * error. PT only, a POC decision — unlike step 2's tax number, which accepts
 * foreign ones.
 */
export function normalizarTelefone(valor: string): string {
  const limpo = valor.replace(/[\s\-().]/g, "");
  const nacional = semIndicativoPt(limpo);
  return nacional !== null && nacional.length === 9 ? nacional : limpo;
}

export function validarTelefone(valor: string): Resultado {
  const tel = valor.replace(/[\s\-().]/g, "");

  if (tel.length === 0) return erro("Indique o contacto telefónico.");

  if (!/^(\+|00)?\d+$/.test(tel)) {
    return erro(
      "O telefone só pode ter dígitos e, opcionalmente, o indicativo +351 — por exemplo 912 345 678.",
    );
  }

  const nacional = semIndicativoPt(tel);

  if (nacional === null) {
    return erro(
      "De momento só aceitamos números portugueses. Indique um número de 9 dígitos, com ou sem o indicativo +351.",
    );
  }

  if (nacional.length !== 9) {
    return erro(
      `O número de telefone tem de ter 9 dígitos — indicou ${nacional.length}. Por exemplo 912 345 678.`,
    );
  }

  return ok;
}
