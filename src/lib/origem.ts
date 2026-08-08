import "server-only";
import { headers } from "next/headers";
import { env } from "@/env";

/**
 * O endereço público desta instalação, para montar links que saem por email.
 *
 * Sai dos cabeçalhos do pedido e não de uma constante: entre o `localhost` do
 * desenvolvimento e o `poc.terlicalabs.com` de produção, um valor fixo mandava
 * metade dos links para o sítio errado. O `BETTER_AUTH_URL` fica como recurso
 * para quando isto correr fora de um pedido.
 *
 * Estava duplicado — a criação do processo derivava o anfitrião assim, e o
 * aviso ao back-office trazia `https://poc.terlicalabs.com` escrito à mão. Num
 * segundo cliente, ou numa mudança de domínio, o segundo continuava a apontar
 * para a instalação antiga.
 */
export async function origemPublica(): Promise<string> {
  const h = await headers();
  const anfitriao = h.get("x-forwarded-host") ?? h.get("host");
  if (!anfitriao) return env().BETTER_AUTH_URL.replace(/\/+$/, "");

  const protocolo =
    h.get("x-forwarded-proto") ?? (anfitriao.startsWith("localhost") ? "http" : "https");
  return `${protocolo}://${anfitriao}`;
}
