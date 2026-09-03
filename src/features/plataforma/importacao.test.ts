import { describe, expect, it } from "vitest";
import { prepararImportacao } from "./importacao";

/**
 * A leitura de um ficheiro de contas.
 *
 * O que estes testes protegem não é o formato — é a **pré-visualização**. Uma
 * importação que descobre o segundo email repetido depois de já ter criado
 * quinze contas deixa a sociedade a meio caminho, sem forma de saber o que
 * ficou feito. Por isso tudo o que aqui se decide decide-se antes de existir
 * uma escrita, e cada recusa carrega o número da linha como o Excel a mostra.
 */

const folha = (texto: string) => Buffer.from(texto, "utf8");

const CABECALHO = "nome;email;papel";

describe("prepararImportacao", () => {
  it("aceita as linhas boas e diz a linha de cada má", () => {
    const r = prepararImportacao(
      folha(
        [
          CABECALHO,
          "Maria Silva;maria@x.pt;society_admin",
          "sem email;;utilizador",
          "João Antunes;joao@x.pt;utilizador",
        ].join("\n"),
      ),
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.previsao.validas).toEqual([
      { numero: 2, nome: "Maria Silva", email: "maria@x.pt", papel: "society_admin" },
      { numero: 4, nome: "João Antunes", email: "joao@x.pt", papel: "utilizador" },
    ]);
    expect(r.previsao.recusadas).toEqual([
      { numero: 3, bruto: "sem email · utilizador", motivo: "Falta o email." },
    ]);
  });

  /**
   * O cabeçalho vem de fora e ninguém o escreve duas vezes igual. Recusar o
   * ficheiro por causa de "E-Mail" com maiúscula seria a forma mais rápida de
   * a importação deixar de ser usada.
   */
  it("reconhece o cabeçalho com acentos, maiúsculas e sinónimos", () => {
    const r = prepararImportacao(
      folha("Nome Completo;E-Mail;Função\nMaria Silva;maria@x.pt;Advogado"),
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.previsao.validas).toEqual([
      { numero: 2, nome: "Maria Silva", email: "maria@x.pt", papel: "utilizador" },
    ]);
  });

  it("as colunas podem vir noutra ordem", () => {
    const r = prepararImportacao(folha("papel;email;nome\nutilizador;maria@x.pt;Maria"));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.previsao.validas[0]).toMatchObject({ nome: "Maria", email: "maria@x.pt" });
  });

  /**
   * Os nomes antigos continuam a ser o que a sociedade diz em voz alta, e vão
   * aparecer nos ficheiros durante muito tempo depois de o enum ter mudado.
   */
  it("traduz os cargos antigos para o papel novo", () => {
    const r = prepararImportacao(
      folha(
        [
          CABECALHO,
          "A;a@x.pt;Advogado",
          "B;b@x.pt;assistente",
          "C;c@x.pt;Sócia",
          "D;d@x.pt;Administrador",
          "E;e@x.pt;Gestor",
          "F;f@x.pt;Gestora",
        ].join("\n"),
      ),
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.previsao.validas.map((l) => l.papel)).toEqual([
      "utilizador",
      "utilizador",
      "utilizador",
      "society_admin",
      "gestor",
      "gestor",
    ]);
  });

  it("recusa o papel que não reconhece, dizendo o que lá estava", () => {
    const r = prepararImportacao(folha(`${CABECALHO}\nMaria;maria@x.pt;chefe`));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.previsao.validas).toHaveLength(0);
    expect(r.previsao.recusadas[0].motivo).toContain('"chefe"');
  });

  /**
   * O `super_admin` é da plataforma e não de uma sociedade. Deixá-lo entrar por
   * um ficheiro de importação era permitir que quem administra uma sociedade
   * criasse, com uma linha de Excel, uma conta que vê **todas** as outras.
   */
  it("não deixa criar um super_admin por ficheiro", () => {
    const r = prepararImportacao(folha(`${CABECALHO}\nMaria;maria@x.pt;super_admin`));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.previsao.validas).toHaveLength(0);
    expect(r.previsao.recusadas[0].motivo).toContain("super_admin");
  });

  it("recusa um email malformado", () => {
    const r = prepararImportacao(folha(`${CABECALHO}\nMaria;maria arroba x;utilizador`));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.previsao.recusadas[0].motivo).toContain("não é um endereço de email válido");
  });

  /**
   * As duas duplicações têm mensagens diferentes de propósito: uma corrige-se
   * no ficheiro, a outra não é sequer erro de quem o escreveu. Uma mensagem só
   * mandava metade das pessoas procurar o problema no sítio errado.
   */
  it("distingue o repetido dentro do ficheiro do que já existe na sociedade", () => {
    const r = prepararImportacao(
      folha(
        [
          CABECALHO,
          "Maria;maria@x.pt;utilizador",
          "Maria de novo;MARIA@x.pt;utilizador",
          "Pedro;pedro@x.pt;utilizador",
        ].join("\n"),
      ),
      ["Pedro@X.pt"],
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.previsao.validas).toHaveLength(1);
    expect(r.previsao.recusadas[0].motivo).toContain("mais do que uma vez neste ficheiro");
    expect(r.previsao.recusadas[1].motivo).toContain("Já existe uma conta");
  });

  it("recusa email que já existe noutra sociedade com mensagem explicativa", () => {
    const r = prepararImportacao(
      folha(
        [
          CABECALHO,
          "Maria Silva;maria@x.pt;utilizador",
          "Carlos Costa;carlos@outra.pt;utilizador",
        ].join("\n"),
      ),
      [],
      ["carlos@outra.pt"],
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.previsao.validas).toHaveLength(1);
    expect(r.previsao.validas[0].email).toBe("maria@x.pt");
    expect(r.previsao.recusadas).toEqual([
      {
        numero: 3,
        bruto: "Carlos Costa · carlos@outra.pt · utilizador",
        motivo:
          "Já existe uma conta com este email.",
      },
    ]);
  });

  it("compara emails sem olhar a maiúsculas", () => {
    const r = prepararImportacao(folha(`${CABECALHO}\nMaria;MARIA@X.PT;utilizador`));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.previsao.validas[0].email).toBe("maria@x.pt");
  });

  it("diz que colunas faltam, em vez de «ficheiro inválido»", () => {
    const r = prepararImportacao(folha("nome;telefone\nMaria;912345678"));

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("email");
    expect(r.erro).toContain("papel");
  });

  it("recusa um ficheiro vazio", () => {
    expect(prepararImportacao(folha(""))).toMatchObject({ ok: false });
  });

  it("um ficheiro só com cabeçalho não é erro — não tem é nada para criar", () => {
    const r = prepararImportacao(folha(CABECALHO));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.previsao.validas).toHaveLength(0);
    expect(r.previsao.recusadas).toHaveLength(0);
  });
});
