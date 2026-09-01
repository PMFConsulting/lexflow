import { createHash } from "node:crypto";
import { pedido } from "./s3";
import { ErroServidor, parametrosS3, type ParametrosS3 } from "./tipos";

/**
 * The bucket that is born with a society (owner's instruction, verbatim:
 * *"that process cannot be a manual process ... Please make it be automatic"*).
 * `criarSociedade` calls this once, right after the `organizacao` row exists —
 * see D65 for why the destination is one bucket per society, never shared, and
 * why the driver signs by hand instead of bringing `@aws-sdk/client-s3` in.
 *
 * Every request here reuses `pedido` from `s3.ts`: bucket administration is
 * the same SigV4 signer as an object PUT, just aimed at the bucket's root
 * path with a subresource in the query string, and a second signer would only
 * be a second place for the two to drift apart.
 */

const PREFIXO = "lexflow-";
/** S3's own limit, not a made-up one. */
const MAX_NOME = 63;

export type CredenciaisS3 = Pick<ParametrosS3, "regiao" | "accessKeyId" | "secretAccessKey">;

function semTraçosNasPontas(v: string): string {
  return v.replace(/^-+/, "").replace(/-+$/, "");
}

/**
 * A society's name, turned into what a bucket name can hold: lowercase,
 * `a-z0-9-`, no accents. "Andrade & Costa, Lda." becomes "andrade-costa" —
 * the same shape as the five buckets already created by hand (D65).
 */
export function normalizarSlug(bruto: string): string {
  const semAcentos = bruto.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const normalizado = semTraçosNasPontas(
    semAcentos
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-"),
  );
  return normalizado || "sociedade";
}

/** `lexflow-<slug>`, capped at 63 characters (S3's limit, not a chosen one). */
export function nomeBaseDoBucket(slug: string): string {
  const nome = `${PREFIXO}${normalizarSlug(slug)}`.slice(0, MAX_NOME);
  return semTraçosNasPontas(nome);
}

/**
 * The retry name on a global-namespace collision: a bucket name is unique
 * across every AWS account there is, not just within ours, so a second
 * society landing on the same normalised name is a real possibility and not
 * an edge case to shrug off. The suffix is deterministic — the same society
 * retried twice lands on the same name instead of leaking an orphaned bucket
 * every attempt.
 */
export function nomeComSufixo(nomeBase: string, organizacaoId: string): string {
  const sufixo = organizacaoId.replace(/-/g, "").slice(0, 8);
  const base = semTraçosNasPontas(nomeBase.slice(0, MAX_NOME - sufixo.length - 1));
  return `${base}-${sufixo}`;
}

function xml(corpo: string): Buffer {
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>${corpo}`, "utf8");
}

async function criarBucketAws(p: ParametrosS3): Promise<Response> {
  // No `LocationConstraint` at all is how you ask S3 for `us-east-1` — sending
  // one there is refused. Every society here lives in the same configured
  // region (D65), so in practice this branch always takes the XML body.
  const corpo =
    p.regiao === "us-east-1"
      ? Buffer.alloc(0)
      : xml(
          `<CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
            `<LocationConstraint>${p.regiao}</LocationConstraint></CreateBucketConfiguration>`,
        );
  return pedido(p, "PUT", "", corpo);
}

/**
 * A subresource write (`?encryption`, `?versioning`, `?publicAccessBlock`).
 * `Content-MD5` is not optional here the way it is for a plain object PUT —
 * these are the older, XML-config S3 APIs, and several of them refuse the
 * request without it.
 */
async function configurarSubrecurso(
  p: ParametrosS3,
  subrecurso: string,
  corpo: Buffer,
  descricao: string,
): Promise<void> {
  const resposta = await pedido(
    p,
    "PUT",
    "",
    corpo,
    {
      "content-type": "application/xml",
      "content-md5": createHash("md5").update(corpo).digest("base64"),
    },
    `${subrecurso}=`,
  );

  if (!resposta.ok) {
    throw new ErroServidor(
      `Configuração de ${descricao} do bucket "${p.bucket}" falhou (S3 respondeu ${resposta.status}).`,
    );
  }
}

const CORPO_ACESSO_PUBLICO = xml(
  `<PublicAccessBlockConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
    `<BlockPublicAcls>true</BlockPublicAcls><IgnorePublicAcls>true</IgnorePublicAcls>` +
    `<BlockPublicPolicy>true</BlockPublicPolicy><RestrictPublicBuckets>true</RestrictPublicBuckets>` +
    `</PublicAccessBlockConfiguration>`,
);

const CORPO_ENCRIPTACAO = xml(
  `<ServerSideEncryptionConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Rule>` +
    `<ApplyServerSideEncryptionByDefault><SSEAlgorithm>AES256</SSEAlgorithm></ApplyServerSideEncryptionByDefault>` +
    `</Rule></ServerSideEncryptionConfiguration>`,
);

const CORPO_VERSIONAMENTO = xml(
  `<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Status>Enabled</Status></VersioningConfiguration>`,
);

/**
 * Creates the society's dedicated bucket and returns its final name (it can
 * differ from the requested slug on a collision). Throws `ErroServidor` on
 * any failure — the caller (`criarSociedade`) decides what "the bucket did
 * not get created" means for the society; this function does not swallow it.
 */
export async function criarBucketSociedade(
  slug: string,
  organizacaoId: string,
  credenciais: CredenciaisS3,
): Promise<string> {
  const base = nomeBaseDoBucket(slug);
  const parametrosPara = (bucket: string) => parametrosS3.parse({ ...credenciais, bucket });

  let bucket = base;
  let resposta = await criarBucketAws(parametrosPara(bucket));

  if (!resposta.ok && resposta.status === 409) {
    bucket = nomeComSufixo(base, organizacaoId);
    resposta = await criarBucketAws(parametrosPara(bucket));
  }

  if (!resposta.ok) {
    throw new ErroServidor(`Criação do bucket "${bucket}" falhou (S3 respondeu ${resposta.status}).`);
  }

  const p = parametrosPara(bucket);
  await configurarSubrecurso(p, "publicAccessBlock", CORPO_ACESSO_PUBLICO, "bloqueio de acesso público");
  await configurarSubrecurso(p, "encryption", CORPO_ENCRIPTACAO, "encriptação");
  await configurarSubrecurso(p, "versioning", CORPO_VERSIONAMENTO, "versionamento");

  return bucket;
}
