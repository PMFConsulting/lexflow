import { z } from "zod";

/**
 * O contrato que o destino cumpre, e os nomes que lá chegam.
 *
 * Nada aqui toca na base de dados nem na rede — é o que permite testar a
 * limpeza de nomes, que é a parte com mais arestas: o nome do cliente vem de
 * um formulário público e transforma-se num caminho de ficheiro.
 */

/**
 * Envelope de cifra dos parâmetros, tal como fica na coluna JSONB.
 *
 * Vive aqui e não no schema porque o schema importa Drizzle e este tipo é
 * preciso onde ele não chega — no script de configuração e nos testes.
 */
export type EnvelopeCifrado = {
  v: 1;
  alg: "aes-256-gcm";
  /** Nonce, base64. */
  iv: string;
  /** Etiqueta GCM, base64 — é ela que deteta adulteração. */
  tag: string;
  /** Criptograma, base64. */
  dados: string;
};

/* --------------------------------------------------------------- parâmetros */

/**
 * Servidor dedicado da sociedade, por SFTP sobre SSH. Um só protocolo, e de
 * propósito: FTP simples, HTTP e WebDAV em claro não entram num sistema que
 * transporta documentos de identificação, e um serviço de terceiros como o
 * OneDrive tira à sociedade o controlo de onde o dossier fica.
 *
 * O `protocolo` fica no schema, fixo em "sftp", para que a configuração já
 * gravada e cifrada continue a ser lida — e para que uma configuração antiga
 * noutro protocolo falhe à entrada em vez de ser tratada como SFTP.
 */
export const parametrosServidor = z.object({
  protocolo: z.literal("sftp").default("sftp"),
  host: z.string().min(1, "host em falta"),
  porta: z.number().int().positive().max(65535).optional(),
  utilizador: z.string().min(1, "utilizador em falta"),
  /** Palavra-passe do utilizador, ou frase-passe da chave privada. */
  segredo: z.string().min(1).optional(),
  /** Caminho de uma chave privada no servidor da aplicação. */
  chavePrivada: z.string().min(1).optional(),
  /**
   * SHA-256 da chave pública do host, como o `curl --hostpubsha256` a quer.
   * Sem isto, o primeiro SFTP contra um host desconhecido aceita quem
   * responder — que é exatamente o buraco que o SSH existe para tapar.
   */
  impressaoDigitalHost: z.string().min(1).optional(),
  /** Prefixo do arquivo, quando a conta não aterra na raiz que interessa. */
  caminhoBase: z.string().optional(),
});

export type ParametrosServidor = z.infer<typeof parametrosServidor>;

export type Parametros = ParametrosServidor;

export function validarParametros(valor: unknown): Parametros {
  return parametrosServidor.parse(valor);
}

/* ----------------------------------------------------------------- destinos */

export type Ficheiro = {
  nome: string;
  mime: string;
  conteudo: Buffer;
};

export type Verificacao = { ok: boolean; detalhe: string };

export interface Destino {
  /** Cria a pasta e as intermédias que faltarem. Idempotente. */
  garantirPasta(segmentos: string[]): Promise<void>;
  /** Escreve (ou substitui) um ficheiro dentro da pasta. */
  enviar(segmentos: string[], ficheiro: Ficheiro): Promise<void>;
  /** Toca no destino sem escrever nada — alimenta o estado do back-office. */
  verificar(): Promise<Verificacao>;
}

/* ------------------------------------------------------------------- nomes */

/** Reservados no Windows; uma pasta com estes nomes é impossível de criar. */
const RESERVADOS_WINDOWS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Caracteres de controlo, incluindo o DEL. */
const CONTROLO = new RegExp("[\u0000-\u001f\u007f]", "g");

/**
 * O que o Windows recusa num nome. O arquivo vive num servidor Linux, mas as
 * pastas são abertas no Explorador de quem trabalha no escritório: um nome que
 * o Windows não consegue copiar é um dossier que ninguém abre.
 */
const PROIBIDOS = /[\\/:*?"<>|#%~]/g;

/**
 * Um nome de pasta ou de ficheiro seguro, a partir de texto escrito por quem
 * preenche o formulário.
 *
 * Tira separadores de caminho e reduz sequências de pontos (um nome como
 * `../../etc` não pode sair da pasta de destino), tira os caracteres que o
 * Windows recusa, tira os de controlo, e corta o comprimento. Devolve
 * `alternativa` quando não sobra nada de útil.
 */
export function nomeSeguro(bruto: string | null | undefined, alternativa = "Sem Nome"): string {
  const base = (bruto ?? "")
    .normalize("NFC")
    .replace(CONTROLO, "")
    .replace(PROIBIDOS, " ")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ");

  // Um nome que começa por ponto é uma tentativa de ficheiro oculto (`.ssh`,
  // `.oculto.`) e não um nome de cliente: nesse caso tiram-se os pontos das
  // duas pontas. Num nome normal, o ponto final é abreviatura — "Lda." e
  // "Cª, S.A." são denominações reais de empresas portuguesas, e cortá-las
  // dava pastas com o nome errado.
  const oculto = /^\s*\./.test(base);

  let limpo = base
    // Ponto ou espaço no início dá pastas que se comportam mal em quase todo o lado.
    .replace(/^[.\s]+/, "")
    .replace(/\s+$/, "")
    .slice(0, 120)
    .trim();

  if (oculto) limpo = limpo.replace(/[.\s]+$/, "").trim();

  if (!limpo || RESERVADOS_WINDOWS.test(limpo)) return alternativa;
  return limpo;
}

/**
 * O mesmo, para nomes de ficheiro: preserva a extensão e garante que ela não
 * desaparece quando o nome é longo.
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

/** Junta segmentos já limpos num caminho POSIX, sem barras a dobrar. */
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
