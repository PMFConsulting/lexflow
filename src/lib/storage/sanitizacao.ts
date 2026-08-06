import { nomeSeguro } from "./tipos";

/**
 * O que se grava a partir de uma falha de sincronização.
 *
 * Separado de `sincronizar.ts` para poder ser testado: o outro puxa a base de
 * dados e o `server-only` atrás dele.
 */

/**
 * Sanitiza uma mensagem de erro antes de a gravar.
 *
 * Os erros dos adaptadores já são escritos para não citar credenciais, mas um
 * erro de rede do runtime pode trazer o URL completo — e num WebDAV o URL leva
 * o utilizador e a palavra-passe. Isto é a última linha, e vale a pena tê-la:
 * o que entra em `evento_auditoria` fica lá sete anos, e a auditoria não
 * permite UPDATE para corrigir o engano.
 */
export function mensagemSegura(e: unknown): string {
  const bruta = e instanceof Error ? e.message : String(e);

  return bruta
    .replace(/\b(Bearer|Basic)\s+[\w.\-+/=]+/gi, "$1 [removido]")
    .replace(
      /([?&](?:access_token|refresh_token|client_secret|code|password|segredo)=)[^&\s]+/gi,
      "$1[removido]",
    )
    // Credenciais embebidas em URL: https://utilizador:segredo@host
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+(?::[^/\s@]*)?@/gi, "$1[removido]@")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** Uma pasta por cliente. O NIF desempata homónimos; sem ele, fica só o nome. */
export function nomeDaPasta(nome: string | null | undefined, nif: string | null): string {
  const base = nomeSeguro(nome, "Sem Nome");
  return nif ? `${base} (${nomeSeguro(nif, "sem NIF")})` : base;
}
