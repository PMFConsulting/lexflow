import { createHash, createHmac } from "node:crypto";
import type { Destino, Ficheiro, ParametrosS3, Verificacao } from "./tipos";
import { ErroServidor } from "./tipos";

/**
 * The firm's dedicated S3 bucket, one per society, signed directly with
 * SigV4 over `fetch` — not the official SDK: the four request shapes this
 * driver ever needs (PUT object, HEAD bucket) do not justify the dependency's
 * weight in `next build`'s bundle, and `node:crypto` already does the hashing
 * `servidor.ts` needs for its own transport.
 *
 * Objects are written under server-side encryption (SSE-S3, AES-256) on every
 * upload — the same class of document that goes over SFTP encrypted at rest
 * here too, not by bucket default configuration that a later change could
 * silently drop.
 */

const SERVICO = "s3";
const ALGORITMO = "AWS4-HMAC-SHA256";
/** An upload cannot hang holding up a matter's submission — same budget as `servidor.ts`. */
const TEMPO_LIMITE_MS = 60_000;

function sha256Hex(dados: Buffer | string): string {
  return createHash("sha256").update(dados).digest("hex");
}

function hmac(chave: Buffer | string, dados: string): Buffer {
  return createHmac("sha256", chave).update(dados, "utf8").digest();
}

/** `AWS4-HMAC-SHA256`'s two date formats, both derived from the same instant. */
function dataAmz(agora: Date): { completa: string; curta: string } {
  const completa = agora.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { completa, curta: completa.slice(0, 8) };
}

function chaveDeAssinatura(p: ParametrosS3, dataCurta: string): Buffer {
  const kData = hmac(`AWS4${p.secretAccessKey}`, dataCurta);
  const kRegiao = hmac(kData, p.regiao);
  const kServico = hmac(kRegiao, SERVICO);
  return hmac(kServico, "aws4_request");
}

function anfitriao(p: ParametrosS3): string {
  return `${p.bucket}.s3.${p.regiao}.amazonaws.com`;
}

/**
 * Object key from folder segments — no leading slash, which is an S3
 * convention and not a filesystem path. The segments arrive already sanitised
 * by `nomeSeguro`; this only joins them.
 */
function chaveDoObjeto(segmentos: string[]): string {
  return segmentos
    .flatMap((s) => s.split("/"))
    .map((s) => s.trim())
    .filter(Boolean)
    .join("/");
}

function caminhoCanonico(chaveObjeto: string): string {
  const codificado = chaveObjeto
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return `/${codificado}`;
}

/**
 * `query` is the canonical query string for an S3 subresource (e.g.
 * `"versioning="`) — empty for every plain object PUT/HEAD, which is why the
 * two existing call sites never had to know it exists.
 */
function assinar(
  p: ParametrosS3,
  metodo: string,
  chaveObjeto: string,
  corpo: Buffer,
  extra: Record<string, string> = {},
  query = "",
): { url: string; headers: Record<string, string> } {
  const agora = new Date();
  const { completa, curta } = dataAmz(agora);
  const host = anfitriao(p);
  const hashCorpo = sha256Hex(corpo);

  const cabecalhos: Record<string, string> = {
    host,
    "x-amz-content-sha256": hashCorpo,
    "x-amz-date": completa,
    ...extra,
  };

  const nomes = Object.keys(cabecalhos).sort();
  const cabecalhosCanonicos = nomes.map((n) => `${n}:${cabecalhos[n].trim()}\n`).join("");
  const listaCabecalhos = nomes.join(";");
  const caminho = caminhoCanonico(chaveObjeto);

  const pedidoCanonico = [metodo, caminho, query, cabecalhosCanonicos, listaCabecalhos, hashCorpo].join(
    "\n",
  );

  const ambito = `${curta}/${p.regiao}/${SERVICO}/aws4_request`;
  const paraAssinar = [ALGORITMO, completa, ambito, sha256Hex(pedidoCanonico)].join("\n");
  const assinatura = hmac(chaveDeAssinatura(p, curta), paraAssinar).toString("hex");

  const autorizacao =
    `${ALGORITMO} Credential=${p.accessKeyId}/${ambito}, ` +
    `SignedHeaders=${listaCabecalhos}, Signature=${assinatura}`;

  return {
    url: `https://${host}${caminho}${query ? `?${query}` : ""}`,
    headers: { ...cabecalhos, Authorization: autorizacao },
  };
}

function mensagemDoErro(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Exported for `criar-bucket.ts`: bucket-level administration (create the
 * bucket, block public access, turn on encryption and versioning) signs with
 * the exact same SigV4 as an object PUT, over the bucket's root path plus a
 * subresource in the query string — reusing this is what keeps that logic in
 * one place instead of growing a second signer.
 */
export async function pedido(
  p: ParametrosS3,
  metodo: string,
  chaveObjeto: string,
  corpo: Buffer,
  extra?: Record<string, string>,
  query?: string,
): Promise<Response> {
  const { url, headers } = assinar(p, metodo, chaveObjeto, corpo, extra, query);
  try {
    return await fetch(url, {
      method: metodo,
      headers,
      // `Buffer` is a `Uint8Array` at runtime; the DOM `BodyInit` type in this
      // TS config just does not know that.
      body: metodo === "PUT" ? (corpo as unknown as BodyInit) : undefined,
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
  } catch (e) {
    throw new ErroServidor(`Pedido a S3 falhou (${mensagemDoErro(e)}).`);
  }
}

export function criarDestinoS3(p: ParametrosS3): Destino {
  return {
    async garantirPasta() {
      // S3 has no folders: the key hierarchy is virtual, and a PUT that
      // includes the prefix creates every "level" implicitly. Nothing to do.
    },

    async enviar(segmentos, ficheiro: Ficheiro) {
      const chaveObjeto = chaveDoObjeto([...segmentos, ficheiro.nome]);
      const resposta = await pedido(p, "PUT", chaveObjeto, ficheiro.conteudo, {
        "content-type": ficheiro.mime,
        "x-amz-server-side-encryption": "AES256",
      });

      if (!resposta.ok) {
        throw new ErroServidor(
          `Envio de "${ficheiro.nome}" falhou (S3 respondeu ${resposta.status}).`,
        );
      }
    },

    async verificar(): Promise<Verificacao> {
      try {
        const resposta = await pedido(p, "HEAD", "", Buffer.alloc(0));
        if (resposta.status !== 200) {
          return {
            ok: false,
            detalhe: `S3 respondeu ${resposta.status} para o bucket ${p.bucket}.`,
          };
        }
        return { ok: true, detalhe: `S3 acessível em ${p.bucket} (${p.regiao}).` };
      } catch (e) {
        return { ok: false, detalhe: mensagemDoErro(e) };
      }
    },
  };
}
