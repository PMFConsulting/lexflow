/**
 * Shared pt-PT date formatting. `Intl.DateTimeFormat.format()` only accepts a
 * `Date`/number — a string (what a Server Action returns after JSON
 * serialization, or what some drivers hand back for a timestamp column)
 * throws `RangeError: Invalid time value`. Both helpers convert first and
 * fall back to "—" for anything that isn't a valid date, instead of crashing
 * a render.
 */

export function formatarData(
  valor: Date | string | null | undefined,
  opcoes: Intl.DateTimeFormatOptions = { dateStyle: "long" },
): string {
  if (!valor) return "—";
  const data = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(data.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-PT", opcoes).format(data);
}

export function formatarDataCurta(valor: Date | string | null | undefined): string {
  return formatarData(valor, { dateStyle: "short" });
}
