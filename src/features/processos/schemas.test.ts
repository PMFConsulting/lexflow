import { describe, expect, it } from "vitest";
import { novoProcesso } from "./schemas";

/**
 * A janela "Novo processo", à entrada do servidor.
 *
 * O que aqui se fixa com mais cuidado é o email — é por ele que o link de
 * registo segue, e um email que se perca entre a caixa e a Server Action não dá
 * erro nenhum: o processo nasce à mesma, o link aparece no ecrã à mesma, e a
 * única diferença é que o cliente nunca recebe nada. Um `undefined` silencioso
 * salta o `if (emailCliente)` de `criarProcesso` sem deixar rasto.
 */

describe("novoProcesso — pessoa singular", () => {
  it("aceita um processo sem nome nem email", () => {
    const r = novoProcesso.safeParse({ tipoCliente: "particular" });
    expect(r.success).toBe(true);
  });

  it("mantém o email quando ele vem preenchido", () => {
    const r = novoProcesso.safeParse({
      tipoCliente: "particular",
      nome: "Maria Silva",
      email: "maria@exemplo.pt",
    });

    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.email).toBe("maria@exemplo.pt");
  });

  it("trata uma caixa em branco como pergunta não respondida, não como erro", () => {
    const r = novoProcesso.safeParse({ tipoCliente: "particular", nome: "  ", email: "   " });

    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.email).toBeUndefined();
    expect(r.data.nome).toBeUndefined();
  });

  it("recusa um email sem domínio em vez de o deitar fora em silêncio", () => {
    const r = novoProcesso.safeParse({ tipoCliente: "particular", email: "maria@exemplo" });

    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0]?.path).toEqual(["email"]);
  });

  it("não pede NIF a uma pessoa singular", () => {
    const r = novoProcesso.safeParse({ tipoCliente: "particular", email: "a@b.pt" });
    expect(r.success).toBe(true);
  });
});

/**
 * A carga exata que o `BotaoNovoProcesso` constrói, chave a chave.
 *
 * Os testes de cima passam objetos escritos à mão; a janela passa
 * `{ nome: nomeLimpo || undefined, email: destinatario || undefined }`, que é
 * uma coisa diferente — a chave **está lá**, com o valor `undefined`. Uma chave
 * presente e uma chave ausente não são o mesmo objeto para um
 * `z.preprocess(...)`, e a diferença entre as duas decide se o email sobrevive
 * ao `safeParse` ou se chega ao `if (emailCliente)` já apagado.
 *
 * Se este bloco alguma vez ficar vermelho, é este o defeito: o processo nasce à
 * mesma, o link aparece no ecrã à mesma, e o cliente nunca recebe nada — sem
 * uma linha em `email_log` a dizer porquê, porque o envio nem chega a ser
 * tentado.
 */
describe("novoProcesso — a carga que a janela envia mesmo", () => {
  it("guarda o email quando o nome vai a undefined ao lado dele", () => {
    const r = novoProcesso.safeParse({
      tipoCliente: "particular",
      nome: undefined,
      email: "teste1@emalupe.com",
    });

    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.email).toBe("teste1@emalupe.com");
  });

  it("aceita os dois campos a undefined sem os tratar como resposta inválida", () => {
    const r = novoProcesso.safeParse({
      tipoCliente: "particular",
      nome: undefined,
      email: undefined,
    });

    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.email).toBeUndefined();
  });

  it("guarda o email no percurso Empresa, com denominação e NIPC ao lado", () => {
    const r = novoProcesso.safeParse({
      tipoCliente: "empresa",
      nome: "Silva & Costa, Lda.",
      nif: "501442600",
      email: "teste1@emalupe.com",
    });

    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.email).toBe("teste1@emalupe.com");
  });

  /**
   * O `emailCliente` de `criarProcesso` é `email?.toLowerCase()`, e é ele que
   * abre o `if`. Um endereço escrito em maiúsculas tem de continuar a ser um
   * endereço depois do schema — não um `undefined` que salta o envio.
   */
  it("um endereço em maiúsculas continua a ser um endereço", () => {
    const r = novoProcesso.safeParse({
      tipoCliente: "particular",
      email: "  TESTE1@Emalupe.COM  ",
    });

    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.email?.toLowerCase()).toBe("teste1@emalupe.com");
  });
});

describe("novoProcesso — pessoa coletiva", () => {
  const valido = {
    tipoCliente: "empresa" as const,
    nome: "Silva & Costa, Lda.",
    nif: "501442600",
    email: "geral@silvacosta.pt",
  };

  it("aceita denominação, NIPC e email", () => {
    const r = novoProcesso.safeParse(valido);

    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.email).toBe("geral@silvacosta.pt");
  });

  it("exige a denominação social", () => {
    const r = novoProcesso.safeParse({ ...valido, nome: "" });

    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0]?.path).toEqual(["nome"]);
  });

  it("exige o NIPC", () => {
    const r = novoProcesso.safeParse({ ...valido, nif: "" });

    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0]?.path).toEqual(["nif"]);
  });

  /** Um dígito trocado é erro de cópia — é isso que o mod-11 apanha. */
  it("recusa um NIPC com o dígito de controlo errado", () => {
    const r = novoProcesso.safeParse({ ...valido, nif: "501442601" });

    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0]?.path).toEqual(["nif"]);
  });

  /**
   * A régua que o mod-11 sozinho não podia dar.
   *
   * Um NIF de pessoa singular passa o checksum com distinção — é um NIF válido,
   * só não é o de uma entidade — e ficava gravado em `nif_cliente` a dizer que a
   * sociedade é aquela pessoa. Aqui a certidão está à frente de quem escreve: o
   * primeiro dígito é 5, 6, 8 ou 9, e mais nenhum.
   */
  it("recusa um NIF de pessoa singular na caixa do NIPC", () => {
    for (const nif of ["123456789", "213456788"]) {
      const r = novoProcesso.safeParse({ ...valido, nif });
      expect(r.success).toBe(false);
      if (r.success) return;
      expect(r.error.issues[0]?.path).toEqual(["nif"]);
      expect(r.error.issues[0]?.message).toContain("5, 6, 8 ou 9");
    }
  });

  it("aceita os quatro primeiros dígitos de pessoa coletiva", () => {
    for (const nif of ["500000000", "600000001", "800000005", "900000007"]) {
      expect(novoProcesso.safeParse({ ...valido, nif }).success).toBe(true);
    }
  });

  it("normaliza o NIPC escrito com espaços", () => {
    const r = novoProcesso.safeParse({ ...valido, nif: " 501 442 600 " });

    expect(r.success).toBe(true);
    if (!r.success) return;
    // `novoProcesso` é uma união discriminada e o NIPC só existe no ramo
    // `empresa`. O narrow é também asserção: se o discriminante saísse errado,
    // o teste passava a verde sem chegar a olhar para o número.
    expect(r.data.tipoCliente).toBe("empresa");
    if (r.data.tipoCliente !== "empresa") return;
    expect(r.data.nif).toBe("501442600");
  });

  it("deixa criar uma entidade sem email — o link entrega-se por outra via", () => {
    const r = novoProcesso.safeParse({ ...valido, email: "" });

    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.email).toBeUndefined();
  });
});

/**
 * O discriminante e os limites.
 *
 * `tipoCliente` não é um campo entre outros: é ele que escolhe qual dos dois
 * objetos da união se aplica, e portanto se o NIPC é obrigatório ou nem sequer
 * existe. Um valor fora dos dois tem de parar aqui — a jusante, `criarProcesso`
 * grava-o em `processo_onboarding.tipo_cliente`, que é um enum do Postgres, e o
 * que se ganharia era um 500 em vez de um erro por baixo da caixa certa.
 */
describe("novoProcesso — o discriminante e os limites", () => {
  it("recusa um tipo de cliente que não é nenhum dos dois", () => {
    expect(novoProcesso.safeParse({ tipoCliente: "particular " }).success).toBe(false);
    expect(novoProcesso.safeParse({ tipoCliente: "sociedade" }).success).toBe(false);
  });

  it("recusa a carga sem tipo de cliente nenhum", () => {
    expect(novoProcesso.safeParse({ email: "maria@exemplo.pt" }).success).toBe(false);
    expect(novoProcesso.safeParse({}).success).toBe(false);
  });

  /** 200 é o que a coluna aceita; deixar passar mais é trocar um erro por um 500. */
  it("trava o nome nos 200 caracteres, nos dois percursos", () => {
    const comprido = "a".repeat(201);

    const particular = novoProcesso.safeParse({ tipoCliente: "particular", nome: comprido });
    expect(particular.success).toBe(false);
    if (!particular.success) expect(particular.error.issues[0]?.path).toEqual(["nome"]);

    const empresa = novoProcesso.safeParse({
      tipoCliente: "empresa",
      nome: comprido,
      nif: "501442600",
    });
    expect(empresa.success).toBe(false);
    if (!empresa.success) expect(empresa.error.issues[0]?.path).toEqual(["nome"]);
  });

  it("aceita exatamente 200 caracteres", () => {
    const limite = "a".repeat(200);
    expect(novoProcesso.safeParse({ tipoCliente: "particular", nome: limite }).success).toBe(true);
  });

  /**
   * Uma denominação de uma letra não é denominação. O `min(2)` é o que separa
   * "ainda estou a escrever" de "está escrito" — e no percurso Empresa a
   * denominação é o que identifica a entidade antes de o cliente tocar no
   * formulário.
   */
  it("uma denominação social de uma letra não passa", () => {
    const r = novoProcesso.safeParse({ tipoCliente: "empresa", nome: "S", nif: "501442600" });

    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0]?.path).toEqual(["nome"]);
  });
});
