import "server-only";
import { headers } from "next/headers";
import { env } from "@/env";

/**
 * Public address of this installation, for links sent by email.
 *
 * Comes from `BETTER_AUTH_URL`, never from request headers. Reading
 * `x-forwarded-host ?? host` let a `Host: attacker.pt` header put the
 * plaintext magic-link token — the case file's only auth factor, valid 30
 * days (D4) — into an attacker-controlled URL. Same header poisoned the
 * internal back-office notice too.
 *
 * One-value allowlist: the configured host. Any other throws — no link at
 * all — and the caller already handles it (`criarProcesso` falls back to
 * the relative link and logs it, D46). `x-forwarded-proto` is ignored as
 * well; the protocol comes from the same place as the host.
 */

/** The host (with port, if it has one) of a configured URL. */
function anfitriaoConfigurado(): { origem: string; host: string } {
  const url = new URL(env().BETTER_AUTH_URL);
  return { origem: `${url.protocol}//${url.host}`, host: url.host.toLowerCase() };
}

/**
 * Request's declared host, without the implicit port or dirt. Only `host`
 * — `x-forwarded-host` is ignored entirely, per the note above. `example.pt`
 * and `example.pt:443` are the same host under `https`.
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

  // No host header — a call outside an HTTP request (script, task) — and the
  // configured value is the only possible answer.
  if (recebido && recebido !== esperado) {
    throw new Error(
      `Anfitrião não reconhecido: o pedido chegou como "${recebido}" e esta instalação está configurada para "${esperado}" (BETTER_AUTH_URL). Nenhum link é montado a partir de um anfitrião fora da lista.`,
    );
  }

  return origem;
}
