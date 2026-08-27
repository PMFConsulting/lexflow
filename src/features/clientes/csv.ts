/**
 * Escapa valores para CSV compatível com Excel em português (delimitador `;`).
 */
export function escaparCsv(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const str = String(v);
  if (str.includes(";") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Formata uma data para YYYY-MM-DD para exportação tabular.
 */
export function formatarDataIso(d: Date | string | null | undefined): string {
  if (!d) return "";
  const data = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(data.getTime())) return "";
  return data.toISOString().slice(0, 10);
}

/**
 * Gera o conteúdo CSV com BOM UTF-8 e delimitador `;` para clientes.
 */
export function gerarCsvClientes(
  clientes: Array<{
    ultimaReferencia: string;
    nome: string | null;
    tipoCliente: "particular" | "empresa";
    nif: string;
    email: string | null;
    ultimoEstado: string;
    ultimoCriadoEm: Date | string | null;
  }>,
): string {
  const cabecalho = ["Referência", "Nome", "Tipo", "NIF", "Email", "Estado", "Data"];
  const linhas = [cabecalho.join(";")];

  for (const c of clientes) {
    const linha = [
      escaparCsv(c.ultimaReferencia),
      escaparCsv(c.nome ?? ""),
      escaparCsv(c.tipoCliente === "empresa" ? "Empresa" : "Particular"),
      escaparCsv(c.nif),
      escaparCsv(c.email ?? ""),
      escaparCsv(c.ultimoEstado),
      escaparCsv(formatarDataIso(c.ultimoCriadoEm)),
    ];
    linhas.push(linha.join(";"));
  }

  // BOM UTF-8 (\uFEFF) para garantir abertura correta de caracteres com acentos no Excel PT
  return `\uFEFF${linhas.join("\r\n")}`;
}
