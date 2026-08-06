import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import type { EnvelopeCifrado } from "./tipos";

/**
 * Cifra dos parâmetros de ligação ao armazenamento.
 *
 * AES-256-GCM: cifra e autentica ao mesmo tempo. Sem a etiqueta, quem tivesse
 * escrita na base de dados podia trocar bytes do criptograma e apontar o
 * upload para outro sítio sem que nada desse por isso — o modo autenticado
 * transforma isso num erro de decifra.
 *
 * Nota deliberada: este módulo lê `process.env` em vez de `env()`. O `env()`
 * importa `server-only`, e a chave é precisa em dois sítios que não são o
 * servidor Next — o script de configuração e os testes.
 */

const ALGORITMO = "aes-256-gcm";
/** 96 bits é o nonce recomendado para GCM. */
const BYTES_IV = 12;
const BYTES_CHAVE = 32;

export class ErroCifra extends Error {}

/**
 * A chave, a partir de 64 hexadecimais em `ARMAZENAMENTO_CHAVE`.
 *
 * Devolve null quando não está definida: sem chave, a sincronização
 * desliga-se em silêncio em vez de rebentar a submissão de um processo.
 */
export function chaveDeAmbiente(): Buffer | null {
  const bruta = process.env.ARMAZENAMENTO_CHAVE?.trim();
  if (!bruta) return null;
  return lerChave(bruta);
}

export function lerChave(bruta: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(bruta)) {
    throw new ErroCifra(
      "ARMAZENAMENTO_CHAVE tem de ser 64 hexadecimais (32 bytes). " +
        'Gera com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  const chave = Buffer.from(bruta, "hex");
  if (chave.length !== BYTES_CHAVE) throw new ErroCifra("Chave com tamanho inválido.");
  return chave;
}

export function cifrar(valor: unknown, chave: Buffer): EnvelopeCifrado {
  const iv = randomBytes(BYTES_IV);
  const cifrador = createCipheriv(ALGORITMO, chave, iv);
  const dados = Buffer.concat([
    cifrador.update(JSON.stringify(valor), "utf8"),
    cifrador.final(),
  ]);

  return {
    v: 1,
    alg: ALGORITMO,
    iv: iv.toString("base64"),
    tag: cifrador.getAuthTag().toString("base64"),
    dados: dados.toString("base64"),
  };
}

export function decifrar<T = unknown>(envelope: EnvelopeCifrado, chave: Buffer): T {
  if (envelope?.v !== 1 || envelope.alg !== ALGORITMO) {
    throw new ErroCifra("Envelope de cifra desconhecido.");
  }

  try {
    const decifrador = createDecipheriv(
      ALGORITMO,
      chave,
      Buffer.from(envelope.iv, "base64"),
    );
    decifrador.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const claro = Buffer.concat([
      decifrador.update(Buffer.from(envelope.dados, "base64")),
      decifrador.final(),
    ]);
    return JSON.parse(claro.toString("utf8")) as T;
  } catch {
    // A causa real não sobe: distinguir "chave errada" de "envelope adulterado"
    // é informação de graça para quem esteja a tentar.
    throw new ErroCifra(
      "Não foi possível decifrar os parâmetros de armazenamento. " +
        "A ARMAZENAMENTO_CHAVE mudou ou a linha foi alterada.",
    );
  }
}

/**
 * Comparação de segredos em tempo constante. Usada onde se compara um valor
 * vindo de fora com um guardado — comparar com `===` deixa escapar o tamanho
 * do prefixo comum pelo tempo de resposta.
 */
export function iguais(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
