import { describe, expect, it } from "vitest";
import {
  emailNotificacaoSociedadeCriada,
  emailNotificacaoNovoUtilizador,
} from "./notificacoes-dono";

describe("emailNotificacaoSociedadeCriada", () => {
  it("monta o email com todos os dados da nova sociedade", () => {
    const html = emailNotificacaoSociedadeCriada({
      nome: "Silva & Associados",
      nif: "501234567",
      prefixo: "SVA",
      adminNome: "Dr. Silva",
      adminEmail: "silva@exemplo.pt",
      link: "https://plataforma.pt/admin/sociedades/org-123",
      erroAdmin: null,
    });

    expect(html).toContain("Silva &amp; Associados");
    expect(html).toContain("501234567");
    expect(html).toContain("SVA");
    expect(html).toContain("silva@exemplo.pt");
    expect(html).toContain("Dr. Silva");
    expect(html).toContain("https://plataforma.pt/admin/sociedades/org-123");
    expect(html).toContain("Conta criada com sucesso");
    expect(html).not.toContain("Alerta de criação de conta");
  });

  it("inclui alerta claro quando a conta do admin falhou", () => {
    const html = emailNotificacaoSociedadeCriada({
      nome: "Nova Sociedade",
      nif: "509876543",
      prefixo: "NOV",
      adminNome: "Admin",
      adminEmail: "admin@erro.pt",
      link: "https://plataforma.pt/admin/sociedades/org-456",
      erroAdmin: "Não foi possível criar a conta do administrador.",
    });

    expect(html).toContain("Nova Sociedade");
    expect(html).toContain("509876543");
    expect(html).toContain("Alerta de criação de conta");
    expect(html).toContain("Não foi possível criar a conta do administrador.");
  });
});

describe("emailNotificacaoNovoUtilizador", () => {
  it("monta a notificação curta com nome, email e sociedade", () => {
    const html = emailNotificacaoNovoUtilizador({
      nome: "Ana Martins",
      email: "ana@sociedade.pt",
      sociedade: "Martins Advogados",
      papel: "utilizador",
    });

    expect(html).toContain("Ana Martins");
    expect(html).toContain("ana@sociedade.pt");
    expect(html).toContain("Martins Advogados");
    expect(html).toContain("Utilizador");
  });

  it("monta a notificação para society_admin", () => {
    const html = emailNotificacaoNovoUtilizador({
      nome: "Carlos Gestor",
      email: "carlos@sociedade.pt",
      sociedade: "Carlos & Cia",
      papel: "society_admin",
    });

    expect(html).toContain("Carlos Gestor");
    expect(html).toContain("Administrador da Sociedade");
  });
});
