import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { armazenamentoSociedade } from "@/db/schema/armazenamento";
import { chaveDeAmbiente, decifrar } from "./cifra";
import { criarDestinoS3 } from "./s3";
import { criarDestinoServidor } from "./servidor";
import { parametrosS3, parametrosServidor, type Destino } from "./tipos";

export type ConfiguracaoArmazenamento = typeof armazenamentoSociedade.$inferSelect;

/**
 * Connection status, for the back-office. Four possible answers, and the
 * difference between them is what the configuration screen needs to say: the
 * row is missing, the credentials are missing, the key is missing, or
 * everything is ready.
 */
export type EstadoLigacao =
  | "sem_configuracao"
  | "por_configurar"
  | "sem_chave"
  | "desativado"
  | "ligado";

export async function configuracaoDaOrganizacao(
  organizacaoId: string,
): Promise<ConfiguracaoArmazenamento | null> {
  const [linha] = await db()
    .select()
    .from(armazenamentoSociedade)
    .where(eq(armazenamentoSociedade.organizacaoId, organizacaoId))
    .limit(1);

  return linha ?? null;
}

export function estadoDaConfiguracao(
  config: ConfiguracaoArmazenamento | null,
): EstadoLigacao {
  if (!config) return "sem_configuracao";
  if (!config.parametros) return "por_configurar";
  if (!chaveDeAmbiente()) return "sem_chave";
  if (!config.ativo) return "desativado";
  return "ligado";
}

/**
 * A firm's destination, ready to use — or null.
 *
 * Returning null instead of throwing is deliberate: the absence of
 * configuration is the normal state of a freshly installed POC, and it cannot
 * look like a fault to whoever submits a matter.
 */
export async function destinoDaOrganizacao(organizacaoId: string): Promise<{
  destino: Destino;
  config: ConfiguracaoArmazenamento;
} | null> {
  const config = await configuracaoDaOrganizacao(organizacaoId);
  if (!config || !config.ativo || !config.parametros) return null;

  const chave = chaveDeAmbiente();
  if (!chave) {
    console.warn(
      "[storage] configuration is stored but ARMAZENAMENTO_CHAVE is missing; sync skipped.",
    );
    return null;
  }

  const claros = decifrar(config.parametros, chave);
  return { destino: criarDestino(claros, config.bucketS3), config };
}

/**
 * The factory. The parameters are revalidated here: they came from outside
 * the code. `bucketS3` — the plain column, not anything inside the encrypted
 * envelope — is what decides the destination: filled in, S3; null, SFTP as
 * before it existed. That is the entire "swap for S3" the day it happens.
 */
export function criarDestino(parametros: unknown, bucketS3?: string | null): Destino {
  if (bucketS3) {
    return criarDestinoS3(parametrosS3.parse(parametros));
  }
  return criarDestinoServidor(parametrosServidor.parse(parametros));
}

export type { Destino } from "./tipos";
