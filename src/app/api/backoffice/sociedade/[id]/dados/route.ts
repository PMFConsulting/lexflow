import { NextResponse } from "next/server";
import { exigirEquipaOuSuperAdmin, exigirSuperAdmin, podeAcederSociedade } from "@/lib/sessao";
import {
  eliminarDadosDaSociedade,
  exportarDadosDaSociedade,
} from "@/features/sociedade/direitos";

/**
 * Direitos do titular (RGPD) sobre os dados da sociedade, no back-office.
 *
 * GET    → exportação (artigos 15.º e 20.º): JSON com os dados pessoais da
 *          organização. Qualquer elemento da equipa da sociedade — ou o
 *          `super_admin` da plataforma — pode pedir a sua própria
 *          exportação.
 * DELETE → eliminação (artigo 17.º). **Só o `super_admin`** — apagar uma
 *          conta inteira não é uma ação de equipa. Sem corpo, corre em modo
 *          de simulação (dry-run); a execução real exige `{"confirmar": true,
 *          "motivo": "..."}` e limita-se a apagamento lógico, como documenta
 *          `features/sociedade/direitos.ts`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  pedido: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!UUID.test(id)) {
    return NextResponse.json({ erro: "Sociedade não encontrada." }, { status: 404 });
  }

  const { eu } = await exigirEquipaOuSuperAdmin();

  // Uma sociedade de outra organização responde o mesmo que uma sociedade que
  // não existe: distingui-las confirmaria a existência a quem não a pode ver.
  if (!podeAcederSociedade(eu, id)) {
    return NextResponse.json({ erro: "Sociedade não encontrada." }, { status: 404 });
  }

  try {
    const dados = await exportarDadosDaSociedade(id);
    return NextResponse.json(dados);
  } catch (e) {
    if (e instanceof Error && e.message === "Sociedade não encontrada.") {
      return NextResponse.json({ erro: "Sociedade não encontrada." }, { status: 404 });
    }
    console.error("[dados-sociedade] exportação falhou", String(e));
    return NextResponse.json(
      { erro: "Não foi possível gerar a exportação. Tente de novo." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  pedido: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!UUID.test(id)) {
    return NextResponse.json({ erro: "Sociedade não encontrada." }, { status: 404 });
  }

  // Eliminar a conta de uma sociedade é uma decisão da plataforma, não da
  // equipa — e quem a executa tem de saber que um DELETE sem corpo devolve a
  // simulação, não o apagamento.
  const { eu } = await exigirSuperAdmin();

  let corpo: { confirmar?: boolean; motivo?: string } = {};
  try {
    corpo = (await pedido.json()) as { confirmar?: boolean; motivo?: string };
  } catch {
    // DELETE sem corpo — vale como pedido de simulação.
  }

  const { confirmar = false, motivo } = corpo;

  try {
    const resultado = await eliminarDadosDaSociedade(id, {
      confirmar,
      motivo,
      ip: pedido.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: pedido.headers.get("user-agent") ?? null,
    });
    return NextResponse.json(resultado);
  } catch (e) {
    if (e instanceof Error && e.message === "Sociedade não encontrada.") {
      return NextResponse.json({ erro: "Sociedade não encontrada." }, { status: 404 });
    }
    if (e instanceof Error && e.message.includes("motivo")) {
      return NextResponse.json({ erro: e.message }, { status: 400 });
    }
    console.error("[dados-sociedade] eliminação falhou", {
      sociedade: id,
      erro: String(e),
    });
    return NextResponse.json(
      { erro: "Não foi possível executar a eliminação. Tente de novo." },
      { status: 500 },
    );
  }
}
