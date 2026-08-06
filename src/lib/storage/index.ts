import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { armazenamentoSociedade } from "@/db/schema/armazenamento";
import { chaveDeAmbiente, decifrar } from "./cifra";
import { criarDestinoOneDrive } from "./onedrive";
import { criarDestinoServidor } from "./servidor";
import {
  parametrosOneDrive,
  parametrosServidor,
  type Destino,
  type TipoArmazenamento,
} from "./tipos";

export type ConfiguracaoArmazenamento = typeof armazenamentoSociedade.$inferSelect;

/**
 * Estado da ligação, para o back-office. Quatro respostas possíveis, e a
 * diferença entre elas é o que o ecrã de configuração precisa de dizer:
 * falta a linha, faltam as credenciais, falta a chave, ou está tudo pronto.
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
 * O destino de uma sociedade, pronto a usar — ou null.
 *
 * Devolver null em vez de lançar é deliberado: a ausência de configuração é o
 * estado normal de uma POC acabada de instalar, e não pode parecer uma avaria
 * a quem submete um processo.
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
      "[armazenamento] há configuração gravada mas falta ARMAZENAMENTO_CHAVE; sincronização ignorada.",
    );
    return null;
  }

  const claros = decifrar(config.parametros, chave);
  return { destino: criarDestino(config.tipo, claros), config };
}

/** A fábrica por tipo. Os parâmetros revalidam-se aqui: vieram de fora do código. */
export function criarDestino(tipo: TipoArmazenamento, parametros: unknown): Destino {
  return tipo === "onedrive"
    ? criarDestinoOneDrive(parametrosOneDrive.parse(parametros))
    : criarDestinoServidor(parametrosServidor.parse(parametros));
}

export type { Destino, TipoArmazenamento } from "./tipos";
