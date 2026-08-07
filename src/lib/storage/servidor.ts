import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Destino, Ficheiro, ParametrosServidor, Verificacao } from "./tipos";
import { caminho } from "./tipos";

/**
 * O servidor dedicado da sociedade, por SFTP sobre SSH.
 *
 * Fala-se com ele através do `curl`, que suporta sftp:// quando vem compilado
 * com libssh2. O `curl` do Alpine não vem, e é por isso que a imagem assenta
 * em Debian: ver o comentário no Dockerfile.
 *
 * É o único destino, e isso não é configurável: FTP simples, HTTP e WebDAV em
 * claro ficaram de fora de propósito. O que atravessa isto são documentos de
 * identificação.
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

/* -------------------------------------------------------------------- SFTP */

/** Só exportado para os testes: o URL é a fronteira onde os nomes se partem. */
export function urlSftp(p: ParametrosServidor, segmentos: string[]): string {
  const anfitriao = p.host.replace(/^sftp:\/\//i, "").replace(/\/.*$/, "");
  const porta = p.porta ? `:${p.porta}` : "";

  // Cada segmento vai percent-encoded. Uma pasta de cliente chama-se
  // "Maria Silva (249886344)" e o espaço não pode entrar num URL em cru: o
  // curl trunca aí, e o upload ia parar a "/Clientes/Maria".
  const cauda = caminho([p.caminhoBase ?? "", ...segmentos])
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");

  return `sftp://${anfitriao}${porta}/${cauda}`;
}

/**
 * Um caminho para dentro de um comando `-Q` do curl.
 *
 * O `-Q` não é um URL: o curl parte a linha em palavras e o caminho acaba no
 * primeiro espaço. Entre aspas, o caminho chega inteiro — e dentro das aspas o
 * curl reconhece `\"` e `\\` como escapes. O `nomeSeguro` já tira as aspas de
 * um nome de cliente; isto é a segunda linha, para o caminho base, que vem da
 * configuração da sociedade e não passa por lá.
 */
export function citarSftp(caminhoServidor: string): string {
  return `"${caminhoServidor.replace(/[\\"]/g, "\\$&")}"`;
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

export function criarDestinoServidor(p: ParametrosServidor): Destino {
  return {
    async garantirPasta(segmentos) {
      await comNetrc(p, async (argumentos) => {
        // O `-Q mkdir` do curl não falha o comando quando a pasta já existe no
        // servidor; o caminho é criado nível a nível.
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
