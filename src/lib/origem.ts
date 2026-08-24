import "server-only";
import { headers } from "next/headers";
import { env } from "@/env";

/**
 * The public address of this installation, for building links that go out by
 * email.
 *
 * **It comes from `BETTER_AUTH_URL` and never from the headers.** What was here
 * read `x-forwarded-host ?? host` and returned it as-is, and that is a hole
 * with a whole consequence: a request's host is written by whoever makes it,
 * and a `POST` to the Server Action with `Host: attacker.pt` made the
 * registration email go out with `https://attacker.pt/onboarding/<token>` —
 * with the plaintext token in the path. The token is the **only** authentication
 * factor for the case file and is valid for 30 days (D4); handing it to a host
 * chosen by third parties is handing over the case file. The same header
 * poisoned the link in the internal back-office notice.
 *
 * The rule is a one-value allowlist: the configured host. A request arriving
 * with any other produces **no** link at all — it throws, and the caller
 * already handles the exception (`criarProcesso` falls back to the relative
 * link and shouts in the console, D46). Failing closed is the only acceptable
 * exit: a link built from an unrecognised host is worse than a missing link,
 * because it looks fine and carries the secret with it.
 *
 * `x-forwarded-proto` does not decide either — the protocol comes from the same
 * place as the host. In development nothing changes: `BETTER_AUTH_URL` is
 * `http://localhost:3000` and that is what the link carries.
 */

/** The host (with port, if it has one) of a configured URL. */
function anfitriaoConfigurado(): { origem: string; host: string } {
  const url = new URL(env().BETTER_AUTH_URL);
  return { origem: `${url.protocol}//${url.host}`, host: url.host.toLowerCase() };
}

/**
 * The host the request declares, without the implicit port and without dirt.
 *
 * Only `host` — `x-forwarded-host` is ignored entirely, as the note above
 * requires. A `Host: example.pt:443` and a `Host: example.pt` are the same host
 * when the scheme is `https`, and refusing the first would be refusing a
 * well-configured proxy over an explicit port.
 */
function anfitriaoDoPedido(bruto: string | null, protocolo: string): string | null {
  if (!bruto) return null;
  const limpo = bruto.trim().toLowerCase();
  if (!limpo) return null;
  const porta = protocolo === "https:" ? ":443" : ":80";
  return limpo.endsWith(porta) ? limpo.slice(0, -porta.length) : limpo;
}

export async function origemPublica(): Promise<string> {
  const { origem, host } = anfitriaoConfigurado();
  const protocolo = new URL(origem).protocol;
  const esperado = anfitriaoDoPedido(host, protocolo) ?? host;

  const h = await headers();
  const recebido = anfitriaoDoPedido(h.get("host"), protocolo);

  // With no host header there is nothing to compare — that is the case of a
  // call outside an HTTP request (a script, a task), and there the configured
  // value is the only possible answer and it is the right one.
  if (recebido && recebido !== esperado) {
    throw new Error(
      `Anfitrião não reconhecido: o pedido chegou como "${recebido}" e esta instalação está configurada para "${esperado}" (BETTER_AUTH_URL). Nenhum link é montado a partir de um anfitrião fora da lista.`,
    );
  }

  return origem;
}
