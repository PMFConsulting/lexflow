"use server";

import { exigirSocietyAdmin } from "@/lib/sessao";
import { registarEvento } from "@/features/auditoria/registar";
import { listarClientes } from "./consultas";
import { gerarCsvClientes } from "./csv";

export type ResultadoExportacaoClientes =
  | {
      ok: true;
      csv: string;
      total: number;
      nomeFicheiro: string;
    }
  | {
      ok: false;
      erro: string;
    };

/**
 * Server Action para exportação de clientes em formato CSV.
 * Apenas utilizadores com papel `society_admin` têm autorização.
 */
export async function exportarClientesCsv(
  termoPesquisa?: string,
): Promise<ResultadoExportacaoClientes> {
  const { eu } = await exigirSocietyAdmin();

  const clientes = await listarClientes(eu.organizacaoId, termoPesquisa);
  const csv = gerarCsvClientes(clientes);

  const hoje = new Date().toISOString().slice(0, 10);
  const nomeFicheiro = `clientes-${hoje}.csv`;

  await registarEvento({
    organizacaoId: eu.organizacaoId,
    atorId: eu.id,
    acao: "clientes.exportados",
    entidade: "cliente",
    valorNovo: {
      total: clientes.length,
      filtro: termoPesquisa || null,
    },
  });

  return {
    ok: true,
    csv,
    total: clientes.length,
    nomeFicheiro,
  };
}
