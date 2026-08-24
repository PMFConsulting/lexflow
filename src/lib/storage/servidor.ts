import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Destino, Ficheiro, ParametrosServidor, Verificacao } from "./tipos";
import { caminho } from "./tipos";

/**
 * The firm's dedicated server, over SFTP on SSH.
 *
 * It is spoken to through `curl`, which supports sftp:// when compiled with
 * libssh2. Alpine's `curl` is not, and that is why the image sits on Debian:
 * see the comment in the Dockerfile.
 *
 * It is the only destination, and that is not configurable: plain FTP, HTTP and
 * cleartext WebDAV were left out on purpose. What crosses this are
 * identification documents.
 */

const executar = promisify(execFile);

/** An upload cannot hang holding up a matter's submission. */
const TEMPO_LIMITE_MS = 60_000;

export class ErroServidor extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroServidor";
  }
}

/* -------------------------------------------------------------------- SFTP */

/** Only exported for the tests: the URL is the boundary where names break. */
export function urlSftp(p: ParametrosServidor, segmentos: string[]): string {
  const anfitriao = p.host.replace(/^sftp:\/\//i, "").replace(/\/.*$/, "");
  const porta = p.porta ? `:${p.porta}` : "";

  // Each segment goes percent-encoded. A client folder is called
  // "Maria Silva (249886344)" and the space cannot enter a URL raw: curl
  // truncates there, and the upload ended up at "/Clientes/Maria".
  const cauda = caminho([p.caminhoBase ?? "", ...segmentos])
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");

  return `sftp://${anfitriao}${porta}/${cauda}`;
}

/**
 * A path going into a curl `-Q` command.
 *
 * `-Q` is not a URL: curl splits the line into words and the path ends at the
 * first space. In quotes, the path arrives whole — and inside the quotes curl
 * recognises `\"` and `\\` as escapes. `nomeSeguro` already strips quotes from
 * a client name; this is the second line of defence, for the base path, which
 * comes from the firm's configuration and does not go through there.
 */
export function citarSftp(caminhoServidor: string): string {
  return `"${caminhoServidor.replace(/[\\"]/g, "\\$&")}"`;
}

/**
 * `curl` receives the secret in a temporary `.netrc` file with 0600
 * permissions, never in `argv`: a process's command line is readable by any
 * user of the machine, and a `ps aux` cannot reveal the password to the client
 * archive.
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

    // Host key verification. With no fingerprint configured, curl uses the
    // system's `known_hosts` — and fails against an unknown host, which is the
    // right behaviour.
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

/** curl's output can quote the URL, which carries the user. Only the essential remains. */
function erroDoCurl(e: unknown, contexto: string): never {
  const codigo =
    typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "?";
  throw new ErroServidor(`${contexto} falhou (curl saiu com ${codigo}).`);
}

export function criarDestinoServidor(p: ParametrosServidor): Destino {
  return {
    async garantirPasta(segmentos) {
      await comNetrc(p, async (argumentos) => {
        // curl's `-Q mkdir` does not fail the command when the folder already
        // exists on the server; the path is created level by level.
        const percorridos: string[] = [];
        for (const segmento of segmentos) {
          percorridos.push(segmento);
          try {
            await executar(
              "curl",
              [
                ...argumentos,
                "-Q",
                `mkdir ${citarSftp(caminho([p.caminhoBase ?? "", ...percorridos]))}`,
                `${urlSftp(p, [])}/`,
              ],
              { timeout: TEMPO_LIMITE_MS },
            );
          } catch {
            // An already-existing folder returns an error; only the next upload
            // decides whether the path is really there.
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
          // The content goes in through stdin: a temporary file on disk left a
          // trail of identification documents on the machine.
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
