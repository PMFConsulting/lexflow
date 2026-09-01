import { describe, expect, it } from "vitest";
import {
  caminho,
  nomeSeguro,
  nomeSeguroDeFicheiro,
  parametrosS3,
  parametrosServidor,
  validarParametros,
} from "./tipos";

/**
 * The client's name comes from a public form and ends up in a file path. It is
 * the boundary with the most edges in the whole module.
 */
describe("nomeSeguro", () => {
  it("deixa passar um nome português normal", () => {
    expect(nomeSeguro("António Sá Nogueira")).toBe("António Sá Nogueira");
    expect(nomeSeguro("Construções & Cª, Lda.")).toBe("Construções & Cª, Lda.");
  });

  it("não deixa sair da pasta de destino", () => {
    expect(nomeSeguro("../../etc/passwd")).not.toContain("/");
    expect(nomeSeguro("../../etc/passwd")).not.toContain("..");
    expect(nomeSeguro("..")).toBe("Sem Nome");
    expect(nomeSeguro("C:\\Windows\\System32")).not.toContain("\\");
  });

  it("tira os caracteres que o Windows e o SharePoint recusam", () => {
    for (const c of ['*', '?', '"', "<", ">", "|", "#", "%", "~", ":"]) {
      expect(nomeSeguro(`Cliente${c}Nome`)).not.toContain(c);
    }
  });

  it("tira caracteres de controlo", () => {
    expect(nomeSeguro("Ana\u0000Maria\u001b[31m")).toBe("AnaMaria[31m");
  });

  it("recusa nomes reservados do Windows", () => {
    expect(nomeSeguro("CON")).toBe("Sem Nome");
    expect(nomeSeguro("nul.txt")).toBe("Sem Nome");
    expect(nomeSeguro("lpt1")).toBe("Sem Nome");
    // "console" is not reserved — only the exact name is.
    expect(nomeSeguro("Console Lda")).toBe("Console Lda");
  });

  it("cai na alternativa quando não sobra nada", () => {
    expect(nomeSeguro("")).toBe("Sem Nome");
    expect(nomeSeguro(null)).toBe("Sem Nome");
    expect(nomeSeguro(undefined)).toBe("Sem Nome");
    expect(nomeSeguro("///")).toBe("Sem Nome");
    expect(nomeSeguro("   ")).toBe("Sem Nome");
    expect(nomeSeguro("...")).toBe("Sem Nome");
    expect(nomeSeguro("", "Clientes")).toBe("Clientes");
  });

  it("corta o comprimento e não deixa espaços nas pontas", () => {
    const longo = nomeSeguro("A".repeat(400));
    expect(longo.length).toBeLessThanOrEqual(120);
    expect(nomeSeguro("  Maria  ")).toBe("Maria");
    expect(nomeSeguro(".oculto.")).toBe("oculto");
  });
});

describe("nomeSeguroDeFicheiro", () => {
  it("preserva a extensão", () => {
    expect(nomeSeguroDeFicheiro("cartao de cidadao.pdf")).toBe("cartao de cidadao.pdf");
    expect(nomeSeguroDeFicheiro("foto.JPG")).toBe("foto.JPG");
  });

  it("desarma um nome com travessia de caminho", () => {
    const nome = nomeSeguroDeFicheiro("../../.ssh/authorized_keys");
    expect(nome).not.toContain("/");
    expect(nome).not.toContain("..");
  });

  it("sobrevive a um nome sem base útil", () => {
    expect(nomeSeguroDeFicheiro("///.pdf")).toBe("anexo.pdf");
    expect(nomeSeguroDeFicheiro("")).toBe("anexo");
  });

  it("corta nomes longos sem perder a extensão", () => {
    const nome = nomeSeguroDeFicheiro(`${"a".repeat(300)}.pdf`);
    expect(nome.endsWith(".pdf")).toBe(true);
    expect(nome.length).toBeLessThanOrEqual(90);
  });
});

describe("caminho", () => {
  it("junta segmentos sem barras a dobrar", () => {
    expect(caminho(["Clientes", "Ana Silva"])).toBe("/Clientes/Ana Silva");
    expect(caminho(["/Clientes/", "", "  ", "PMF-2026-0001"])).toBe("/Clientes/PMF-2026-0001");
    expect(caminho([])).toBe("/");
  });
});

describe("validação dos parâmetros", () => {
  it("aceita um servidor SFTP completo", () => {
    expect(
      validarParametros({
        protocolo: "sftp",
        host: "arquivo.exemplo.pt",
        utilizador: "jm",
        segredo: "s3gr3d0",
      }),
    ).toMatchObject({ protocolo: "sftp", host: "arquivo.exemplo.pt" });
  });

  it("assume sftp quando o protocolo não vem", () => {
    expect(
      parametrosServidor.parse({ host: "arquivo.exemplo.pt", utilizador: "jm" }),
    ).toMatchObject({ protocolo: "sftp" });
  });

  it("recusa um servidor sem host", () => {
    expect(() => validarParametros({ utilizador: "jm" })).toThrow();
  });

  /**
   * SFTP is the only destination: a plain FTP or a cleartext WebDAV carried
   * identification documents across the network unencrypted, and an old
   * configuration on that protocol has to blow up at the boundary, not be
   * treated as if it were SFTP.
   */
  it("recusa qualquer protocolo que não seja sftp", () => {
    expect(() =>
      parametrosServidor.parse({ protocolo: "ftp", host: "h", utilizador: "u" }),
    ).toThrow();

    expect(() =>
      parametrosServidor.parse({ protocolo: "webdav", host: "h", utilizador: "u" }),
    ).toThrow();
  });

  it("aceita um bucket S3 completo quando o protocolo vem explícito", () => {
    expect(
      validarParametros({
        protocolo: "s3",
        regiao: "eu-central-1",
        bucket: "lexflow-jmassano",
        accessKeyId: "AKIA...",
        secretAccessKey: "segredo",
      }),
    ).toMatchObject({ protocolo: "s3", bucket: "lexflow-jmassano" });
  });

  it("recusa um bucket S3 sem região ou sem bucket", () => {
    expect(() =>
      parametrosS3.parse({
        protocolo: "s3",
        bucket: "lexflow-jmassano",
        accessKeyId: "AKIA...",
        secretAccessKey: "segredo",
      }),
    ).toThrow();

    expect(() =>
      parametrosS3.parse({
        protocolo: "s3",
        regiao: "eu-central-1",
        accessKeyId: "AKIA...",
        secretAccessKey: "segredo",
      }),
    ).toThrow();
  });
});
