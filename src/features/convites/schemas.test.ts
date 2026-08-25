import { describe, expect, it } from "vitest";
import { SCHEMAS_CONVITE } from "./schemas";
import { exerceAdvocacia } from "./passos";

function campos(schema: { safeParse: (d: unknown) => { success: boolean; error?: { issues: { path: (string | number | symbol)[]; message: string }[] } } }, dados: unknown) {
  const r = schema.safeParse(dados);
  if (r.success) return null;
  const erros: Record<string, string[]> = {};
  for (const p of r.error!.issues) {
    (erros[p.path.join(".") || "_"] ??= []).push(p.message);
  }
  return erros;
}

const PASSO_1 = {
  nomeCompleto: "Ana Ribeiro",
  dataNascimento: "1988-04-12",
  nif: "249886340",
  telefone: "912 345 678",
  docTipo: "cartao_cidadao",
  docNumero: "12345678 9 ZZ1",
  docValidade: "2099-01-01",
  morada: "Rua das Flores 12",
  pais: "pt",
  localidade: "Lisboa",
  codigoPostal: "1200-192",
  freguesia: "Misericórdia",
  concelho: "Lisboa",
  distrito: "Lisboa",
};

describe("quem exerce advocacia", () => {
  it("advogados e sócios sim, administradores e assistentes não", () => {
    // Um assistente não tem cédula profissional, e exigir-lha tornava o passo 2
    // impossível de fechar para um perfil que legitimamente não a tem.
    expect(exerceAdvocacia("advogado")).toBe(true);
    expect(exerceAdvocacia("socio")).toBe(true);
    expect(exerceAdvocacia("assistente")).toBe(false);
    expect(exerceAdvocacia("admin")).toBe(false);
  });
});

describe("passo 1 — dados pessoais", () => {
  it("aceita e normaliza", () => {
    const r = SCHEMAS_CONVITE[1].safeParse(PASSO_1);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.telefone).toBe("912345678");
    expect(r.data.pais).toBe("PT");
  });

  it("recusa uma data de nascimento no futuro", () => {
    expect(campos(SCHEMAS_CONVITE[1], { ...PASSO_1, dataNascimento: "2099-01-01" })
      ?.dataNascimento).toBeDefined();
  });

  it("recusa um documento fora de validade", () => {
    const erros = campos(SCHEMAS_CONVITE[1], { ...PASSO_1, docValidade: "2000-01-01" });
    expect(erros?.docValidade?.[0]).toMatch(/fora de validade/i);
  });

  it("um disparate na data de validade não sai como «fora de validade»", () => {
    // `new Date("abc") > new Date()` é `false`, e sem o primeiro `refine` um
    // disparate escrito no campo mandava renovar um documento que não tinha
    // problema nenhum.
    const erros = campos(SCHEMAS_CONVITE[1], { ...PASSO_1, docValidade: "abc" });
    expect(erros?.docValidade?.[0]).toBe("Data inválida.");
  });

  it("recusa um NIF com checksum errado", () => {
    // Um dígito trocado no fim é exatamente o que o mod-11 existe para apanhar.
    expect(campos(SCHEMAS_CONVITE[1], { ...PASSO_1, nif: "249886344" })?.nif).toBeDefined();
  });
});

describe("passo 2 — dados profissionais", () => {
  it("um assistente fecha o passo sem cédula", () => {
    const r = SCHEMAS_CONVITE[2].safeParse({ exerce: false, cargo: "Assistente jurídico" });
    expect(r.success).toBe(true);
  });

  it("um advogado não fecha o passo sem cédula nem conselho", () => {
    const erros = campos(SCHEMAS_CONVITE[2], { exerce: true, cargo: "Advogado associado" });
    expect(erros?.cedulaProfissional).toBeDefined();
    expect(erros?.conselhoRegional).toBeDefined();
  });

  it("um advogado com cédula e conselho fecha", () => {
    expect(
      SCHEMAS_CONVITE[2].safeParse({
        exerce: true,
        cargo: "Advogado associado",
        cedulaProfissional: "12345L",
        conselhoRegional: "Lisboa",
      }).success,
    ).toBe(true);
  });

  it("recusa uma inscrição na Ordem no futuro", () => {
    const erros = campos(SCHEMAS_CONVITE[2], {
      exerce: true,
      cargo: "Advogado",
      cedulaProfissional: "12345L",
      conselhoRegional: "Lisboa",
      dataInscricaoOa: "2099-01-01",
    });
    expect(erros?.dataInscricaoOa).toBeDefined();
  });
});

describe("passo 3 — documentos", () => {
  it("um assistente só precisa da identificação", () => {
    expect(
      SCHEMAS_CONVITE[3].safeParse({ exerce: false, documentos: ["identificacao"] }).success,
    ).toBe(true);
  });

  it("um advogado precisa também da cédula", () => {
    const erros = campos(SCHEMAS_CONVITE[3], { exerce: true, documentos: ["identificacao"] });
    expect(erros?.documentos?.[0]).toMatch(/cédula/i);
  });

  it("dois documentos em falta dão dois erros e não um", () => {
    // Duas coisas a fazer têm de se ler como duas coisas a fazer (D56).
    const erros = campos(SCHEMAS_CONVITE[3], { exerce: true, documentos: [] });
    expect(erros?.documentos).toHaveLength(2);
  });
});

describe("passo 4 — RGPD e sigilo", () => {
  it("as duas obrigatórias são obrigatórias", () => {
    const erros = campos(SCHEMAS_CONVITE[4], {
      informacaoRgpd: false,
      sigiloProfissional: false,
      comunicacoesInternas: false,
    });
    expect(erros?.informacaoRgpd).toBeDefined();
    expect(erros?.sigiloProfissional).toBeDefined();
  });

  it("o consentimento de comunicações internas pode ficar por marcar", () => {
    // É a única das três que é mesmo consentimento — e um consentimento que não
    // se pode recusar não é livre.
    const r = SCHEMAS_CONVITE[4].safeParse({
      informacaoRgpd: true,
      sigiloProfissional: true,
      comunicacoesInternas: false,
    });
    expect(r.success).toBe(true);
  });

  it("a mensagem do RGPD não diz que se está a consentir", () => {
    // A distinção entre informação e consentimento tem de sobreviver à
    // redação: um «autorizo» aqui produzia um consentimento inválido, e fazia
    // a pessoa acreditar que o podia retirar.
    const erros = campos(SCHEMAS_CONVITE[4], {
      informacaoRgpd: false,
      sigiloProfissional: true,
      comunicacoesInternas: false,
    });
    expect(erros?.informacaoRgpd?.[0]).toMatch(/não um consentimento/i);
  });
});

describe("passo 5 — Termos e Condições", () => {
  it("uma caixa por marcar não passa", () => {
    expect(campos(SCHEMAS_CONVITE[5], { aceitaTermos: false })?.aceitaTermos).toBeDefined();
  });
});

describe("passo 6 — palavra-passe", () => {
  it("recusa menos de 12 caracteres", () => {
    // O mesmo mínimo do `minPasswordLength` do Better Auth. Uma palavra-passe
    // aceite aqui e recusada no login deixava a pessoa com uma conta em que não
    // consegue entrar, e nada no ecrã que o explicasse.
    const erros = campos(SCHEMAS_CONVITE[6], { password: "curta", confirmacao: "curta" });
    expect(erros?.password).toBeDefined();
  });

  it("recusa duas palavras-passe diferentes, e aponta a confirmação", () => {
    const erros = campos(SCHEMAS_CONVITE[6], {
      password: "uma-palavra-passe-longa",
      confirmacao: "outra-palavra-passe-longa",
    });
    expect(erros?.confirmacao).toBeDefined();
    expect(erros?.password).toBeUndefined();
  });

  it("aceita duas iguais e suficientemente longas", () => {
    expect(
      SCHEMAS_CONVITE[6].safeParse({
        password: "uma-palavra-passe-longa",
        confirmacao: "uma-palavra-passe-longa",
      }).success,
    ).toBe(true);
  });
});
