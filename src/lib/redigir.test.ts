import { describe, expect, it } from "vitest";
import { mascararEmail, minimizarPii, redigirTextoLivre } from "./redigir";

describe("mascararEmail", () => {
  it("guarda a primeira letra e o domínio inteiro", () => {
    expect(mascararEmail("maria.silva@exemplo.pt")).toBe("m***@exemplo.pt");
    expect(mascararEmail("joao@jmassano.pt")).toBe("j***@jmassano.pt");
  });

  it("o domínio fica legível — é por ele que se responde a «foi para o sítio certo?»", () => {
    expect(mascararEmail("a@b.co.uk")).toBe("a***@b.co.uk");
  });

  it("aguenta um endereço com + e vários pontos", () => {
    expect(mascararEmail("cliente+kyc@sub.exemplo.pt")).toBe("c***@sub.exemplo.pt");
  });

  it("apara espaços antes de decidir", () => {
    expect(mascararEmail("  maria@exemplo.pt  ")).toBe("m***@exemplo.pt");
  });

  it("vazio e ausente dão a cadeia vazia, não «undefined»", () => {
    expect(mascararEmail("")).toBe("");
    expect(mascararEmail("   ")).toBe("");
    expect(mascararEmail(null)).toBe("");
    expect(mascararEmail(undefined)).toBe("");
  });

  it("o que não é endereço não passa em claro — quem chamou disse que era um email", () => {
    expect(mascararEmail("sem-arroba")).toBe("***");
    expect(mascararEmail("@exemplo.pt")).toBe("***");
    expect(mascararEmail("maria@")).toBe("***");
  });
});

describe("redigirTextoLivre", () => {
  it("mascara endereços colados no meio de uma mensagem de erro", () => {
    expect(redigirTextoLivre("403 domain not verified for maria@exemplo.pt")).toBe(
      "403 domain not verified for m***@exemplo.pt",
    );
  });

  it("apaga nove dígitos seguidos — NIF, NIPC e telefone têm todos esta forma", () => {
    expect(redigirTextoLivre("NIF 249886344 recusado")).toBe("NIF [nº redigido] recusado");
    expect(redigirTextoLivre("telefone 912345678")).toBe("telefone [nº redigido]");
  });

  it("apaga o código postal e o IBAN", () => {
    expect(redigirTextoLivre("morada 1000-001 Lisboa")).toBe("morada [CP redigido] Lisboa");
    expect(redigirTextoLivre("IBAN PT50000201231234567890154")).toBe("IBAN [IBAN redigido]");
  });

  it("não mutila uma referência de processo nem um UUID", () => {
    expect(redigirTextoLivre("PMF-2026-0042")).toBe("PMF-2026-0042");
    const uuid = "0192c1e2-1234-7890-8abc-1234567890ab";
    expect(redigirTextoLivre(uuid)).toBe(uuid);
  });

  it("não toca em números com menos ou mais de nove dígitos", () => {
    expect(redigirTextoLivre("bytes=1024")).toBe("bytes=1024");
    expect(redigirTextoLivre("id 1234567890123")).toBe("id 1234567890123");
  });

  it("não parte um SHA-256", () => {
    const hash = "a".repeat(32) + "b".repeat(32);
    expect(redigirTextoLivre(hash)).toBe(hash);
  });
});

describe("minimizarPii", () => {
  it("null e undefined saem como null", () => {
    expect(minimizarPii(null)).toBeNull();
    expect(minimizarPii(undefined)).toBeNull();
  });

  it("um payload sem dados pessoais sai EXATAMENTE igual — sem `_redigidos` a mais", () => {
    const antes = { estado: "aguardar_aprovacao", passo: 3, bytes: 1024 };
    expect(minimizarPii(antes)).toEqual(antes);
    expect(minimizarPii(antes)).not.toHaveProperty("_redigidos");
  });

  it("tira o NIF, a data de nascimento, o telefone e a morada, e diz quais tirou", () => {
    const saida = minimizarPii({
      nif: "249886344",
      dataNascimento: "1980-04-12",
      telefone: "912345678",
      morada: "Rua das Flores 12",
      codigoPostal: "1000-001",
      passo: 2,
    });

    expect(saida).not.toHaveProperty("nif");
    expect(saida).not.toHaveProperty("dataNascimento");
    expect(saida).not.toHaveProperty("telefone");
    expect(saida).not.toHaveProperty("morada");
    expect(saida).not.toHaveProperty("codigoPostal");
    expect(saida?.passo).toBe(2);
    expect(saida?._redigidos).toEqual([
      "codigoPostal",
      "dataNascimento",
      "morada",
      "nif",
      "telefone",
    ]);
  });

  it("reconhece a chave em snake_case — o schema Drizzle e o payload do formulário convivem", () => {
    const saida = minimizarPii({ doc_numero: "12345678", cedula_profissional: "12345L" });
    expect(saida).not.toHaveProperty("doc_numero");
    expect(saida).not.toHaveProperty("cedula_profissional");
    expect(saida?._redigidos).toEqual(["cedula_profissional", "doc_numero"]);
  });

  it("o email fica mascarado em vez de desaparecer — e à mesma na lista", () => {
    const saida = minimizarPii({ email: "maria@exemplo.pt", papel: "advogado" });
    expect(saida?.email).toBe("m***@exemplo.pt");
    expect(saida?.papel).toBe("advogado");
    expect(saida?._redigidos).toEqual(["email"]);
  });

  it("`para` e `enviadoPara` são endereços e seguem a mesma regra", () => {
    const saida = minimizarPii({ para: "cliente@exemplo.pt" });
    expect(saida?.para).toBe("c***@exemplo.pt");
    expect(saida?._redigidos).toEqual(["para"]);
  });

  it("o nome do ficheiro é o dado pessoal, não a embalagem dele", () => {
    const saida = minimizarPii({ nome: "Maria Silva - CC.pdf", tipo: "identificacao", bytes: 90210 });
    expect(saida).not.toHaveProperty("nome");
    expect(saida?.tipo).toBe("identificacao");
    expect(saida?.bytes).toBe(90210);
    expect(saida?._redigidos).toEqual(["nome"]);
  });

  it("uma chave sensível a null não conta como recolha", () => {
    const saida = minimizarPii({ nif: null, telefone: undefined, estado: "rascunho" });
    expect(saida).toEqual({ estado: "rascunho" });
  });

  it("desce a objetos aninhados e o caminho vai pontuado", () => {
    const saida = minimizarPii({
      perfil: { nomeCompleto: "Maria Silva", cargo: "sócia" },
      papel: "socio",
    });
    expect(saida?.perfil).toEqual({ cargo: "sócia" });
    expect(saida?._redigidos).toEqual(["perfil.nomeCompleto"]);
  });

  it("desce a arrays de objetos", () => {
    const saida = minimizarPii({
      titulares: [{ nif: "249886344", tipo: "cliente" }, { tipo: "representante" }],
    });
    expect(saida?.titulares).toEqual([{ tipo: "cliente" }, { tipo: "representante" }]);
    expect(saida?._redigidos).toEqual(["titulares[0].nif"]);
  });

  it("limpa PII escondida em texto livre sob uma chave inofensiva", () => {
    const saida = minimizarPii({ motivo: "cliente 249886344 sem contacto, ver maria@exemplo.pt" });
    expect(saida?.motivo).toBe("cliente [nº redigido] sem contacto, ver m***@exemplo.pt");
    // Não é redação de campo: nenhuma chave foi minimizada.
    expect(saida).not.toHaveProperty("_redigidos");
  });

  it("não mexe nos identificadores técnicos — o hash tem de continuar a servir", () => {
    const hash = "9f".repeat(32);
    const saida = minimizarPii({
      hash,
      referencia: "PMF-2026-0042",
      processoId: "0192c1e2-1234-7890-8abc-1234567890ab",
      versao: "2026.09.1",
    });
    expect(saida).toEqual({
      hash,
      referencia: "PMF-2026-0042",
      processoId: "0192c1e2-1234-7890-8abc-1234567890ab",
      versao: "2026.09.1",
    });
  });

  it("não altera o objeto que recebeu", () => {
    const entrada: Record<string, unknown> = { nif: "249886344", passo: 1 };
    minimizarPii(entrada);
    expect(entrada).toEqual({ nif: "249886344", passo: 1 });
  });

  it("Date sobrevive intacta — é valor, não objeto a percorrer", () => {
    const d = new Date("2026-09-03T10:00:00.000Z");
    const saida = minimizarPii({ quando: d });
    expect(saida?.quando).toBe(d);
  });

  it("trava em profundidade absurda sem rebentar", () => {
    let no: Record<string, unknown> = { nif: "249886344" };
    for (let i = 0; i < 40; i++) no = { dentro: no };
    expect(() => minimizarPii(no)).not.toThrow();
  });
});
