import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BUG7-002: o detalhe do processo não tinha `generateMetadata` e cada
 * separador aberto chamava-se "LexFlow — Processos", o `default` do layout de
 * raiz. O título passa a levar a referência — e tem de continuar a responder
 * quando o processo não existe, porque quem devolve o 404 é a página e uma
 * exceção lançada aqui trocava esse ecrã por um erro.
 *
 * Só a metadata é exercitada: o componente da página é mockado para o módulo
 * poder ser importado sem arrastar a árvore de UI para dentro do Vitest.
 */

const processoPorIdMock = vi.fn();

vi.mock("@/features/processos/consultas", () => ({
  processoPorId: (...args: unknown[]) => processoPorIdMock(...args),
  documentosDoProcesso: vi.fn(),
  propostaDoProcesso: vi.fn(),
}));

vi.mock("@/features/processos/componentes/DetalheProcesso", () => ({
  DetalheProcesso: () => null,
}));

vi.mock("@/features/auditoria/consultas", () => ({ auditoriaDoProcesso: vi.fn() }));
vi.mock("@/features/auditoria/registar", () => ({ registarEvento: vi.fn() }));
vi.mock("@/features/emails/consultas", () => ({ emailsDoProcesso: vi.fn() }));
vi.mock("@/features/onboarding/dados", () => ({
  assinaturaDoProcesso: vi.fn(),
  seccoesDoProcesso: vi.fn(),
}));
vi.mock("@/lib/sessao", () => ({
  exigirEquipaOuSuperAdmin: vi.fn(),
  podeAprovarProcesso: vi.fn(),
  podeReabrirProcesso: vi.fn(),
  podeReenviarLinkProcesso: vi.fn(),
  podeVerPpe: vi.fn(),
}));

const ID = "018f1e2a-0000-7000-8000-000000000001";

describe("generateMetadata do detalhe de processo", () => {
  beforeEach(() => {
    processoPorIdMock.mockReset();
  });

  it("leva a referência do processo", async () => {
    processoPorIdMock.mockResolvedValue({ id: ID, referencia: "PMF-2026-9599" });
    const { generateMetadata } = await import("./page");

    await expect(generateMetadata({ params: Promise.resolve({ id: ID }) })).resolves.toEqual({
      title: "Processo PMF-2026-9599",
    });
    expect(processoPorIdMock).toHaveBeenCalledWith(ID);
  });

  it("processo inexistente: título genérico, sem lançar", async () => {
    processoPorIdMock.mockResolvedValue(null);
    const { generateMetadata } = await import("./page");

    await expect(generateMetadata({ params: Promise.resolve({ id: ID }) })).resolves.toEqual({
      title: "Processo",
    });
  });
});
