import { describe, expect, it } from "vitest";
import { passo1, passo2, passo4, passo5 } from "./schemas";
import { mimeAceite } from "./formatos";

/**
 * O NIF de faturação tinha de aceitar números estrangeiros.
 *
 * O passo 2 aceita de propósito um número fiscal de outro país
 * (`nifPortugues = false`), mas o passo 5 impunha o mod-11 português a toda a
 * gente. Consequência: um cliente estrangeiro chegava ao penúltimo passo, era
 * obrigado a preencher o "NIF / NIPC" e não havia número nenhum que passasse —
 * nem sequer o dele. Ficava preso sem forma de perceber porquê.
 *
 * A regra passou a olhar para a forma do que foi escrito: nove dígitos é um
 * número português e leva o checksum inteiro (é o que apanha o dígito
 * trocado, a razão de ser da validação); qualquer outra forma é de outro país
 * e só se exige que exista.
 */

const base = {
  igualAoCliente: false,
  nome: "Maria Silva",
  morada: "Rua das Flores, 12",
  pais: "PT",
  localidade: "Porto",
  codigoPostal: "4000-001",
  freguesia: "Cedofeita",
  concelho: "Porto",
  distrito: "Porto",
  email: "maria@exemplo.pt",
  acIgualAoCliente: false,
};

const comNif = (nif: string) => passo5.safeParse({ ...base, nif });

/** O erro que caiu sobre o campo `nif`, se algum caiu. */
const erroNoNif = (r: ReturnType<typeof comNif>) =>
  r.success ? undefined : r.error.issues.find((i) => i.path[0] === "nif");

describe("NIF de faturação", () => {
  it("aceita um NIF português válido", () => {
    expect(erroNoNif(comNif("123456789"))).toBeUndefined();
    expect(erroNoNif(comNif("500000000"))).toBeUndefined();
  });

  it("recusa nove dígitos com o checksum errado — é o dígito trocado", () => {
    expect(erroNoNif(comNif("213456789"))).toBeDefined();
  });

  it("aceita um número fiscal estrangeiro, que nunca cumpriria o mod-11", () => {
    // Um VAT espanhol e um UTR britânico: formas que a regra portuguesa
    // rejeitava em bloco, e que bloqueavam o cliente no passo 5.
    expect(erroNoNif(comNif("ESX1234567L"))).toBeUndefined();
    expect(erroNoNif(comNif("1234567890"))).toBeUndefined();
  });

  it("continua a exigir que o campo seja preenchido", () => {
    expect(erroNoNif(comNif(""))).toBeDefined();
  });
});

/**
 * O passo 2 no percurso Empresa.
 *
 * Relatado como "o passo não avança e o anexo não fica preenchido". O anexo é
 * uma pista falsa: o schema não pede documento nenhum, e o campo de ficheiro é
 * limpo de propósito depois de o upload correr. O que travava o passo era o
 * único campo que o schema recusava — o NIF, com o dígito de controlo trocado.
 */
describe("passo 2 — percurso Empresa", () => {
  const empresa = {
    nifPortugues: true,
    resideEmPortugal: true,
    nif: "213456788",
    docTipo: "cartao_cidadao",
    docNumero: "12345678",
    docValidade: "2999-01-01",
    cae: "62010",
    codigoCertidaoPermanente: "12345",
    regimeIva: "normal",
  };

  const campos = (dados: Record<string, unknown>) => {
    const r = passo2.safeParse(dados);
    return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
  };

  it("não exige anexos — o passo fecha sem documento nenhum", () => {
    expect(campos(empresa)).toEqual([]);
  });

  it("os campos da entidade são opcionais; o NIF é o único que trava", () => {
    // Sem CAE, sem certidão e sem regime de IVA o passo passa na mesma: o que
    // faltava não era nada disto.
    expect(
      campos({ ...empresa, cae: undefined, codigoCertidaoPermanente: undefined, regimeIva: undefined }),
    ).toEqual([]);
  });

  it("recusa só o NIF quando o dígito de controlo está trocado", () => {
    expect(campos({ ...empresa, nif: "213456789" })).toEqual(["nif"]);
  });

  /**
   * Os três campos da entidade são `<select>`/`<input>` que mandam string vazia
   * enquanto ninguém lhes tocar, e o `carga()` do `Formulario` converte-os para
   * `undefined` com `|| undefined`. Sem essa conversão o `z.enum().optional()`
   * recebe `""`, que não é opção nenhuma, e o passo trava num campo opcional que
   * o cliente nunca abriu — "Falta corrigir um campo" sobre o Regime de IVA de
   * quem nem sequer é empresa. É o guard que sustenta o teste acima; fica aqui
   * fixado para não se perder numa simplificação do `carga()`.
   */
  it("um regime de IVA em branco não é o mesmo que ausente", () => {
    expect(campos({ ...empresa, regimeIva: undefined })).toEqual([]);
    expect(campos({ ...empresa, regimeIva: "" })).toEqual(["regimeIva"]);
  });

  it("o tipo de documento por escolher trava o passo, com mensagem própria", () => {
    // O `<select>` manda string vazia enquanto ninguém escolher. Sem esta
    // mensagem o resumo dizia "Invalid option" e o campo continuava por
    // identificar — que era a outra metade do "falta corrigir um campo".
    const r = passo2.safeParse({ ...empresa, docTipo: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const erro = r.error.issues.find((i) => i.path[0] === "docTipo");
      expect(erro?.message).toBe("Escolha o tipo de documento.");
    }
  });
});

/**
 * A pessoa coletiva passava o passo 1 sem dizer a sua forma jurídica: o campo
 * era `optional()` sem mais nada, e o detalhe do back-office mostrava a linha
 * vazia sem se saber se foi esquecimento.
 */
describe("passo 1 — percurso Empresa", () => {
  const empresa = {
    tipoCliente: "empresa",
    nome: "Silva & Costa, Lda.",
    nacionalidades: ["PT"],
    naturezaJuridica: "Sociedade por quotas",
    dataConstituicao: "2015-03-02",
    telefone: "+351 912 345 678",
    email: "geral@silvacosta.pt",
    morada: "Rua das Flores, 12",
    pais: "PT",
    localidade: "Porto",
    codigoPostal: "4000-001",
    freguesia: "Cedofeita",
    concelho: "Porto",
    distrito: "Porto",
  };

  const campos = (dados: Record<string, unknown>) => {
    const r = passo1.safeParse(dados);
    return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
  };

  it("aceita uma empresa completa", () => {
    expect(campos(empresa)).toEqual([]);
  });

  it("exige a natureza jurídica", () => {
    expect(campos({ ...empresa, naturezaJuridica: undefined })).toEqual(["naturezaJuridica"]);
  });

  it("recusa uma data de constituição no futuro, mas aceita-a em branco", () => {
    expect(campos({ ...empresa, dataConstituicao: "2999-01-01" })).toEqual(["dataConstituicao"]);
    expect(campos({ ...empresa, dataConstituicao: undefined })).toEqual([]);
  });

  it("não pede natureza jurídica a uma pessoa singular", () => {
    expect(
      campos({
        ...empresa,
        tipoCliente: "particular",
        naturezaJuridica: undefined,
        dataConstituicao: undefined,
        nome: "Maria Silva",
        profissao: "Arquiteta",
        entidadePatronal: "N/A",
        dataNascimento: "1985-06-14",
      }),
    ).toEqual([]);
  });
});

/**
 * Anexos do passo 2. O `accept` do campo anuncia extensões; o servidor recusava
 * por MIME, e o MIME que o browser declara falta com frequência — HEIC no
 * Chrome, `application/octet-stream` vindo de automação. Um ficheiro da lista
 * dos aceites era recusado, e como o campo se limpa a seguir ficava a parecer
 * que anexar não fazia nada.
 */
describe("formatos aceites nos anexos", () => {
  it("aceita o MIME quando o browser o declara", () => {
    expect(mimeAceite("bi.pdf", "application/pdf")).toBe("application/pdf");
    expect(mimeAceite("foto.png", "image/png")).toBe("image/png");
  });

  it("normaliza os MIME que alguns sistemas escrevem à sua maneira", () => {
    expect(mimeAceite("cc.jpg", "image/jpg")).toBe("image/jpeg");
    expect(mimeAceite("cc.heic", "image/heif")).toBe("image/heic");
  });

  it("cai na extensão quando o browser não declara tipo nenhum", () => {
    expect(mimeAceite("cc.heic", "")).toBe("image/heic");
    expect(mimeAceite("nif.pdf", "application/octet-stream")).toBe("application/pdf");
    expect(mimeAceite("NIF.PDF", "")).toBe("application/pdf");
  });

  it("a extensão não serve para contornar um tipo declarado", () => {
    // Diz-se HTML e chama-se `.pdf`: continua recusado. A extensão só desempata
    // quando não há tipo nenhum a contrariá-la.
    expect(mimeAceite("x.pdf", "text/html")).toBeNull();
  });

  it("recusa formatos fora da lista e nomes sem extensão", () => {
    expect(mimeAceite("contrato.docx", "")).toBeNull();
    expect(mimeAceite("semextensao", "")).toBeNull();
    expect(mimeAceite("arquivo.zip", "application/zip")).toBeNull();
  });
});

/**
 * As duas perguntas do passo 4 são declarações da Lei 83/2017, não
 * consentimentos: sem resposta, o passo tem de parar. O schema já o exigia — o
 * que faltava era o formulário deixar de converter "não respondeu" em "Não".
 */
describe("passo 4 — declarações de PPE", () => {
  const negocio = {
    servicos: "Avença",
    origemFundos: "Rendimentos do trabalho",
  };

  const erroEm = (dados: Record<string, unknown>, campo: string) => {
    const r = passo4.safeParse(dados);
    return r.success ? undefined : r.error.issues.find((i) => i.path[0] === campo);
  };

  it("aceita um Não dado de facto", () => {
    expect(passo4.safeParse({ ...negocio, ePpe: false, eRelacionadoPpe: false }).success).toBe(true);
  });

  it("recusa a pergunta por responder — não é o mesmo que responder Não", () => {
    expect(erroEm({ ...negocio, ePpe: undefined, eRelacionadoPpe: false }, "ePpe")).toBeDefined();
    expect(
      erroEm({ ...negocio, ePpe: false, eRelacionadoPpe: undefined }, "eRelacionadoPpe"),
    ).toBeDefined();
  });
});
