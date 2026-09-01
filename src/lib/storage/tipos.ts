import { z } from "zod";

/**
 * The contract the destination fulfils, and the names that arrive there.
 *
 * Nothing here touches the database or the network — that is what allows
 * testing the name cleanup, which is the part with the most edges: the client's
 * name comes from a public form and turns into a file path.
 */

/**
 * The parameters' encryption envelope, as it sits in the JSONB column.
 *
 * It lives here and not in the schema because the schema imports Drizzle and
 * this type is needed where Drizzle does not reach — in the configuration
 * script and in the tests.
 */
export type EnvelopeCifrado = {
  v: 1;
  alg: "aes-256-gcm";
  /** Nonce, base64. */
  iv: string;
  /** GCM tag, base64 — it is what detects tampering. */
  tag: string;
  /** Ciphertext, base64. */
  dados: string;
};

/* --------------------------------------------------------------- parameters */

/**
 * The firm's dedicated server, over SFTP on SSH. A single protocol, and on
 * purpose: plain FTP, HTTP and cleartext WebDAV do not belong in a system that
 * carries identification documents, and a third-party service like OneDrive
 * takes away the firm's control over where the case file lives.
 *
 * `protocolo` stays in the schema, fixed at "sftp", so that configuration
 * already stored and encrypted keeps being read — and so that an old
 * configuration on another protocol fails at the boundary instead of being
 * treated as SFTP.
 */
export const parametrosServidor = z.object({
  protocolo: z.literal("sftp").default("sftp"),
  host: z.string().min(1, "host em falta"),
  porta: z.number().int().positive().max(65535).optional(),
  utilizador: z.string().min(1, "utilizador em falta"),
  /** The user's password, or the private key's passphrase. */
  segredo: z.string().min(1).optional(),
  /** Path to a private key on the application's server. */
  chavePrivada: z.string().min(1).optional(),
  /**
   * SHA-256 of the host's public key, in the form `curl --hostpubsha256` wants
   * it. Without this, the first SFTP against an unknown host accepts whoever
   * answers — which is exactly the hole SSH exists to plug.
   */
  impressaoDigitalHost: z.string().min(1).optional(),
  /** Archive prefix, when the account does not land on the root that matters. */
  caminhoBase: z.string().optional(),
});

export type ParametrosServidor = z.infer<typeof parametrosServidor>;

/**
 * The firm's S3 bucket — one per society, dedicated, never shared. `bucket`
 * travels inside this envelope alongside the credentials (and is also kept in
 * the plain `bucket_s3` column, which is what decides whether a firm's
 * destination is S3 or SFTP: see `armazenamentoSociedade`). Keeping both is
 * deliberate — the column is what routing reads without decrypting anything,
 * this is what the driver receives once it does.
 */
export const parametrosS3 = z.object({
  protocolo: z.literal("s3").default("s3"),
  regiao: z.string().min(1, "região em falta"),
  bucket: z.string().min(1, "bucket em falta"),
  accessKeyId: z.string().min(1, "access key em falta"),
  secretAccessKey: z.string().min(1, "secret key em falta"),
});

export type ParametrosS3 = z.infer<typeof parametrosS3>;

export type Parametros = ParametrosServidor | ParametrosS3;

export function validarParametros(valor: unknown): Parametros {
  const protocolo =
    valor && typeof valor === "object" && "protocolo" in valor
      ? (valor as { protocolo?: unknown }).protocolo
      : undefined;
  return protocolo === "s3" ? parametrosS3.parse(valor) : parametrosServidor.parse(valor);
}

/* ------------------------------------------------------------- destinations */

export type Ficheiro = {
  nome: string;
  mime: string;
  conteudo: Buffer;
};

export type Verificacao = { ok: boolean; detalhe: string };

export interface Destino {
  /** Creates the folder and any missing intermediate ones. Idempotent. */
  garantirPasta(segmentos: string[]): Promise<void>;
  /** Writes (or replaces) a file inside the folder. */
  enviar(segmentos: string[], ficheiro: Ficheiro): Promise<void>;
  /** Touches the destination without writing anything — feeds the back-office status. */
  verificar(): Promise<Verificacao>;
  /**
   * Reads an object back, by the exact key `enviar`/`chaveObjeto` produced.
   * Optional: SFTP has no reader today — a document uploaded to a firm still
   * on SFTP keeps living in `documento.dados` (see `carregarDocumento`), and
   * this method never gets called for it. Only S3 implements it.
   */
  ler?(chave: string): Promise<Buffer>;
}

/** Common failure for any destination adapter (SFTP, S3, …) — sync catches this, never the transport's own error type. */
export class ErroServidor extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroServidor";
  }
}

/* ------------------------------------------------------------------- names */

/** Reserved on Windows; a folder with these names is impossible to create. */
const RESERVADOS_WINDOWS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Control characters, including DEL. */
const CONTROLO = new RegExp("[\u0000-\u001f\u007f]", "g");

/**
 * What Windows refuses in a name. The archive lives on a Linux server, but the
 * folders are opened in the Explorer of whoever works in the office: a name
 * Windows cannot copy is a case file nobody opens.
 */
const PROIBIDOS = /[\\/:*?"<>|#%~]/g;

/**
 * A safe folder or file name, built from text written by whoever fills in the
 * form.
 *
 * Strips path separators and collapses runs of dots (a name like `../../etc`
 * cannot escape the destination folder), strips the characters Windows refuses,
 * strips control characters, and caps the length. Returns `alternativa` when
 * nothing useful remains.
 */
export function nomeSeguro(bruto: string | null | undefined, alternativa = "Sem Nome"): string {
  const base = (bruto ?? "")
    .normalize("NFC")
    .replace(CONTROLO, "")
    .replace(PROIBIDOS, " ")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ");

  // A name starting with a dot is an attempt at a hidden file (`.ssh`,
  // `.oculto.`) and not a client name: in that case the dots are stripped from
  // both ends. In a normal name, the trailing dot is an abbreviation — "Lda."
  // and "Cª, S.A." are real Portuguese company denominations, and cutting them
  // gave folders with the wrong name.
  const oculto = /^\s*\./.test(base);

  let limpo = base
    // A leading dot or space gives folders that misbehave almost everywhere.
    .replace(/^[.\s]+/, "")
    .replace(/\s+$/, "")
    .slice(0, 120)
    .trim();

  if (oculto) limpo = limpo.replace(/[.\s]+$/, "").trim();

  if (!limpo || RESERVADOS_WINDOWS.test(limpo)) return alternativa;
  return limpo;
}

/**
 * The same, for file names: preserves the extension and guarantees it does not
 * disappear when the name is long.
 */
export function nomeSeguroDeFicheiro(bruto: string, alternativa = "anexo"): string {
  const ponto = bruto.lastIndexOf(".");
  const temExtensao = ponto > 0 && bruto.length - ponto <= 12;

  const base = nomeSeguro(temExtensao ? bruto.slice(0, ponto) : bruto, alternativa).slice(0, 80);
  const extensao = temExtensao
    ? "." + bruto.slice(ponto + 1).replace(/[^A-Za-z0-9]/g, "").slice(0, 10)
    : "";

  return (base || alternativa) + extensao;
}

/** Joins already-cleaned segments into a POSIX path, without doubled slashes. */
export function caminho(segmentos: string[]): string {
  return (
    "/" +
    segmentos
      .flatMap((s) => s.split("/"))
      .map((s) => s.trim())
      .filter(Boolean)
      .join("/")
  );
}

/**
 * The same joining as `caminho`, but without the leading slash — the shape an
 * S3 object key wants, and what `documento.chaveStorage` stores from now on.
 * Shared between the S3 driver (which builds the key it signs) and whoever
 * writes `chaveStorage` in the database, so the two can never name the same
 * file two different ways.
 */
export function chaveObjeto(segmentos: string[]): string {
  return segmentos
    .flatMap((s) => s.split("/"))
    .map((s) => s.trim())
    .filter(Boolean)
    .join("/");
}
