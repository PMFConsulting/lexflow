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
    // Dizer qual teria de ser o último dígito não enfraquece nada — o mod-11 é
    // aritmética pública, e a validação existe para apanhar o dígito trocado,
    // não para autenticar ninguém. O que muda é o cliente ficar a saber onde
    // olhar: "não é válido" sozinho manda-o reler os nove dígitos às cegas.
    return erro(
      `O NIF não é válido — com estes oito primeiros dígitos, o último teria de ser ${controlo} e não ${nif[8]}. Verifique se trocou algum dígito.`,
    );
  }

  return ok;
}

/**
 * Primeiro dígito de um número de pessoa coletiva.
 *
 * 5 sociedades comerciais · 6 organismos públicos · 8 empresário em nome
 * individual · 9 condomínios, heranças indivisas e pessoas coletivas
 * irregulares. Ficam de fora o 1, 2 e 3 (pessoas singulares) e os prefixos de
 * dois dígitos que começam por 4 e 7 — não residentes e heranças —, que o
 * `validarNif` continua a aceitar onde a pergunta é "isto é um NIF válido?".
 */
const PRIMEIRO_DIGITO_COLETIVA = ["5", "6", "8", "9"];

/**
 * NIPC — o NIF de uma pessoa coletiva.
 *
 * O `validarNif` responde a "isto é um NIF português válido?", e a resposta
 * certa para o NIF de uma pessoa singular é "sim". Só que, no sítio onde se
 * está a abrir o dossier de uma **entidade**, essa resposta está errada em
 * substância: um 2 ou um 3 no primeiro dígito é o número pessoal de alguém
 * escrito na caixa da empresa, e é um erro que passava por bom até alguém
 * reparar — quando repara — meses depois, com o processo já a correr.
 *
 * A ordem das duas verificações não é indiferente. O prefixo vem primeiro
 * porque é o defeito mais grosso: dizer "com estes oito dígitos o último teria
 * de ser 4" sobre um número que nem sequer é de pessoa coletiva manda corrigir
 * a coisa errada, e o cliente acaba a inventar um dígito de controlo para um
 * número que nunca podia servir. O comprimento fica para o `validarNif`, que
 * já o conta e já o diz.
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

/**
 * Tira ao número o indicativo português, se ele lá estiver.
 *
 * Devolve `null` quando o indicativo é de outro país — que é informação
 * diferente de "o número tem o tamanho errado" e merece outra mensagem.
 *
 * O `351` sem `+` nem `00` só conta como indicativo quando sobram exatamente
 * nove dígitos depois dele. Não é generosidade: nenhum número nacional começa
 * por 3 (fixos começam por 2, móveis por 9), por isso não há número legítimo de
 * nove dígitos a ser mutilado por esta regra.
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
 * Contacto telefónico — nove dígitos, com ou sem o indicativo de Portugal.
 *
 * O que aqui estava era um `^\+?\d{6,15}$`, e a folga não era neutra: aceitava
 * `123` e aceitava `9123456789`. O primeiro não é número nenhum; o segundo é o
 * defeito caro, porque um dígito a mais num telemóvel português tem exatamente
 * o aspeto de um número certo e só se descobre quando alguém tenta ligar — e
 * quem tenta ligar é a sociedade, semanas depois, a um cliente que já não está
 * a olhar para o formulário.
 *
 * Aceita-se `912 345 678`, `912345678`, `+351 912 345 678`, `00351912345678` e
 * as variantes com espaços, hífenes, pontos ou parênteses: são formas de
 * escrever o mesmo número, e recusar a formatação de quem copia do cartão de
 * visita é recusar o número certo pelo motivo errado.
 *
 * Só números portugueses, e é uma decisão de POC: o passo 2 aceita um NIF
 * estrangeiro de propósito, mas o telefone passa a exigir os nove dígitos
 * nacionais. Um indicativo de outro país é recusado com essa razão à frente,
 * para não se ler como erro de contagem.
 */
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
