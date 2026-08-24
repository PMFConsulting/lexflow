import { nomeSeguro } from "./tipos";

/**
 * What gets recorded from a sync failure.
 *
 * Separate from `sincronizar.ts` so it can be tested: the other pulls in the
 * database and `server-only` behind it.
 */

/**
 * Sanitises an error message before recording it.
 *
 * The adapter's errors are already written so as not to quote credentials, but
 * a network error from the runtime can bring the full URL, and a URL can carry
 * the user stuck to it. This is the last line of defence, and it is worth
 * having: what goes into `evento_auditoria` stays there for seven years, and
 * the audit trail allows no UPDATE to correct the mistake.
 */
export function mensagemSegura(e: unknown): string {
  const bruta = e instanceof Error ? e.message : String(e);

  return bruta
    .replace(/\b(Bearer|Basic)\s+[\w.\-+/=]+/gi, "$1 [removido]")
    .replace(
      /([?&](?:access_token|refresh_token|client_secret|code|password|segredo)=)[^&\s]+/gi,
      "$1[removido]",
    )
    // Credentials embedded in a URL: https://user:secret@host
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+(?::[^/\s@]*)?@/gi, "$1[removido]@")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** One folder per client. The tax number breaks ties between namesakes; without it, only the name remains. */
export function nomeDaPasta(nome: string | null | undefined, nif: string | null): string {
  const base = nomeSeguro(nome, "Sem Nome");
  return nif ? `${base} (${nomeSeguro(nif, "sem NIF")})` : base;
}
