import { z } from "zod";

/**
 * O contrato que todos os destinos cumprem, e os nomes que lá chegam.
 *
 * Nada aqui toca na base de dados nem na rede — é o que permite testar a
 * limpeza de nomes, que é a parte com mais arestas: o nome do cliente vem de
 * um formulário público e transforma-se num caminho de ficheiro.
 */

export type TipoArmazenamento = "onedrive" | "servidor";

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
 * OneDrive / Microsoft Graph. O `tokenRefresh` obtém-se uma vez, no consentimento
 * inicial da sociedade, e é trocado por um access token a cada sincronização.
 */
export const parametrosOneDrive = z.object({
  tenantId: z.string().min(1, "tenant_id em falta"),
  clientId: z.string().min(1, "client_id em falta"),
  clientSecret: z.string().min(1).optional(),
  tokenRefresh: z.string().min(1, "token_refresh em falta"),
  /**
   * Drive de destino. Sem valor, usa o OneDrive do utilizador que deu
   * consentimento; com um id de drive, aponta para a biblioteca de documentos
   * de um SharePoint.
   */
  driveId: z.string().min(1).optional(),
});

export type ParametrosOneDrive = z.infer<typeof parametrosOneDrive>;

/**
 * Servidor à escolha da sociedade. Dois protocolos, ambos cifrados em trânsito:
 * WebDAV sobre HTTPS ou SFTP sobre SSH. Não há terceira opção de propósito —
 * FTP simples e HTTP não entram num sistema que transporta documentos de
 * identificação.
 */
export const parametrosServidor = z.object({
  protocolo: z.enum(["webdav", "sftp"]),
  host: z.string().min(1, "host em falta"),
  porta: z.number().int().positive().max(65535).optional(),
  utilizador: z.string().min(1, "utilizador em falta"),
  /** Palavra-passe (webdav e sftp) ou frase-passe da chave (sftp). */
  segredo: z.string().min(1).optional(),
  /** Caminho de uma chave privada no servidor da aplicação — só sftp. */
  chavePrivada: z.string().min(1).optional(),
  /**
   * SHA-256 da chave pública do host, como o `curl --hostpubsha256` a quer.
   * Sem isto, o primeiro SFTP contra um host desconhecido aceita quem
   * responder — que é exatamente o buraco que o SSH existe para tapar.
   */
  impressaoDigitalHost: z.string().min(1).optional(),
  /** Prefixo do WebDAV, quando o servidor o expõe fora da raiz. */
  caminhoBase: z.string().optional(),
});

export type ParametrosServidor = z.infer<typeof parametrosServidor>;

export type Parametros = ParametrosOneDrive | ParametrosServidor;

export function validarParametros(tipo: TipoArmazenamento, valor: unknown): Parametros {
  return tipo === "onedrive"
    ? parametrosOneDrive.parse(valor)
    : parametrosServidor.parse(valor);
}

/* ----------------------------------------------------------------- destinos */

export type Ficheiro = {
  nome: string;
  mime: string;
  conteudo: Buffer;
};

export type Verificacao = { ok: boolean; detalhe: string };

export interface Destino {
  readonly tipo: TipoArmazenamento;
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

/** O que o Windows, o OneDrive e o SharePoint recusam num nome. */
const PROIBIDOS = /[\\/:*?"<>|#%~]/g;

/**
 * Um nome de pasta ou de ficheiro seguro, a partir de texto escrito por quem
 * preenche o formulário.
 *
 * Tira separadores de caminho e reduz sequências de pontos (um nome como
 * `../../etc` não pode sair da pasta de destino), tira os caracteres que o
 * Windows e o SharePoint recusam, tira os de controlo, e corta o comprimento.
 * Devolve `alternativa` quando não sobra nada de útil.
 */
export function nomeSeguro(bruto: string | null | undefined, alternativa = "Sem Nome"): string {
  const limpo = (bruto ?? "")
    .normalize("NFC")
    .replace(CONTROLO, "")
    .replace(PROIBIDOS, " ")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    // O SharePoint recusa nomes com ponto ou espaço no início e no fim.
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 120)
    .trim();

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
