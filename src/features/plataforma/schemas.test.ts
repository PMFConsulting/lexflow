import { describe, expect, it } from "vitest";
import { validarPapelESociedade } from "./contas";
import { contaSchema, erros, sociedadeComAdminSchema, sociedadeSchema } from "./schemas";

/**
 * O que o portal da plataforma aceita escrever.
 *
 * A fronteira que estes testes guardam é uma só e está em dois sítios: um papel
 * de sociedade **tem** sociedade, e o `super_admin` **não tem**. A base de dados
 * diz o mesmo (`utilizador_org_por_papel`, migração `0016`), e é ela que
 * garante o resultado — isto é o que garante a **mensagem**, que é o que
 * distingue um formulário utilizável de um `violates check constraint` no ecrã.
 */

/* ------------------------------------------------------------- sociedades */

describe("sociedadeSchema", () => {
  it("aceita uma sociedade bem preenchida e normaliza o prefixo", () => {
    const r = sociedadeSchema.safeParse({
      nome: "  Silva   &  Antunes ",
      nif: "500 000 000",
      prefixoReferencia: " sa ",
    });

    expect(r.success).toBe(true);
    if (!r.success) return;
    // Espaços a mais colapsados, prefixo em maiúsculas, NIPC sem espaços: quem
    // escreve "sa" está a escrever o prefixo certo em minúsculas, e recusá-lo
    // era fazer adivinhar uma regra de formatação que a plataforma aplica.
    expect(r.data).toEqual({
      nome: "Silva & Antunes",
      nif: "500000000",
      prefixoReferencia: "SA",
    });
  });

  /**
   * NIPC e não NIF (D54): o NIF de uma pessoa singular é uma resposta errada em
   * substância neste campo — ficava gravado como sendo o da entidade.
   */
  it("recusa um NIF de pessoa singular no campo do NIPC", () => {
    const r = sociedadeSchema.safeParse({
      nome: "Silva & Antunes",
      nif: "123456789",
      prefixoReferencia: "SA",
    });

    expect(r.success).toBe(false);
  });

  it("recusa um NIPC com o dígito de controlo errado", () => {
    const r = sociedadeSchema.safeParse({
      nome: "Silva & Antunes",
      nif: "500000001",
      prefixoReferencia: "SA",
    });

    expect(r.success).toBe(false);
  });

  it("recusa prefixos com espaços, acentos ou fora do tamanho", () => {
    for (const prefixoReferencia of ["S A", "SÃO", "A", "DEMASIADO"]) {
      const r = sociedadeSchema.safeParse({
        nome: "Sociedade",
        nif: "500000000",
        prefixoReferencia,
      });
      expect(r.success, `"${prefixoReferencia}" devia ter sido recusado`).toBe(false);
    }
  });
});

describe("sociedadeComAdminSchema", () => {
  const SOCIEDADE = { nome: "Sociedade", nif: "500000000", prefixoReferencia: "SOC" };

  it("aceita uma sociedade sem administrador — é para poder ficar para depois", () => {
    expect(sociedadeComAdminSchema.safeParse(SOCIEDADE).success).toBe(true);
  });

  it("aceita a sociedade com o primeiro administrador", () => {
    const r = sociedadeComAdminSchema.safeParse({
      ...SOCIEDADE,
      adminNome: "Maria Silva",
      adminEmail: "maria@exemplo.pt",
    });
    expect(r.success).toBe(true);
  });

  /**
   * Meio preenchido é o estado que produz uma sociedade criada com um
   * administrador por criar e ninguém a dar por isso. Ou vêm os dois, ou não vem
   * nenhum.
   */
  it("recusa o administrador meio preenchido, e diz qual metade falta", () => {
    const semEmail = sociedadeComAdminSchema.safeParse({ ...SOCIEDADE, adminNome: "Maria" });
    expect(erros(semEmail)).toHaveProperty("adminEmail");

    const semNome = sociedadeComAdminSchema.safeParse({
      ...SOCIEDADE,
      adminEmail: "maria@exemplo.pt",
    });
    expect(erros(semNome)).toHaveProperty("adminNome");
  });

  it("recusa um email de administrador malformado", () => {
    const r = sociedadeComAdminSchema.safeParse({
      ...SOCIEDADE,
      adminNome: "Maria",
      adminEmail: "maria arroba exemplo",
    });
    expect(erros(r)).toHaveProperty("adminEmail");
  });

  /**
   * O formulário deixou de ter caixa de palavra-passe, e o schema deixou de a
   * aceitar. Um `optional()` esquecido aqui era o processo antigo à espera de
   * voltar — bastava um formulário mandar o valor.
   */
  it("ignora uma palavra-passe mandada à mão para o administrador", () => {
    const r = sociedadeComAdminSchema.safeParse({
      ...SOCIEDADE,
      adminNome: "Maria",
      adminEmail: "maria@exemplo.pt",
      adminPalavraPasse: "escolhida-por-terceiros",
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).not.toHaveProperty("adminPalavraPasse");
  });
});

/* ----------------------------------------------------------------- contas */

describe("contaSchema", () => {
  const VALIDA = {
    nome: "Maria Silva",
    email: "  MARIA@Exemplo.PT ",
    papel: "utilizador",
    organizacaoId: "0197a1c0-0000-7000-8000-0000000000aa",
  };

  it("aceita uma conta de sociedade e normaliza o email", () => {
    const r = contaSchema.safeParse(VALIDA);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.email).toBe("maria@exemplo.pt");
  });

  it("aceita os dois papéis de sociedade", () => {
    for (const papel of ["society_admin", "utilizador"]) {
      expect(contaSchema.safeParse({ ...VALIDA, papel }).success).toBe(true);
    }
  });

  /**
   * A fronteira mais importante do portal.
   *
   * Sem ela, um `society_admin` — que também chama este Server Action — criava,
   * com um valor de campo, uma conta com acesso a **todas** as sociedades do
   * sistema. O `super_admin` cria-se noutro formulário, com outro guard.
   */
  it("não deixa criar um super_admin pelo caminho das contas de sociedade", () => {
    const r = contaSchema.safeParse({ ...VALIDA, papel: "super_admin" });
    expect(r.success).toBe(false);
  });

  it("recusa os papéis antigos, que já não existem no enum", () => {
    for (const papel of ["admin", "socio", "advogado", "assistente"]) {
      expect(contaSchema.safeParse({ ...VALIDA, papel }).success).toBe(false);
    }
  });

  it("exige a sociedade — uma conta de sociedade sem sociedade não existe", () => {
    const r = contaSchema.safeParse({ ...VALIDA, organizacaoId: "" });
    expect(erros(r)).toHaveProperty("organizacaoId");
  });

  /**
   * A palavra-passe é sempre gerada pelo servidor e enviada por email à pessoa.
   * O schema não a aceita de fora — nem em branco, nem escolhida: um campo
   * opcional era uma porta para o processo antigo voltar sem ninguém decidir
   * nada.
   */
  it("não aceita uma palavra-passe vinda do formulário", () => {
    const r = contaSchema.safeParse({ ...VALIDA, palavraPasse: "escolhida-a-mao" });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).not.toHaveProperty("palavraPasse");
  });
});

/* -------------------------------------------------- o gate, no seu próprio */

describe("validarPapelESociedade", () => {
  it("os papéis de sociedade exigem uma sociedade", () => {
    expect(validarPapelESociedade("society_admin", null)).toMatch(/Escolha a sociedade/);
    expect(validarPapelESociedade("utilizador", null)).toMatch(/Escolha a sociedade/);
  });

  it("o dono da plataforma não pode ter sociedade", () => {
    expect(validarPapelESociedade("super_admin", "org-1")).toMatch(/não pertence/);
  });

  it("as três combinações certas passam", () => {
    expect(validarPapelESociedade("super_admin", null)).toBeNull();
    expect(validarPapelESociedade("society_admin", "org-1")).toBeNull();
    expect(validarPapelESociedade("utilizador", "org-1")).toBeNull();
  });
});

/* ------------------------------------------------------------------ erros */

describe("erros", () => {
  it("dá um erro por campo — o primeiro", () => {
    const r = sociedadeSchema.safeParse({ nome: "", nif: "abc", prefixoReferencia: "" });
    const saida = erros(r);

    expect(Object.keys(saida).length).toBeGreaterThan(0);
    for (const v of Object.values(saida)) expect(typeof v).toBe("string");
  });

  it("num sucesso não há erros nenhuns", () => {
    const r = sociedadeSchema.safeParse({
      nome: "Sociedade",
      nif: "500000000",
      prefixoReferencia: "SOC",
    });
    expect(erros(r)).toEqual({});
  });
});
