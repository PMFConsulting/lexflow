import { describe, expect, it } from "vitest";
import { SCHEMAS_SOCIEDADE } from "./schemas";

/** Os erros por campo, na forma em que a Server Action os monta. */
function campos(schema: (typeof SCHEMAS_SOCIEDADE)[keyof typeof SCHEMAS_SOCIEDADE], dados: unknown) {
  const r = schema.safeParse(dados);
  if (r.success) return null;
  const erros: Record<string, string[]> = {};
  for (const p of r.error.issues) {
    (erros[p.path.join(".") || "_"] ??= []).push(p.message);
  }
  return erros;
}

const PASSO_1 = {
  nome: "JMASSANO — Escritório de Advogado",
  nipc: "509442013",
  naturezaJuridica: "Sociedade de Advogados, SP, RL",
  numeroOrdem: "1234",
  prefixoReferencia: "jm",
};

const PASSO_2 = {
  morada: "Rua das Flores 12",
  pais: "pt",
  localidade: "Lisboa",
  codigoPostal: "1200-192",
  freguesia: "Misericórdia",
  concelho: "Lisboa",
  distrito: "Lisboa",
  emailGeral: "geral@jmassano.pt",
  telefone: "+351 912 345 678",
};

describe("passo 1 — identificação da sociedade", () => {
  it("aceita uma sociedade bem preenchida e normaliza o prefixo", () => {
    const r = SCHEMAS_SOCIEDADE[1].safeParse(PASSO_1);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.prefixoReferencia).toBe("JM");
  });

  it("recusa um NIF de pessoa singular no campo do NIPC", () => {
    // 249886340 é um NIF válido de pessoa singular: passa o mod-11 e começa
    // por 2. É exatamente o caso que a distinção existe para apanhar (D54) —
    // um número que bate certo no checksum e identifica a pessoa errada.
    const erros = campos(SCHEMAS_SOCIEDADE[1], { ...PASSO_1, nipc: "249886340" });
    expect(erros?.nipc?.[0]).toMatch(/5, 6, 8 ou 9/);
  });

  it("o prefixo é verificado antes do checksum", () => {
    // Dizer "o último dígito teria de ser X" sobre um número que nem sequer é
    // de pessoa coletiva manda o utilizador corrigir a coisa errada (D54).
    const erros = campos(SCHEMAS_SOCIEDADE[1], { ...PASSO_1, nipc: "249886344" });
    expect(erros?.nipc?.[0]).toMatch(/5, 6, 8 ou 9/);
    expect(erros?.nipc?.[0]).not.toMatch(/último dígito/);
  });

  it("recusa um prefixo com espaços ou sinais", () => {
    // O prefixo entra em nomes de pasta no servidor da sociedade e em assuntos
    // de email; um espaço lá dentro é um caminho partido ao meio, que é a mesma
    // classe de defeito que o SFTP já mostrou.
    expect(campos(SCHEMAS_SOCIEDADE[1], { ...PASSO_1, prefixoReferencia: "J M" })?.prefixoReferencia)
      .toBeDefined();
    expect(campos(SCHEMAS_SOCIEDADE[1], { ...PASSO_1, prefixoReferencia: "J/M" })?.prefixoReferencia)
      .toBeDefined();
    expect(campos(SCHEMAS_SOCIEDADE[1], { ...PASSO_1, prefixoReferencia: "J" })?.prefixoReferencia)
      .toBeDefined();
  });
});

describe("passo 2 — morada e contactos", () => {
  it("aceita e normaliza país e telefone", () => {
    const r = SCHEMAS_SOCIEDADE[2].safeParse(PASSO_2);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.pais).toBe("PT");
    expect(r.data.telefone).toBe("912345678");
  });

  it("um website vazio não é um website inválido", () => {
    // O `""` que um campo por preencher envia não é um URL, e recusá-lo com
    // «URL inválido» é a forma mais irritante de «falta corrigir um campo»:
    // fala de uma caixa que ninguém abriu.
    const r = SCHEMAS_SOCIEDADE[2].safeParse({ ...PASSO_2, website: "" });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.website).toBeUndefined();
  });

  it("um website escrito pela metade é recusado", () => {
    expect(campos(SCHEMAS_SOCIEDADE[2], { ...PASSO_2, website: "jmassano" })?.website)
      .toBeDefined();
  });

  it("um telefone com dez dígitos não passa", () => {
    // Um dígito a mais parece um número correto e só se descobre quando alguém
    // tenta ligar, semanas depois (D55).
    expect(campos(SCHEMAS_SOCIEDADE[2], { ...PASSO_2, telefone: "9123456789" })?.telefone)
      .toBeDefined();
  });
});

describe("passo 3 — documentos", () => {
  it("não fecha sem a certidão permanente", () => {
    const erros = campos(SCHEMAS_SOCIEDADE[3], { documentos: ["outro"] });
    expect(erros?.documentos?.[0]).toMatch(/certidão permanente/i);
  });

  it("fecha com a certidão anexada", () => {
    expect(SCHEMAS_SOCIEDADE[3].safeParse({ documentos: ["certidao_sociedade"] }).success).toBe(
      true,
    );
  });
});

describe("passo 4 — Termos e Condições", () => {
  it("não fecha sem o PDF do articulado", () => {
    const erros = campos(SCHEMAS_SOCIEDADE[4], { termosVersao: "2026.08.1", documentos: [] });
    expect(erros?.documentos?.[0]).toMatch(/Termos e Condições/);
  });

  it("não fecha sem versão", () => {
    // A versão é o que fica gravado junto de cada aceitação (D3/D38). Sem ela,
    // uma aceitação diz que alguém aceitou e não diz o quê.
    const erros = campos(SCHEMAS_SOCIEDADE[4], {
      termosVersao: "",
      documentos: ["termos_sociedade"],
    });
    expect(erros?.termosVersao).toBeDefined();
  });

  it("recusa uma versão com espaços", () => {
    const erros = campos(SCHEMAS_SOCIEDADE[4], {
      termosVersao: "versão de agosto",
      documentos: ["termos_sociedade"],
    });
    expect(erros?.termosVersao).toBeDefined();
  });
});

describe("passo 6 — declaração", () => {
  it("uma caixa por marcar não passa por um booleano", () => {
    // `z.literal(true)` e não `z.boolean()`: com um booleano, a declaração
    // ficava gravada a dizer "não" e o registo seguia na mesma.
    const erros = campos(SCHEMAS_SOCIEDADE[6], {
      declaracaoNome: "Ana",
      declaracaoCargo: "Sócia",
      declaracaoVinculo: false,
      consentimentoPrivacidade: false,
    });
    expect(erros?.declaracaoVinculo).toBeDefined();
  });

  it("não aceita o registo sem o consentimento de privacidade", () => {
    // O consentimento é obrigatório antes da submissão — e não chega um
    // `true` na declaração de vínculo para o dispensar.
    const erros = campos(SCHEMAS_SOCIEDADE[6], {
      declaracaoNome: "Ana",
      declaracaoCargo: "Sócia",
      declaracaoVinculo: true,
      consentimentoPrivacidade: false,
    });
    expect(erros?.consentimentoPrivacidade?.[0]).toMatch(/Política de Privacidade/);
  });

  it("aceita a declaração completa, com consentimento", () => {
    expect(
      SCHEMAS_SOCIEDADE[6].safeParse({
        declaracaoNome: "Ana",
        declaracaoCargo: "Sócia",
        declaracaoVinculo: true,
        consentimentoPrivacidade: true,
      }).success,
    ).toBe(true);
  });
});
