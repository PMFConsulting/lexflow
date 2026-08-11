import { describe, expect, it } from "vitest";
import { passo1, passo2, passo3, passo4, passo5, passo6, passo7 } from "./schemas";
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

  const campos = (dados: Record<string, unknown>) => {
    const r = passo4.safeParse(dados);
    return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
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

  it("um Sim obriga a dizer qual cargo, onde e desde quando", () => {
    expect(
      campos({ ...negocio, ePpe: true, eRelacionadoPpe: false }).sort(),
    ).toEqual(["ppeCargo", "ppeEntidade", "ppeInicio", "ppePais"]);
  });

  it("o fim do exercício não pode ser anterior ao início", () => {
    expect(
      erroEm(
        {
          ...negocio,
          ePpe: true,
          eRelacionadoPpe: false,
          ppeCargo: "Secretário de Estado",
          ppePais: "PT",
          ppeEntidade: "Ministério das Finanças",
          ppeInicio: "2020-01-01",
          ppeFim: "2019-01-01",
        },
        "ppeFim",
      ),
    ).toBeDefined();
  });

  it("relacionado com uma PPE obriga a identificá-la e a dizer a relação", () => {
    expect(
      campos({ ...negocio, ePpe: false, eRelacionadoPpe: true }).sort(),
    ).toEqual(["ppeRelacionadaNome", "relacaoPpe"]);
  });

  /**
   * A origem de fundos é obrigatória em diligência normal, não só reforçada
   * (divergência D5). Um cliente que não seja PPE nenhuma continua a ter de a
   * declarar — e é justamente o percurso em que é fácil deixá-la cair.
   */
  it("os serviços e a origem dos fundos são obrigatórios mesmo sem PPE nenhuma", () => {
    expect(campos({ ePpe: false, eRelacionadoPpe: false }).sort()).toEqual([
      "origemFundos",
      "servicos",
    ]);
  });
});

/* ── passo 1, percurso Particular ─────────────────────────────────────── */

/**
 * O percurso que a POC percorreu de ponta a ponta em produção, e o único cujas
 * exigências próprias — profissão, entidade patronal, data de nascimento —
 * nenhum teste fixava. São elas que separam uma pessoa singular de uma pessoa
 * coletiva neste passo, e caem no mesmo `superRefine` que a natureza jurídica.
 */
describe("passo 1 — percurso Particular", () => {
  const particular = {
    tipoCliente: "particular",
    nome: "Maria Silva",
    profissao: "Arquiteta",
    entidadePatronal: "N/A",
    dataNascimento: "1985-06-14",
    nacionalidades: ["PT"],
    telefone: "+351 912 345 678",
    email: "maria@exemplo.pt",
    morada: "Rua das Flores, 12",
    pais: "pt",
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

  it("aceita uma pessoa singular completa e sobe o país a maiúsculas", () => {
    const r = passo1.safeParse(particular);

    expect(r.success).toBe(true);
    if (!r.success) return;
    // O `pais` é `.length(2).transform(toUpperCase)`: quem escreve "pt" à mão
    // não pode acabar com um código que não bate com o da lista.
    expect(r.data.pais).toBe("PT");
    expect(r.data.nacionalidades).toEqual(["PT"]);
  });

  it("exige profissão, entidade patronal e data de nascimento", () => {
    expect(
      campos({
        ...particular,
        profissao: undefined,
        entidadePatronal: undefined,
        dataNascimento: undefined,
      }).sort(),
    ).toEqual(["dataNascimento", "entidadePatronal", "profissao"]);
  });

  it("recusa uma data de nascimento no futuro", () => {
    expect(campos({ ...particular, dataNascimento: "2999-01-01" })).toEqual(["dataNascimento"]);
  });

  it("exige pelo menos uma nacionalidade", () => {
    expect(campos({ ...particular, nacionalidades: [] })).toEqual(["nacionalidades"]);
  });

  /**
   * As três validações PT no mesmo passo. O que se fixa não é cada uma delas —
   * `validacao-pt.test.ts` já o faz — mas que o resumo de erros nomeia os três
   * campos em vez de parar no primeiro: é isso que dá "Falta corrigir um campo"
   * quando faltam três.
   */
  it("nomeia todos os campos mal preenchidos, e não só o primeiro", () => {
    expect(
      campos({
        ...particular,
        telefone: "91234567A",
        email: "maria@exemplo",
        codigoPostal: "1250096",
      }).sort(),
    ).toEqual(["codigoPostal", "email", "telefone"]);
  });

  it("não pede profissão nem data de nascimento a uma pessoa coletiva", () => {
    expect(
      campos({
        ...particular,
        tipoCliente: "empresa",
        nome: "Silva & Costa, Lda.",
        naturezaJuridica: "Sociedade por quotas",
        profissao: undefined,
        entidadePatronal: undefined,
        dataNascimento: undefined,
      }),
    ).toEqual([]);
  });
});

/* ── passo 2, o documento de identificação ────────────────────────────── */

/**
 * O documento fora de validade é uma das travas que a POC foi percorrida a
 * confirmar em produção, e não estava fixada em teste nenhum. É KYC: aceitar um
 * cartão de cidadão caducado é aceitar uma identificação que a Lei 83/2017 não
 * considera feita.
 */
describe("passo 2 — documento de identificação", () => {
  const fiscal = {
    nifPortugues: true,
    resideEmPortugal: true,
    nif: "123456789",
    docTipo: "cartao_cidadao",
    docNumero: "12345678",
    docValidade: "2999-01-01",
  };

  const campos = (dados: Record<string, unknown>) => {
    const r = passo2.safeParse(dados);
    return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
  };

  const mensagens = (dados: Record<string, unknown>, campo: string) => {
    const r = passo2.safeParse(dados);
    return r.success ? [] : r.error.issues.filter((i) => i.path[0] === campo).map((i) => i.message);
  };

  it("aceita um documento dentro de validade", () => {
    expect(campos(fiscal)).toEqual([]);
  });

  it("recusa um documento caducado, e diz para o renovar", () => {
    expect(campos({ ...fiscal, docValidade: "2020-01-01" })).toEqual(["docValidade"]);
    expect(mensagens({ ...fiscal, docValidade: "2020-01-01" }, "docValidade")).toContain(
      "O documento está fora de validade. Renove-o antes de continuar.",
    );
  });

  it("recusa uma data que não é data nenhuma", () => {
    expect(mensagens({ ...fiscal, docValidade: "sem validade" }, "docValidade")).toContain(
      "Data inválida.",
    );
  });

  it("exige a data de validade e o número do documento", () => {
    expect(mensagens({ ...fiscal, docValidade: "" }, "docValidade")).toContain(
      "A data de validade é obrigatória.",
    );
    expect(campos({ ...fiscal, docNumero: "" })).toEqual(["docNumero"]);
  });

  /**
   * O mod-11 é do NIF português e só dele. O interruptor `nifPortugues` existe
   * para isto: um TIN estrangeiro tem outra forma, e aplicar-lhe o checksum
   * seria recusar clientes legítimos à entrada — o mesmo beco que o passo 5 já
   * teve.
   */
  it("o mod-11 só morde quando o NIF é português", () => {
    expect(campos({ ...fiscal, nif: "123456788" })).toEqual(["nif"]);
    expect(campos({ ...fiscal, nifPortugues: false, nif: "X1234567L" })).toEqual([]);
    expect(campos({ ...fiscal, nifPortugues: false, nif: "123456788" })).toEqual([]);
  });

  it("o número de contribuinte é sempre obrigatório, seja de onde for", () => {
    expect(campos({ ...fiscal, nif: "" })).toEqual(["nif", "nif"]);
    expect(campos({ ...fiscal, nifPortugues: false, nif: "" })).toEqual(["nif"]);
  });
});

/* ── passo 3, o Representante Legal ───────────────────────────────────── */

/**
 * O passo que já saiu do fluxo (D19) e voltou (D22), e que só aparece a pessoas
 * coletivas (D28) com a pergunta invertida (D29). Nada disto estava fixado no
 * schema: `passos.test.ts` cobre quem percorre o passo, e ninguém cobria o que
 * o passo exige depois de aberto.
 *
 * A regra é a que a D29 escreveu: **Sim** avança — quem preenche já se
 * identificou no passo 1 — e **Não** abre a identificação inteira de quem age
 * em nome da entidade, com o mesmo rigor do passo 1.
 */
describe("passo 3 — Representante Legal", () => {
  const representante = {
    eRepresentante: false,
    relacao: "Gerente",
    nome: "João Massano",
    dataNascimento: "1970-01-01",
    nacionalidades: ["PT"],
    profissao: "Advogado",
    telefone: "+351 912 345 678",
    email: "joao@silvacosta.pt",
    morada: "Rua das Flores, 12",
    pais: "PT",
    localidade: "Porto",
    codigoPostal: "4000-001",
    freguesia: "Cedofeita",
    concelho: "Porto",
    distrito: "Porto",
  };

  const campos = (dados: Record<string, unknown>) => {
    const r = passo3.safeParse(dados);
    return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
  };

  it("um Sim fecha o passo sem mais nada — quem preenche já se identificou", () => {
    expect(campos({ eRepresentante: true })).toEqual([]);
  });

  it("a pergunta por responder trava o passo — não tem resposta de partida", () => {
    expect(campos({})).toContain("eRepresentante");
  });

  it("um Não exige a identificação inteira de quem representa", () => {
    expect(campos({ eRepresentante: false }).sort()).toEqual([
      "codigoPostal",
      "concelho",
      "dataNascimento",
      "distrito",
      "email",
      "freguesia",
      "localidade",
      "morada",
      "nacionalidades",
      "nome",
      "pais",
      "profissao",
      "relacao",
      "telefone",
    ]);
  });

  it("um Não com tudo preenchido passa", () => {
    expect(campos(representante)).toEqual([]);
  });

  it("o primeiro campo pergunta o Cargo, não a relação com o cliente final", () => {
    const r = passo3.safeParse({ eRepresentante: false });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.find((i) => i.path[0] === "relacao")?.message).toBe(
      "Indique o cargo do representante legal.",
    );
  });

  it("as validações PT valem aqui como valem no passo 1", () => {
    expect(
      campos({
        ...representante,
        telefone: "91234567A",
        email: "joao@silvacosta",
        codigoPostal: "4000001",
        dataNascimento: "2999-01-01",
      }).sort(),
    ).toEqual(["codigoPostal", "dataNascimento", "email", "telefone"]);
  });

  it("com Sim, um campo mal preenchido que sobrou de um Não já não trava", () => {
    // Voltar atrás e trocar para Sim não pode ficar bloqueado por lixo do
    // percurso anterior: os campos deixam de ser lidos, não de existir.
    expect(campos({ ...representante, eRepresentante: true, telefone: "91234567A" })).toEqual([]);
  });
});

/* ── passo 6, RGPD ────────────────────────────────────────────────────── */

/**
 * Os consentimentos. Cada "sim" aqui grava uma linha em `consentimento` com a
 * versão do texto que a pessoa viu (D3/D38), e cada caixa de texto por
 * preencher é uma resposta que não conta nada — daí as obrigatoriedades
 * condicionais serem parte do consentimento e não conforto de formulário.
 */
describe("passo 6 — RGPD", () => {
  const campos = (dados: Record<string, unknown>) => {
    const r = passo6.safeParse(dados);
    return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
  };

  it("aceita a resposta mínima — como chegou até nós, e mais nada", () => {
    const r = passo6.safeParse({ origemContacto: "pesquisa_online" });

    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.newsletter).toBe(false);
    expect(r.data.convitesIniciativas).toBe(false);
    expect(r.data.emailsNewsletter).toEqual([]);
  });

  it("exige que se indique como chegou até nós", () => {
    expect(campos({})).toContain("origemContacto");
    expect(campos({ origemContacto: "" })).toContain("origemContacto");
  });

  it("uma recomendação sem dizer de quem não é resposta", () => {
    expect(campos({ origemContacto: "recomendacao" })).toEqual(["origemDetalhe"]);
    expect(campos({ origemContacto: "recomendacao", origemDetalhe: "Dr. Costa" })).toEqual([]);
  });

  /** "Outro" em branco é a pergunta a devolver-se a si própria (análise de 07/08). */
  it("um Outro sem explicação não é resposta", () => {
    expect(campos({ origemContacto: "outro" })).toEqual(["origemDetalhe"]);
    expect(campos({ origemContacto: "outro", origemDetalhe: "LinkedIn" })).toEqual([]);
  });

  it("a newsletter sem endereço nenhum trava", () => {
    expect(campos({ origemContacto: "pesquisa_online", newsletter: true })).toEqual([
      "emailsNewsletter",
    ]);
  });

  it("um endereço de newsletter inválido é nomeado pela sua posição na lista", () => {
    expect(
      campos({
        origemContacto: "pesquisa_online",
        newsletter: true,
        emailsNewsletter: ["maria@exemplo.pt", "geral@exemplo"],
      }),
    ).toEqual(["emailsNewsletter.1"]);
  });

  it("os convites trazem nome e email, e recusam um email inválido", () => {
    expect(campos({ origemContacto: "pesquisa_online", convitesIniciativas: true }).sort()).toEqual(
      ["convitesEmail", "convitesNome"],
    );
    expect(
      campos({
        origemContacto: "pesquisa_online",
        convitesIniciativas: true,
        convitesNome: "Maria Silva",
        convitesEmail: "maria@exemplo",
      }),
    ).toEqual(["convitesEmail"]);
  });

  /** "Outra área" com caixa livre entra na lista como mais um valor — sem migração. */
  it("as áreas de interesse são texto livre", () => {
    const r = passo6.safeParse({
      origemContacto: "evento_conferencia",
      areasInteresse: ["Direito Fiscal", "Direito do Desporto"],
    });

    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.areasInteresse).toEqual(["Direito Fiscal", "Direito do Desporto"]);
  });
});

/* ── passo 7, o Fecho ─────────────────────────────────────────────────── */

/**
 * As quatro travas da submissão, do lado do schema. Uma quinta — os T&C e a
 * proposta só se poderem aceitar depois de cada documento ser percorrido até
 * ao fim (D30, e o mesmo padrão no `LeitorProposta`) — é dos leitores e não
 * daqui; o que aqui se garante é que nenhuma das caixas por marcar passa,
 * qualquer que tenha sido o caminho até ela.
 */
describe("passo 7 — Fecho", () => {
  const RUBRICA = `data:image/png;base64,${"iVBORw0KGgoAAAANSUhEUg".repeat(4)}`;

  const fecho = {
    declaracaoVeracidade: true,
    tcAceitacao: true,
    propostaAceitacao: true,
    assinatura: RUBRICA,
  };

  const mensagens = (dados: Record<string, unknown>, campo: string) => {
    const r = passo7.safeParse(dados);
    return r.success ? [] : r.error.issues.filter((i) => i.path[0] === campo).map((i) => i.message);
  };

  const campos = (dados: Record<string, unknown>) => {
    const r = passo7.safeParse(dados);
    return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
  };

  it("aceita a declaração, os T&C, a proposta e a rubrica", () => {
    expect(campos(fecho)).toEqual([]);
  });

  it("os T&C são obrigatórios, com a mensagem que o ecrã mostra", () => {
    expect(campos({ ...fecho, tcAceitacao: false })).toEqual(["tcAceitacao"]);
    expect(mensagens({ ...fecho, tcAceitacao: false }, "tcAceitacao")).toContain(
      "Tem de aceitar os Termos e Condições para submeter.",
    );
    // Por responder é o mesmo que recusado — a caixa não vem marcada.
    expect(campos({ ...fecho, tcAceitacao: undefined })).toEqual(["tcAceitacao"]);
  });

  it("a proposta de honorários é obrigatória, separada dos T&C", () => {
    expect(campos({ ...fecho, propostaAceitacao: false })).toEqual(["propostaAceitacao"]);
    expect(mensagens({ ...fecho, propostaAceitacao: false }, "propostaAceitacao")).toContain(
      "Tem de aceitar a proposta de honorários para submeter.",
    );
    expect(campos({ ...fecho, propostaAceitacao: undefined })).toEqual(["propostaAceitacao"]);
    // Aceitar uma não vale pela outra.
    expect(campos({ ...fecho, tcAceitacao: false, propostaAceitacao: false }).sort()).toEqual(
      ["propostaAceitacao", "tcAceitacao"].sort(),
    );
  });

  it("a declaração de veracidade é obrigatória", () => {
    expect(campos({ ...fecho, declaracaoVeracidade: false })).toEqual(["declaracaoVeracidade"]);
    expect(campos({ ...fecho, declaracaoVeracidade: undefined })).toEqual(["declaracaoVeracidade"]);
  });

  it("as quatro travas aparecem juntas quando o passo chega vazio", () => {
    expect(campos({}).sort()).toEqual(
      ["assinatura", "declaracaoVeracidade", "propostaAceitacao", "tcAceitacao"].sort(),
    );
  });

  it("sem rubrica não há submissão", () => {
    expect(mensagens({ ...fecho, assinatura: "" }, "assinatura")).toContain(
      "Assine no quadro antes de submeter.",
    );
  });

  /** O quadro devolve PNG. Outra coisa é sinal de que a leitura correu mal. */
  it("uma rubrica que não é PNG é recusada", () => {
    expect(mensagens({ ...fecho, assinatura: "data:image/jpeg;base64,AAAA" }, "assinatura")).toContain(
      "A assinatura não foi lida corretamente. Limpe o quadro e tente de novo.",
    );
  });

  it("uma rubrica desmesurada é recusada", () => {
    const enorme = `data:image/png;base64,${"A".repeat(1_400_000)}`;
    expect(mensagens({ ...fecho, assinatura: enorme }, "assinatura")).toContain(
      "A assinatura ficou demasiado pesada.",
    );
  });
});
