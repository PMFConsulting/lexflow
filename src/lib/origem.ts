import "server-only";
import { headers } from "next/headers";
import { env } from "@/env";

/**
 * O endereço público desta instalação, para montar links que saem por email.
 *
 * **Sai de `BETTER_AUTH_URL` e nunca dos cabeçalhos.** O que aqui estava lia
 * `x-forwarded-host ?? host` e devolvia-o tal e qual, e isso é um buraco com
 * consequência inteira: o anfitrião de um pedido é escrito por quem o faz, e
 * um `POST` à Server Action com `Host: atacante.pt` fazia sair o email de
 * registo com `https://atacante.pt/onboarding/<token>` — com o token em claro
 * no caminho. O token é o **único** fator de autenticação do dossier e vale 30
 * dias (D4); entregá-lo a um anfitrião escolhido por terceiros é entregar o
 * dossier. O mesmo cabeçalho envenenava o link do aviso interno ao back-office.
 *
 * A régua é uma allowlist de um só valor: o anfitrião configurado. Um pedido
 * que chegue com outro **não** produz link nenhum — lança, e quem chama já
 * trata a exceção (o `criarProcesso` cai no link relativo e grita na consola,
 * D46). Falhar fechado é a única saída aceitável: um link montado a partir de
 * um anfitrião não reconhecido é pior do que um link em falta, porque tem ar de
 * bom e leva o segredo com ele.
 *
 * O `x-forwarded-proto` também não decide — o protocolo vem do mesmo sítio que
 * o anfitrião. Em desenvolvimento não muda nada: `BETTER_AUTH_URL` é
 * `http://localhost:3000` e é isso que o link leva.
 */

/** O anfitrião (com porta, se a tiver) de um URL configurado. */
function anfitriaoConfigurado(): { origem: string; host: string } {
  const url = new URL(env().BETTER_AUTH_URL);
  return { origem: `${url.protocol}//${url.host}`, host: url.host.toLowerCase() };
}

/**
 * O anfitrião que o pedido declara, sem porta implícita e sem sujidade.
 *
 * Só o `host` — o `x-forwarded-host` é ignorado por completo, como manda a
 * nota em cima. Um `Host: exemplo.pt:443` e um `Host: exemplo.pt` são o mesmo
 * anfitrião quando o esquema é `https`, e recusar o primeiro seria recusar um
 * proxy bem configurado por causa de uma porta explícita.
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

  // Sem cabeçalho de anfitrião não há nada a comparar — é o caso de uma
  // chamada fora de um pedido HTTP (um script, uma tarefa), e aí o valor
  // configurado é a única resposta possível e é a certa.
  if (recebido && recebido !== esperado) {
    throw new Error(
      `Anfitrião não reconhecido: o pedido chegou como "${recebido}" e esta instalação está configurada para "${esperado}" (BETTER_AUTH_URL). Nenhum link é montado a partir de um anfitrião fora da lista.`,
    );
  }

  return origem;
}
