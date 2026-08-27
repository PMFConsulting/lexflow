import { describe, expect, it, vi } from "vitest";
import {
  aplicarPlaceholders,
  escaparHtml,
  PLACEHOLDERS_DISPONIVEIS,
  TEMPLATES_EDITAVEIS,
  TEMPLATES_NAO_EDITAVEIS,
} from "./personalizacao";
import { resolverEmailCliente } from "./obter-modelo";
import { ASSUNTO_BOAS_VINDAS, ASSUNTO_CONFIRMACAO, ASSUNTO_REJEICAO } from "./jmassano";

describe("TEMPLATES_EDITAVEIS e TEMPLATES_NAO_EDITAVEIS", () => {
  it("contém exatamente os 4 templates client-facing como editáveis", () => {
    expect(TEMPLATES_EDITAVEIS).toEqual([
      "confirmacao_rececao",
      "boas_vindas",
      "rejeicao",
      "reabertura",
    ]);
  });

  it("garante que templates de segurança e sistema são não editáveis", () => {
    expect(TEMPLATES_NAO_EDITAVEIS).toContain("otp");
    expect(TEMPLATES_NAO_EDITAVEIS).toContain("credenciais_acesso");
    expect(TEMPLATES_NAO_EDITAVEIS).toContain("convite_sociedade");
    expect(TEMPLATES_NAO_EDITAVEIS).toContain("convite_utilizador");
    expect(TEMPLATES_NAO_EDITAVEIS).toContain("registo");
    expect(TEMPLATES_NAO_EDITAVEIS).toContain("notificacao_backoffice");
  });

  it("não existe sobreposição entre editáveis e não editáveis", () => {
    for (const t of TEMPLATES_EDITAVEIS) {
      expect((TEMPLATES_NAO_EDITAVEIS as readonly string[]).includes(t)).toBe(false);
    }
  });

  it("exporta os placeholders suportados documentados", () => {
    const chaves = PLACEHOLDERS_DISPONIVEIS.map((p) => p.chave);
    expect(chaves).toContain("nome_cliente");
    expect(chaves).toContain("referencia");
    expect(chaves).toContain("nome_sociedade");
    expect(chaves).toContain("link_processo");
    expect(chaves).toContain("motivo");
  });
});

describe("aplicarPlaceholders", () => {
  it("substitui placeholders conhecidos pelos valores correspondentes", () => {
    const modelo = "Caro(a) {{nome_cliente}}, o seu processo {{referencia}} na {{nome_sociedade}} foi recebido.";
    const resultado = aplicarPlaceholders(modelo, {
      nome_cliente: "Maria Silva",
      referencia: "PMF-2026-0001",
      nome_sociedade: "PMF Advogados",
    });

    expect(resultado).toBe(
      "Caro(a) Maria Silva, o seu processo PMF-2026-0001 na PMF Advogados foi recebido.",
    );
  });

  it("tolera espaços em branco dentro das chavetas", () => {
    const modelo = "Processo: {{ referencia }} | Cliente: {{  nome_cliente  }}";
    const resultado = aplicarPlaceholders(modelo, {
      nome_cliente: "João Pedro",
      referencia: "REF-123",
    });

    expect(resultado).toBe("Processo: REF-123 | Cliente: João Pedro");
  });

  it("mantém literais os placeholders desconhecidos ou não fornecidos (nunca rebenta)", () => {
    const modelo = "Olá {{nome_cliente}}, o seu código é {{codigo_secreto}} e ref {{referencia}}.";
    const resultado = aplicarPlaceholders(modelo, {
      nome_cliente: "Ana",
    });

    expect(resultado).toBe("Olá Ana, o seu código é {{codigo_secreto}} e ref {{referencia}}.");
  });

  it("substitui valores null por string vazia", () => {
    const modelo = "Motivo: {{motivo}}.";
    const resultado = aplicarPlaceholders(modelo, {
      motivo: null,
    });

    expect(resultado).toBe("Motivo: .");
  });

  it("escapa caracteres especiais HTML nas variáveis para prevenção contra XSS", () => {
    const modelo = "<p>Caro(a) {{nome_cliente}}, nota: {{motivo}}</p>";
    const resultado = aplicarPlaceholders(modelo, {
      nome_cliente: '<script>alert("XSS")</script>',
      motivo: "Empresa & Associados <teste>",
    });

    expect(resultado).not.toContain("<script>");
    expect(resultado).toContain("&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;");
    expect(resultado).toContain("Empresa &amp; Associados &lt;teste&gt;");
  });

  it("lida com texto vazio ou nulo com segurança", () => {
    expect(aplicarPlaceholders("", { a: "b" })).toBe("");
    expect(aplicarPlaceholders(null, { a: "b" })).toBe("");
    expect(aplicarPlaceholders(undefined, { a: "b" })).toBe("");
  });
});

describe("escaparHtml", () => {
  it("escapa &, <, >, \", e '", () => {
    expect(escaparHtml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;");
  });
});

describe("resolverEmailCliente (fallback vs personalizado)", () => {
  it("devolve o template padrão quando não existe modelo personalizado na sociedade", async () => {
    const res = await resolverEmailCliente({
      organizacaoId: "org-sem-modelo",
      template: "confirmacao_rececao",
      variaveis: {
        nome_cliente: "Carlos Sousa",
        referencia: "PMF-2026-0099",
      },
    });

    expect(res.personalizado).toBe(false);
    expect(res.assunto).toBe(ASSUNTO_CONFIRMACAO);
    expect(res.html).toContain("PMF-2026-0099");
    expect(res.html).toContain("Carlos Sousa");
    expect(res.html).toContain("LexFlow · Software de gestão para sociedades de advogados");
  });

  it("devolve o template de boas-vindas padrão com anexos", async () => {
    const res = await resolverEmailCliente({
      organizacaoId: "org-sem-modelo",
      template: "boas_vindas",
      variaveis: {
        nome_cliente: "Rita Santos",
        referencia: "PMF-2026-0100",
      },
      anexosLista: ["Resumo do Processo", "T&C"],
    });

    expect(res.personalizado).toBe(false);
    expect(res.assunto).toBe(ASSUNTO_BOAS_VINDAS);
    expect(res.html).toContain("Rita Santos");
    expect(res.html).toContain("Resumo do Processo;");
  });

  it("devolve o template de rejeição padrão", async () => {
    const res = await resolverEmailCliente({
      organizacaoId: "org-sem-modelo",
      template: "rejeicao",
      variaveis: {
        nome_cliente: "Inês Ramos",
        referencia: "PMF-2026-0101",
        motivo: "Critérios de compliance",
      },
    });

    expect(res.personalizado).toBe(false);
    expect(res.assunto).toBe(ASSUNTO_REJEICAO);
    expect(res.html).toContain("Inês Ramos");
  });
});
