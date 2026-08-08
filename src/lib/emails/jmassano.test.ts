import { describe, expect, it } from "vitest";
import {
  ASSUNTO_BOAS_VINDAS,
  ASSUNTO_CONFIRMACAO,
  ASSUNTO_REGISTO,
  emailBoasVindas,
  emailConfirmacaoRececao,
  emailRegisto,
} from "./jmassano";

const LINK = "https://poc.terlicalabs.com/onboarding/abc123";

/** O HTML sem etiquetas, para comparar frases sem depender da moldura. */
const texto = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Os assuntos são os do documento de análise do cliente, à letra — incluindo
 * "Registro", que é como lá está e não se corrigiu para "Registo" (D33).
 */
describe("assuntos", () => {
  it("são os três do documento do cliente", () => {
    expect(ASSUNTO_REGISTO).toBe("JMASSANO | Registro");
    expect(ASSUNTO_CONFIRMACAO).toBe("JMASSANO | Confirmação de Receção dos seus Dados");
    expect(ASSUNTO_BOAS_VINDAS).toBe("Bem-vindo à JMASSANO Escritório de Advogado");
  });
});

describe("1. JMASSANO | Registro", () => {
  const html = emailRegisto({ nome: "Maria Silva", link: LINK });

  it("leva o link no botão e em texto, para quando o botão não funciona", () => {
    expect(html).toContain(`href="${LINK}"`);
    // Duas vezes: uma no href do botão, outra no endereço copiável.
    expect(html.split(LINK)).toHaveLength(3);
    expect(texto(html)).toContain("Se o botão não funcionar");
  });

  it("abre com a frase do cliente sobre o acolhimento", () => {
    expect(texto(html)).toContain(
      "É com grande satisfação que o recebemos como cliente da João Massano Escritório de Advogado.",
    );
  });

  it("explica para que serve o registo e invoca o RGPD", () => {
    const t = texto(html);
    expect(t).toContain("solicitamos que efetue o seu registo através da nossa plataforma online");
    expect(t).toContain("Regulamento Geral sobre a Proteção de Dados (RGPD)");
  });

  /**
   * O anfitrião do link sai dos cabeçalhos do pedido (`origemPublica`), que
   * quem chama a página controla. Um `Host` com aspas fechava o `href` e o
   * resto da etiqueta passava a ser atributo.
   */
  it("escapa um link hostil em vez de o deixar fechar a etiqueta", () => {
    const hostil = 'https://mau.pt/" onmouseover="alert(1)';
    const saida = emailRegisto({ link: hostil });

    expect(saida).not.toContain('onmouseover="alert(1)"');
    expect(saida).toContain("&quot;");
  });
});

describe("2. Confirmação de Receção dos seus Dados", () => {
  const html = emailConfirmacaoRececao();

  it("diz que os dados foram recebidos e estão em análise", () => {
    const t = texto(html);
    expect(t).toContain(
      "Agradecemos o registo e o envio das informações através da nossa plataforma.",
    );
    expect(t).toContain("foram recebidos com sucesso e encontram-se atualmente em análise");
  });

  it("promete voltar ao contacto com os próximos passos", () => {
    expect(texto(html)).toContain(
      "Assim que a análise estiver concluída, voltaremos ao seu contacto com os próximos passos.",
    );
  });
});

describe("3. Bem-vindo à JMASSANO Escritório de Advogado", () => {
  const ANEXOS = [
    "Resumo das informações fornecidas durante o processo de registo",
    "Termos e Condições de Prestação de Serviços (T&C)",
    "Proposta de Honorários",
  ];
  const html = emailBoasVindas({ nome: "Maria Silva", referencia: "PMF-2026-0042", anexos: ANEXOS });

  it("anuncia a conclusão do registo", () => {
    expect(texto(html)).toContain(
      "o processo de registo junto da JMASSANO Escritório de Advogado foi concluído com sucesso",
    );
  });

  it("lista os anexos que foram mesmo gerados, e deixa o campo aberto no fim", () => {
    const t = texto(html);
    for (const anexo of ANEXOS) expect(t).toContain(anexo);
    expect(t).toContain("[Outros documentos aplicáveis]");
    expect(html.indexOf("[Outros documentos aplicáveis]")).toBeGreaterThan(
      html.indexOf("Proposta de Honorários"),
    );
  });

  /**
   * Um anexo que falhe a gerar-se não pode continuar anunciado: vale mais
   * chegar com dois anexos e uma lista honesta do que prometer três.
   */
  it("não anuncia um anexo que não foi gerado", () => {
    const t = texto(emailBoasVindas({ anexos: [ANEXOS[0]] }));
    expect(t).toContain(ANEXOS[0]);
    expect(t).not.toContain("Proposta de Honorários");
    expect(t).toContain("[Outros documentos aplicáveis]");
  });

  it("pontua a lista: ponto e vírgula entre linhas, ponto final na última", () => {
    expect(html).toContain("Proposta de Honorários;");
    expect(html).toContain("[Outros documentos aplicáveis].");
  });
});

/**
 * Consequências de seguir o texto do cliente à letra (D33). Os parâmetros
 * `nome` e `referencia` continuam a ser aceites — e ignorados — para o dia em
 * que a sociedade queira uma dessas coisas de volta sem mexer em quem chama.
 */
describe("o que o texto literal do cliente implica", () => {
  const todos = [
    emailRegisto({ nome: "Maria Silva", link: LINK }),
    emailConfirmacaoRececao(),
    emailBoasVindas({ nome: "Maria Silva", referencia: "PMF-2026-0042", anexos: ["Resumo"] }),
  ];

  it("a saudação é genérica nos três — o documento diz “Caro(a) Sr.(a),”", () => {
    for (const html of todos) {
      expect(texto(html)).toContain("Caro(a) Sr.(a),");
      expect(html).not.toContain("Maria Silva");
    }
  });

  it("a assinatura fica em aberto para o advogado gestor", () => {
    for (const html of todos) {
      expect(texto(html)).toContain(
        "Com os melhores cumprimentos, Assinatura do Advogado gestor do Cliente",
      );
    }
  });

  it("a referência do processo não aparece no corpo de nenhum deles", () => {
    for (const html of todos) expect(html).not.toContain("PMF-2026-0042");
  });

  it("os três fecham com o rodapé de confidencialidade", () => {
    for (const html of todos) {
      expect(texto(html)).toContain("JMASSANO — Escritório de Advogado");
      expect(texto(html)).toContain("confidenciais e destinam-se exclusivamente ao destinatário");
    }
  });
});
