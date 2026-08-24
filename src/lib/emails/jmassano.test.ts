import { describe, expect, it } from "vitest";
import {
  ASSUNTO_BOAS_VINDAS,
  ASSUNTO_CONFIRMACAO,
  ASSUNTO_REGISTO,
  ASSUNTO_REJEICAO,
  emailBoasVindas,
  emailConfirmacaoRececao,
  emailRegisto,
  emailRejeicao,
} from "./jmassano";

const LINK = "https://poc.terlicalabs.com/onboarding/abc123";

/** O HTML sem etiquetas, para comparar frases sem depender da moldura. */
const texto = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Os assuntos são os dos documentos do cliente, à letra — incluindo
 * "Registro", que é como lá está e não se corrigiu para "Registo" (D33).
 */
describe("assuntos", () => {
  it("são os quatro dos documentos do cliente", () => {
    expect(ASSUNTO_REGISTO).toBe("JMASSANO | Registro");
    expect(ASSUNTO_CONFIRMACAO).toBe("JMASSANO | Confirmação de Receção dos seus Dados");
    expect(ASSUNTO_BOAS_VINDAS).toBe("Bem-vindo à JMASSANO Escritório de Advogado");
    expect(ASSUNTO_REJEICAO).toBe("JMASSANO | Feedback Registro");
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
   * O anfitrião do link deixou de sair dos cabeçalhos do pedido — o
   * `origemPublica` passou a aceitar só o que está em `BETTER_AUTH_URL`, e um
   * `Host` de fora da lista já não monta link nenhum. O escape fica: é a
   * segunda fechadura, e uma etiqueta que se fecha a meio por causa de aspas no
   * endereço continua a ser um defeito, venha o endereço de onde vier.
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

  it("diz que os dados foram recebidos e o processo aguarda aprovação", () => {
    const t = texto(html);
    expect(t).toContain(
      "Agradecemos o registo e o envio das informações através da nossa plataforma.",
    );
    expect(t).toContain("o processo encontra-se agora a aguardar aprovação pela equipa");
  });

  it("promete um novo email com a decisão, e os documentos se aprovado", () => {
    const t = texto(html);
    expect(t).toContain("Assim que houver uma decisão, receberá um novo email a confirmá-la");
    expect(t).toContain(
      "em caso de aprovação, com o resumo do processo, os Termos e Condições e a proposta de honorários em anexo",
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
 * O quarto email — template do cliente entregue em 11/08/2026, à letra. Não
 * leva referência nem motivo: os dois continuam obrigatórios na UI e
 * gravados no processo e na auditoria, só deixaram de ir no corpo do email.
 */
describe("4. JMASSANO | Feedback Registro", () => {
  const html = emailRejeicao();

  it("tem o assunto certo", () => {
    expect(ASSUNTO_REJEICAO).toBe("JMASSANO | Feedback Registro");
  });

  it("segue o texto do template à letra", () => {
    const t = texto(html);
    expect(t).toContain(
      "Agradecemos a confiança depositada na JMASSANO Escritório de Advogado e o interesse demonstrado nos nossos serviços.",
    );
    expect(t).toContain(
      "lamentamos informar que o seu processo de validação não foi aceite nesta fase",
    );
    expect(t).toContain(
      "poderá entrar em contacto connosco para obter esclarecimentos adicionais",
    );
  });

  it("não menciona referência nem motivo — o template do cliente não os prevê", () => {
    const t = texto(html);
    expect(t).not.toContain("referência");
    expect(t).not.toContain("Motivo");
  });

  it("fecha com o mesmo rodapé e a mesma despedida dos outros três", () => {
    const t = texto(html);
    expect(t).toContain("JMASSANO — Escritório de Advogado");
    expect(t).toContain(
      "Com os melhores cumprimentos, Assinatura do Advogado gestor do Cliente",
    );
  });
});

/**
 * O corpo continua a ser o texto do cliente à letra (D33) — o que mudou foi a
 * identificação à volta dele. O nome entra na saudação e a referência entra em
 * cima, porque são identificação e não redação: um email que trata por
 * "Caro(a) Sr.(a)," alguém cujo nome está no dossiê lê-se como circular, e sem
 * referência ninguém sabe de que processo se fala ao telefone.
 *
 * O que **não** entra continua a não entrar: o motivo da rejeição, que fica no
 * processo e na auditoria.
 */
describe("identificação do destinatário e do processo", () => {
  const todos = [
    emailRegisto({ nome: "Maria Silva", link: LINK }),
    emailConfirmacaoRececao({ nome: "Maria Silva", referencia: "PMF-2026-0042" }),
    emailBoasVindas({ nome: "Maria Silva", referencia: "PMF-2026-0042", anexos: ["Resumo"] }),
    emailRejeicao({ nome: "Maria Silva", referencia: "PMF-2026-0042" }),
  ];

  it("a saudação trata o cliente pelo nome quando ele é conhecido", () => {
    for (const html of todos) expect(texto(html)).toContain("Caro(a) Sr.(a) Maria Silva,");
  });

  it("sem nome, volta à fórmula neutra do documento do cliente", () => {
    const semNome = [
      emailRegisto({ link: LINK }),
      emailConfirmacaoRececao(),
      emailBoasVindas({ anexos: ["Resumo"] }),
      emailRejeicao(),
    ];
    for (const html of semNome) {
      expect(texto(html)).toContain("Caro(a) Sr.(a),");
      // Sem o nome não pode sobrar a vírgula solta de "Caro(a) Sr.(a) ,".
      expect(texto(html)).not.toContain("Sr.(a) ,");
    }
  });

  it("um nome longo é reduzido ao primeiro e ao último", () => {
    const html = emailRegisto({ nome: "Maria Antónia da Silva Ferreira", link: LINK });
    expect(texto(html)).toContain("Caro(a) Sr.(a) Maria Ferreira,");
  });

  it("a assinatura fica em aberto para o advogado gestor", () => {
    for (const html of todos) {
      expect(texto(html)).toContain(
        "Com os melhores cumprimentos, Assinatura do Advogado gestor do Cliente",
      );
    }
  });

  it("a referência do processo vai em todos os que a recebem", () => {
    // O de registo é a exceção e continua a ser: nasce antes de haver
    // identificação preenchida, e é o link que o identifica.
    for (const html of todos.slice(1)) expect(html).toContain("PMF-2026-0042");
  });

  it("o motivo da rejeição continua a não sair no email", () => {
    const html = emailRejeicao({
      nome: "Maria Silva",
      referencia: "PMF-2026-0042",
    });
    expect(html).not.toContain("motivo");
  });

  it("os três fecham com o rodapé de confidencialidade", () => {
    for (const html of todos) {
      expect(texto(html)).toContain("JMASSANO — Escritório de Advogado");
      expect(texto(html)).toContain("confidenciais e destinam-se exclusivamente ao destinatário");
    }
  });
});
