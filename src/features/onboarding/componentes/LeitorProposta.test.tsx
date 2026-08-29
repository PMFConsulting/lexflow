// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeitorProposta, type PropostaAnexada } from "./LeitorProposta";

afterEach(cleanup);

/**
 * BUG-302: em webviews sem visor de PDF embutido o `<iframe>` nunca dispara
 * `onLoad`, e o botão "Li e compreendi" ficava bloqueado para sempre — o
 * cliente não tinha outra via para marcar a proposta como lida.
 */

const proposta: PropostaAnexada = {
  nome: "Proposta-Cliente.pdf",
  bytes: 234_000,
  url: "/onboarding/token/proposta",
};

describe("LeitorProposta — sem proposta anexada", () => {
  it("mantém-se bloqueado com a mensagem atual, sem via de contorno", () => {
    render(<LeitorProposta lido={false} aoLer={vi.fn()} anexada={null} />);
    expect(
      screen.getByText("A sociedade ainda não anexou a proposta deste processo. Para continuar, contacte-a."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Confirmei que li a proposta noutra janela")).not.toBeInTheDocument();
  });
});

describe("LeitorProposta — fallback de leitura em webview sem visor de PDF (BUG-302)", () => {
  it("o botão 'Li e compreendi' começa bloqueado ao abrir o modal", () => {
    render(<LeitorProposta lido={false} aoLer={vi.fn()} anexada={proposta} />);
    fireEvent.click(screen.getByRole("button", { name: "Ver proposta" }));

    expect(screen.getByRole("button", { name: "Abra o documento" })).toBeDisabled();
    expect(screen.getByText("Abra o documento para poder continuar.")).toBeInTheDocument();
  });

  it("clicar no fallback ativa o aceite, mesmo sem o onLoad do iframe disparar", () => {
    const aoLer = vi.fn();
    render(<LeitorProposta lido={false} aoLer={aoLer} anexada={proposta} />);
    fireEvent.click(screen.getByRole("button", { name: "Ver proposta" }));

    fireEvent.click(screen.getByText("Confirmei que li a proposta noutra janela"));

    expect(aoLer).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Li e compreendi" })).not.toBeDisabled();
    expect(screen.getByText("Documento aberto.")).toBeInTheDocument();
    expect(screen.queryByText("Confirmei que li a proposta noutra janela")).not.toBeInTheDocument();
  });

  it("clicar em 'Abrir em janela própria' também marca a proposta como lida", () => {
    const aoLer = vi.fn();
    render(<LeitorProposta lido={false} aoLer={aoLer} anexada={proposta} />);
    fireEvent.click(screen.getByRole("button", { name: "Ver proposta" }));

    fireEvent.click(screen.getByRole("link", { name: /Abrir em janela própria/ }));

    expect(aoLer).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Li e compreendi" })).not.toBeDisabled();
  });

  it("o iframe a carregar (visor de PDF normal) continua a marcar a leitura", () => {
    const aoLer = vi.fn();
    render(<LeitorProposta lido={false} aoLer={aoLer} anexada={proposta} />);
    fireEvent.click(screen.getByRole("button", { name: "Ver proposta" }));

    fireEvent.load(screen.getByTitle(`Proposta de honorários — ${proposta.nome}`));

    expect(aoLer).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Li e compreendi" })).not.toBeDisabled();
  });
});
