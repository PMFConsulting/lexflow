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
  emailReabertura,
  ASSUNTO_REABERTURA,
} from "./jmassano";

const LINK = "https://poc.terlicalabs.com/onboarding/abc123";

/** The HTML without tags, so sentences can be compared without depending on the frame. */
const texto = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The subjects are those of the client's documents, verbatim — including
 * "Registro", which is how it reads there and was not corrected to "Registo"
 * (D33).
 */
describe("assuntos", () => {
  it("são os quatro dos documentos do cliente", () => {
    expect(ASSUNTO_REGISTO).toBe("LexFlow | Registro");
    expect(ASSUNTO_CONFIRMACAO).toBe("LexFlow | Confirmação de Receção dos seus Dados");
    expect(ASSUNTO_BOAS_VINDAS).toBe("Bem-vindo à LexFlow");
    expect(ASSUNTO_REJEICAO).toBe("LexFlow | Feedback Registro");
  });
});

describe("1. LexFlow | Registro", () => {
  const html = emailRegisto({ nome: "Maria Silva", link: LINK });

  it("leva o link no botão e em texto, para quando o botão não funciona", () => {
    expect(html).toContain(`href="${LINK}"`);
    // Twice: once in the button's href, once in the copyable address.
    expect(html.split(LINK)).toHaveLength(3);
    expect(texto(html)).toContain("Se o botão não funcionar");
  });

  it("abre com a frase do cliente sobre o acolhimento", () => {
    expect(texto(html)).toContain(
      "É com grande satisfação que o recebemos como cliente da LexFlow.",
    );
  });

  it("explica para que serve o registo e invoca o RGPD", () => {
    const t = texto(html);
    expect(t).toContain("solicitamos que efetue o seu registo através da nossa plataforma online");
    expect(t).toContain("Regulamento Geral sobre a Proteção de Dados (RGPD)");
  });

  /**
   * The link's host no longer comes from the request headers — `origemPublica`
   * now accepts only what is in `BETTER_AUTH_URL`, and a `Host` outside the
   * list builds no link at all. The escaping stays: it is the second lock, and
   * a tag that closes halfway because of quotes in the address is still a
   * defect, wherever the address comes from.
   */
  it("escapa um link hostil em vez de o deixar fechar a etiqueta", () => {
    const hostil = 'https://mau.pt/" onmouseover="alert(1)';
    const saida = emailRegisto({ link: hostil });

    expect(saida).not.toContain('onmouseover="alert(1)"');
    expect(saida).toContain("&quot;");
  });
});

/**
 * BUG-021: a reabertura regenera o token de acesso do processo — o anterior
 * deixa de valer. Um email de reabertura sem o link NOVO deixa o cliente a
 * saber que o processo reabriu sem lhe dizer como voltar, o que anula o
 * objectivo do FIX-004. O padrão é o do registo: botão + endereço copiável.
 */
describe("6. LexFlow | Reabertura do Processo", () => {
  it("tem o assunto certo", () => {
    expect(ASSUNTO_REABERTURA).toBe("LexFlow | Reabertura do Processo");
  });

  it("leva o link (novo) no botão e em texto copiável", () => {
    const html = emailReabertura({ nome: "Maria Silva", referencia: "PMF-2026-0042", link: LINK });
    expect(html).toContain(`href="${LINK}"`);
    // Botão + endereço copiável, como no registo.
    expect(html.split(LINK)).toHaveLength(3);
    expect(texto(html)).toContain("Se o botão não funcionar");
    expect(texto(html)).toContain("Aceder ao processo");
  });

  it("renderiza exactamente o link que recebe — nunca um antigo", () => {
    // Guarda de regressão: o token vem regenerado da action; o template não
    // transforma e não guarda estado entre chamadas.
    const novo = "https://poc.terlicalabs.com/onboarding/token-novo-456";
    const html = emailReabertura({ link: novo });
    expect(html).toContain(novo);
    expect(html).not.toContain("token-antigo");
  });

  it("mantém o texto do cliente e funciona sem link (retrocompatível)", () => {
    const t = texto(emailReabertura({ nome: "Maria Silva" }));
    expect(t).toContain("foi reaberto para retificação de informações");
    expect(t).not.toContain("Aceder ao processo");
    expect(t).toContain("Com os melhores cumprimentos");
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

describe("3. Bem-vindo à LexFlow", () => {
  const ANEXOS = [
    "Resumo das informações fornecidas durante o processo de registo",
    "Termos e Condições de Prestação de Serviços (T&C)",
    "Proposta de Honorários",
  ];
  const html = emailBoasVindas({ nome: "Maria Silva", referencia: "PMF-2026-0042", anexos: ANEXOS });

  it("anuncia a conclusão do registo", () => {
    expect(texto(html)).toContain(
      "o processo de registo junto da LexFlow foi concluído com sucesso",
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
   * An attachment that fails to generate cannot go on being announced: it is
   * worth more to arrive with two attachments and an honest list than to
   * promise three.
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
 * The fourth email — the client's template delivered on 11/08/2026, verbatim.
 * It carries neither reference nor reason: both are still mandatory in the UI
 * and recorded in the matter and in the audit trail, they just stopped going in
 * the body of the email.
 */
describe("4. LexFlow | Feedback Registro", () => {
  const html = emailRejeicao();

  it("tem o assunto certo", () => {
    expect(ASSUNTO_REJEICAO).toBe("LexFlow | Feedback Registro");
  });

  it("segue o texto do template à letra", () => {
    const t = texto(html);
    expect(t).toContain(
      "Agradecemos a confiança depositada na LexFlow e o interesse demonstrado nos nossos serviços.",
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
    expect(t).toContain("LexFlow — Software de gestão para sociedades de advogados");
    expect(t).toContain(
      "Com os melhores cumprimentos, Assinatura do Advogado gestor do Cliente",
    );
  });
});

/**
 * The body is still the client's text verbatim (D33) — what changed is the
 * identification around it. The name goes into the greeting and the reference
 * goes at the top, because they are identification and not wording: an email
 * addressing someone whose name is in the case file as "Caro(a) Sr.(a)," reads
 * as a circular, and without a reference nobody knows which matter is being
 * discussed on the phone.
 *
 * What does **not** go in still does not go in: the rejection reason, which
 * stays in the matter and in the audit trail.
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
      // Without the name, the hanging comma of "Caro(a) Sr.(a) ," must not remain.
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
    // The registration one is the exception and stays that way: it is born
    // before any identification is filled in, and it is the link that
    // identifies it.
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
      expect(texto(html)).toContain("LexFlow — Software de gestão para sociedades de advogados");
      expect(texto(html)).toContain("confidenciais e destinam-se exclusivamente ao destinatário");
    }
  });
});
