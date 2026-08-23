import { describe, expect, it } from "vitest";
import {
  formatarCodigoPostal,
  formatarIban,
  validarCodigoPostal,
  validarIban,
  validarNif,
  validarNipc,
  validarTelefone,
} from "./validacao-pt";

describe("validarNif", () => {
  it("aceita NIF de pessoa singular com checksum correto", () => {
    expect(validarNif("123456789").valido).toBe(true);
    expect(validarNif("229273394").valido).toBe(true);
  });

  it("aceita NIPC de pessoa coletiva", () => {
    expect(validarNif("500000000").valido).toBe(true);
  });

  it("aceita prefixo de dois dígitos de não residente", () => {
    expect(validarNif("450000001").valido).toBe(true);
  });

  it("ignora espaços", () => {
    expect(validarNif("123 456 789").valido).toBe(true);
  });

  it("rejeita checksum errado e diz porquê", () => {
    const r = validarNif("213456789");
    expect(r.valido).toBe(false);
    if (!r.valido) expect(r.mensagem).toContain("não é válido");
  });

  it("diz qual teria de ser o último dígito", () => {
    // 2·9+1·8+3·7+4·6+5·5+6·4+7·3+8·2 = 157; 157 % 11 = 3, logo o controlo é 8.
    const r = validarNif("213456789");
    if (!r.valido) expect(r.mensagem).toContain("teria de ser 8 e não 9");
  });

  it("rejeita primeiro dígito impossível", () => {
    const r = validarNif("400000000");
    expect(r.valido).toBe(false);
    if (!r.valido) expect(r.mensagem).toContain("1, 2, 3, 5, 6, 8 ou 9");
  });

  it("rejeita comprimento errado dizendo quantos dígitos foram indicados", () => {
    const r = validarNif("12345678");
    expect(r.valido).toBe(false);
    if (!r.valido) expect(r.mensagem).toContain("indicou 8");
  });

  it("rejeita letras", () => {
    expect(validarNif("12345678A").valido).toBe(false);
  });
});

describe("validarCodigoPostal", () => {
  it("aceita o formato 0000-000", () => {
    expect(validarCodigoPostal("1250-096").valido).toBe(true);
    expect(validarCodigoPostal(" 4000-123 ").valido).toBe(true);
  });

  it("rejeita sem hífen e explica o formato", () => {
    const r = validarCodigoPostal("1250096");
    expect(r.valido).toBe(false);
    if (!r.valido) expect(r.mensagem).toContain("0000-000");
  });

  it("rejeita dígitos a mais", () => {
    expect(validarCodigoPostal("1250-0967").valido).toBe(false);
  });
});

describe("formatarCodigoPostal", () => {
  it("insere o hífen à medida que se escreve", () => {
    expect(formatarCodigoPostal("1250")).toBe("1250");
    expect(formatarCodigoPostal("1250096")).toBe("1250-096");
    expect(formatarCodigoPostal("1250-096")).toBe("1250-096");
    expect(formatarCodigoPostal("12500961234")).toBe("1250-096");
  });
});

describe("validarIban", () => {
  it("aceita um IBAN português válido", () => {
    expect(validarIban("PT50000201231234567890154").valido).toBe(true);
  });

  it("aceita com espaços de leitura", () => {
    expect(validarIban("PT50 0002 0123 1234 5678 9015 4").valido).toBe(true);
  });

  it("aceita IBAN estrangeiro válido", () => {
    expect(validarIban("DE89370400440532013000").valido).toBe(true);
    expect(validarIban("GB82WEST12345698765432").valido).toBe(true);
  });

  it("rejeita comprimento errado dizendo o esperado", () => {
    const r = validarIban("PT5000020123123456789015");
    expect(r.valido).toBe(false);
    if (!r.valido) expect(r.mensagem).toContain("25 caracteres");
  });

  it("rejeita país desconhecido", () => {
    const r = validarIban("ZZ50000201231234567890154");
    expect(r.valido).toBe(false);
    if (!r.valido) expect(r.mensagem).toContain("ZZ");
  });

  it("rejeita checksum errado", () => {
    expect(validarIban("PT50000201231234567890155").valido).toBe(false);
  });
});

describe("formatarIban", () => {
  it("agrupa em blocos de 4", () => {
    expect(formatarIban("PT50000201231234567890154")).toBe(
      "PT50 0002 0123 1234 5678 9015 4",
    );
  });
});

/**
 * O NIPC, que é o NIF visto do sítio onde se abre o dossier de uma entidade.
 *
 * O `validarNif` responde a "isto é um NIF português válido?" e a resposta certa
 * para o NIF de uma pessoa singular é "sim". Na caixa do NIPC essa resposta está
 * errada em substância — e era um erro que passava por bom, ficava gravado, e só
 * se descobria meses depois com o processo já a correr.
 */
describe("validarNipc", () => {
  it("aceita os quatro primeiros dígitos de pessoa coletiva", () => {
    // 5 sociedades · 6 organismos públicos · 8 ENI · 9 condomínios e irregulares.
    expect(validarNipc("500000000").valido).toBe(true);
    expect(validarNipc("600000001").valido).toBe(true);
    expect(validarNipc("800000005").valido).toBe(true);
    expect(validarNipc("900000007").valido).toBe(true);
  });

  it("recusa um NIF de pessoa singular, apesar de o checksum fechar", () => {
    for (const nif of ["123456789", "213456788"]) {
      const r = validarNipc(nif);
      expect(validarNif(nif).valido).toBe(true);
      expect(r.valido).toBe(false);
      if (!r.valido) expect(r.mensagem).toContain("5, 6, 8 ou 9");
    }
  });

  it("recusa o 7 das heranças indivisas — não é entidade que se abra aqui", () => {
    expect(validarNif("700000003").valido).toBe(true);
    expect(validarNipc("700000003").valido).toBe(false);
  });

  /**
   * A ordem das duas verificações não é indiferente. Dizer "com estes oito
   * dígitos o último teria de ser X" sobre um número que nem sequer é de pessoa
   * coletiva manda corrigir a coisa errada — e o cliente acaba a inventar um
   * dígito de controlo para um número que nunca podia servir.
   */
  it("o primeiro dígito é dito antes do dígito de controlo", () => {
    const r = validarNipc("213456789"); // primeiro dígito errado *e* checksum errado
    expect(r.valido).toBe(false);
    if (!r.valido) {
      expect(r.mensagem).toContain("5, 6, 8 ou 9");
      expect(r.mensagem).not.toContain("dígito de controlo");
    }
  });

  it("o comprimento continua a ser dito pelo validarNif", () => {
    const r = validarNipc("5000");
    expect(r.valido).toBe(false);
    if (!r.valido) expect(r.mensagem).toContain("9 dígitos");
  });
});

/**
 * O telefone, com nove dígitos e não com "seis a quinze".
 *
 * A folga que aqui estava aceitava `123` e aceitava `9123456789`. O primeiro não
 * é número nenhum; o segundo é o defeito caro, porque um dígito a mais num
 * telemóvel português tem exatamente o aspeto de um número certo e só se
 * descobre quando alguém tenta ligar — semanas depois, a um cliente que já não
 * está a olhar para o formulário.
 */
describe("validarTelefone", () => {
  it("aceita com e sem indicativo, e com a formatação de quem copia do cartão", () => {
    expect(validarTelefone("+351 912 345 678").valido).toBe(true);
    expect(validarTelefone("912345678").valido).toBe(true);
    expect(validarTelefone("912 345 678").valido).toBe(true);
    expect(validarTelefone("00351912345678").valido).toBe(true);
    expect(validarTelefone("351912345678").valido).toBe(true);
    expect(validarTelefone("912-345-678").valido).toBe(true);
    expect(validarTelefone("(351) 912.345.678").valido).toBe(true);
    // Fixo, que começa por 2 e tem os mesmos nove dígitos.
    expect(validarTelefone("213456789").valido).toBe(true);
  });

  it("recusa com menos de nove dígitos e diz quantos contou", () => {
    const r = validarTelefone("123");
    expect(r.valido).toBe(false);
    if (!r.valido) {
      expect(r.mensagem).toContain("9 dígitos");
      expect(r.mensagem).toContain("indicou 3");
    }
  });

  it("recusa com dez dígitos — o caso que passava por bom", () => {
    const r = validarTelefone("9123456789");
    expect(r.valido).toBe(false);
    if (!r.valido) expect(r.mensagem).toContain("indicou 10");
  });

  it("o indicativo não conta para os nove", () => {
    // 9 dígitos depois do +351 passam; 10 não passam por levarem indicativo.
    expect(validarTelefone("+351 912 345 678").valido).toBe(true);
    expect(validarTelefone("+351 912 345 6789").valido).toBe(false);
  });

  it("um indicativo de outro país é recusado por ser de outro país", () => {
    const r = validarTelefone("+44 20 7946 0958");
    expect(r.valido).toBe(false);
    // A razão tem de ser a certa: lido como erro de contagem, o cliente ficava a
    // tentar acrescentar e tirar dígitos a um número que está bem escrito.
    if (!r.valido) expect(r.mensagem).toContain("números portugueses");
  });

  it("rejeita letras e explica o formato", () => {
    const r = validarTelefone("91234567A");
    expect(r.valido).toBe(false);
    if (!r.valido) expect(r.mensagem).toContain("+351");
  });

  it("um campo vazio pede o contacto, não o formato", () => {
    const r = validarTelefone("   ");
    expect(r.valido).toBe(false);
    if (!r.valido) expect(r.mensagem).toBe("Indique o contacto telefónico.");
  });
});
