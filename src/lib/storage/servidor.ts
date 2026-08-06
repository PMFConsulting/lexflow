import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Destino, Ficheiro, ParametrosServidor, Verificacao } from "./tipos";
import { caminho } from "./tipos";

/**
 * Servidor à escolha da sociedade. Implementação base, dois protocolos:
 *
 *   · WebDAV sobre HTTPS — `fetch`, com MKCOL e PUT. É o caminho preferido:
 *     não sai do processo e não depende de binários instalados.
 *   · SFTP sobre SSH — através do `curl`, que fala sftp:// nativamente.
 *
 * Ambos são cifrados em trânsito, e isso não é configurável: um destino em
 * HTTP simples ou FTP é recusado à entrada. O que atravessa isto são
 * documentos de identificação.
 */

const executar = promisify(execFile);

/** Um upload não pode ficar pendurado a segurar a submissão de um processo. */
const TEMPO_LIMITE_MS = 60_000;

export class ErroServidor extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroServidor";
  }
}

/* ------------------------------------------------------------------ WebDAV */

function baseWebdav(p: ParametrosServidor): URL {
  // Sem esquema explícito, assume-se HTTPS. Com `http://` explícito, recusa-se.
  const bruto = /^[a-z][a-z0-9+.-]*:\/\//i.test(p.host) ? p.host : `https://${p.host}`;
  const url = new URL(bruto);

  if (url.protocol !== "https:") {
    throw new ErroServidor(
      "O WebDAV só é aceite sobre HTTPS. Um destino em HTTP simples transporta " +
        "documentos de identificação em claro.",
    );
  }
  if (p.porta) url.port = String(p.porta);
  return url;
}

function urlWebdav(p: ParametrosServidor, segmentos: string[]): string {
  const base = baseWebdav(p);
  const prefixo = p.caminhoBase ? caminho([p.caminhoBase]) : "";
  const cauda = caminho(segmentos)
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");

  base.pathname = caminho([prefixo, cauda]);
  return base.toString();
}

function autorizacaoBasica(p: ParametrosServidor): string {
  const par = `${p.utilizador}:${p.segredo ?? ""}`;
  return `Basic ${Buffer.from(par, "utf8").toString("base64")}`;
}

function criarDestinoWebdav(p: ParametrosServidor): Destino {
  const cabecalhos = () => ({ authorization: autorizacaoBasica(p) });

  const pedir = (url: string, init: RequestInit) =>
    fetch(url, {
      ...init,
      headers: { ...cabecalhos(), ...init.headers },
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });

  return {
    tipo: "servidor",

    async garantirPasta(segmentos) {
      // MKCOL não cria intermédias: um nível de cada vez, como no Graph.
      const percorridos: string[] = [];
      for (const segmento of segmentos) {
        percorridos.push(segmento);
        const resposta = await pedir(urlWebdav(p, percorridos), { method: "MKCOL" });

        // 405 e 301 = a coleção já existe, que é o resultado desejado.
        if (!resposta.ok && ![405, 301].includes(resposta.status)) {
          throw new ErroServidor(
            `MKCOL de "${segmento}" recusado (HTTP ${resposta.status}).`,
          );
        }
      }
    },

    async enviar(segmentos, ficheiro: Ficheiro) {
      const resposta = await pedir(urlWebdav(p, [...segmentos, ficheiro.nome]), {
        method: "PUT",
        headers: { "content-type": ficheiro.mime },
        body: new Uint8Array(ficheiro.conteudo),
      });

      if (!resposta.ok) {
        throw new ErroServidor(
          `Falha ao enviar "${ficheiro.nome}" (HTTP ${resposta.status}).`,
        );
      }
    },

    async verificar(): Promise<Verificacao> {
      try {
        const resposta = await pedir(urlWebdav(p, []), {
          method: "PROPFIND",
          headers: { depth: "0" },
        });
        return resposta.ok || resposta.status === 207
          ? { ok: true, detalhe: `WebDAV acessível em ${baseWebdav(p).host}.` }
          : { ok: false, detalhe: `O servidor respondeu HTTP ${resposta.status}.` };
      } catch (e) {
        return { ok: false, detalhe: e instanceof Error ? e.message : "Falha desconhecida." };
      }
    },
  };
}

/* -------------------------------------------------------------------- SFTP */

function urlSftp(p: ParametrosServidor, segmentos: string[]): string {
  const anfitriao = p.host.replace(/^sftp:\/\//i, "").replace(/\/.*$/, "");
  const porta = p.porta ? `:${p.porta}` : "";
  const cauda = caminho([p.caminhoBase ?? "", ...segmentos]);
  return `sftp://${anfitriao}${porta}${cauda}`;
}

/**
 * O `curl` recebe o segredo num ficheiro `.netrc` temporário com permissões
 * 0600, nunca em `argv`: a linha de comandos de um processo é legível por
 * qualquer utilizador da máquina, e um `ps aux` não pode revelar a
 * palavra-passe do arquivo de clientes.
 */
async function comNetrc<T>(
  p: ParametrosServidor,
  trabalho: (argumentos: string[]) => Promise<T>,
): Promise<T> {
  const pasta = await mkdtemp(join(tmpdir(), "arm-"));
  const ficheiro = join(pasta, "netrc");
  const anfitriao = p.host.replace(/^sftp:\/\//i, "").replace(/\/.*$/, "");

  try {
    await writeFile(
      ficheiro,
      `machine ${anfitriao} login ${p.utilizador} password ${p.segredo ?? ""}\n`,
      { mode: 0o600 },
    );
    await chmod(ficheiro, 0o600);

    const argumentos = [
      "--silent",
      "--show-error",
      "--fail",
      "--netrc-file",
      ficheiro,
      "--max-time",
      String(Math.floor(TEMPO_LIMITE_MS / 1000)),
    ];

    // Verificação da chave do host. Sem impressão digital configurada, o curl
    // usa o `known_hosts` do sistema — e falha contra um host desconhecido,
    // que é o comportamento certo.
    if (p.impressaoDigitalHost) {
      argumentos.push("--hostpubsha256", p.impressaoDigitalHost);
    }
    if (p.chavePrivada) {
      argumentos.push("--key", p.chavePrivada);
    }

    return await trabalho(argumentos);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}

/** A saída do curl pode citar o URL, que leva o utilizador. Fica só o essencial. */
function erroDoCurl(e: unknown, contexto: string): never {
  const codigo =
    typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "?";
  throw new ErroServidor(`${contexto} falhou (curl saiu com ${codigo}).`);
}

function criarDestinoSftp(p: ParametrosServidor): Destino {
  return {
    tipo: "servidor",

    async garantirPasta(segmentos) {
      await comNetrc(p, async (argumentos) => {
        // O `-Q mkdir` do curl não falha o comando quando a pasta já existe no
        // servidor; o caminho é criado nível a nível, como nos outros destinos.
        const percorridos: string[] = [];
        for (const segmento of segmentos) {
          percorridos.push(segmento);
          try {
            await executar(
              "curl",
              [
                ...argumentos,
                "-Q",
                `mkdir ${caminho([p.caminhoBase ?? "", ...percorridos])}`,
                `${urlSftp(p, [])}/`,
              ],
              { timeout: TEMPO_LIMITE_MS },
            );
          } catch {
            // Uma pasta já existente devolve erro; só o upload seguinte é que
            // decide se o caminho está mesmo lá.
          }
        }
      });
    },

    async enviar(segmentos, ficheiro: Ficheiro) {
      await comNetrc(p, async (argumentos) => {
        try {
          const filho = executar(
            "curl",
            [...argumentos, "--upload-file", "-", urlSftp(p, [...segmentos, ficheiro.nome])],
            { timeout: TEMPO_LIMITE_MS },
          );
          // O conteúdo entra por stdin: um ficheiro temporário em disco deixava
          // rasto de documentos de identificação na máquina.
          filho.child.stdin?.end(ficheiro.conteudo);
          await filho;
        } catch (e) {
          erroDoCurl(e, `Envio de "${ficheiro.nome}"`);
        }
      });
    },

    async verificar(): Promise<Verificacao> {
      try {
        return await comNetrc(p, async (argumentos) => {
          await executar("curl", [...argumentos, "--list-only", `${urlSftp(p, [])}/`], {
            timeout: TEMPO_LIMITE_MS,
          });
          return { ok: true, detalhe: `SFTP acessível em ${p.host}.` };
        });
      } catch (e) {
        const codigo =
          typeof e === "object" && e !== null && "code" in e
            ? String((e as { code: unknown }).code)
            : "?";
        return { ok: false, detalhe: `O curl saiu com ${codigo}.` };
      }
    },
  };
}

export function criarDestinoServidor(p: ParametrosServidor): Destino {
  return p.protocolo === "webdav" ? criarDestinoWebdav(p) : criarDestinoSftp(p);
}
