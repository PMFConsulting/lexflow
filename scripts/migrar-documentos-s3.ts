/**
 * Migração dos documentos existentes — o base64 hoje em `documento.dados` —
 * para o bucket S3 da sociedade a que o processo pertence.
 *
 * PREPARADO, NÃO CORRIDO. Instrução do dono, verbatim (01/09/2026): "Do not
 * migrate already the documents please as this is a demonstration as of now
 * that into the next week we will deploy the documents to the AWS." Este
 * script existe para esse momento — ninguém o invoca a partir do código da
 * aplicação, e não corre em nenhum passo do deploy.
 *
 *   pnpm tsx scripts/migrar-documentos-s3.ts --dry-run
 *   pnpm tsx scripts/migrar-documentos-s3.ts --org <id|nome>
 *   pnpm tsx scripts/migrar-documentos-s3.ts
 *
 * Por cada `documento` com `dados` preenchido e por apagar, cuja sociedade já
 * tem `bucket_s3` ativo:
 *
 *   1. envia o conteúdo (decifrado de base64) para a chave que já está
 *      gravada em `chave_storage` — não inventa uma chave nova. Essa chave é
 *      a que o resto do sistema (rota de download, `sincronizar.ts`) já lê
 *      quando `dados` for NULL; escrever ali e não noutro sítio é o que evita
 *      um segundo formato de chave a conviver com o de `carregarDocumento`;
 *   2. só depois de o envio ao S3 responder OK, apaga `dados` dessa linha.
 *
 * A ordem do passo 2 é a parte que importa: zerar `dados` antes de confirmar
 * o envio perdia o documento para sempre se o pedido a S3 falhasse a meio —
 * ficava sem cópia nenhuma, nem na base de dados nem no bucket. Ao contrário
 * disso, correr o script duas vezes seguidas é seguro: uma linha já com
 * `dados = NULL` não volta a aparecer na consulta.
 *
 * Uma sociedade ainda sem S3 ativo (`bucket_s3` vazio, ou `ativo = false`) é
 * simplesmente ignorada — os documentos dela ficam em `dados` até lá, exatamente
 * como ficam hoje.
 */
import { config } from "dotenv";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { armazenamentoSociedade } from "../src/db/schema/armazenamento";
import { documento } from "../src/db/schema/documentos";
import { organizacao } from "../src/db/schema/organizacao";
import { processoOnboarding } from "../src/db/schema/processo";
import { chaveDeAmbiente, decifrar } from "../src/lib/storage/cifra";
import { criarDestinoS3 } from "../src/lib/storage/s3";
import { parametrosS3 } from "../src/lib/storage/tipos";

config({ path: ".env" });

type Base = ReturnType<typeof drizzle>;

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const SIMULAR = process.argv.includes("--dry-run");

/** Separa a chave já gravada em segmentos + nome, tal como `Destino.enviar` espera. */
function segmentosDaChave(chave: string): { segmentos: string[]; nome: string } {
  const partes = chave.split("/").filter(Boolean);
  const nome = partes[partes.length - 1] ?? chave;
  const segmentos = partes.slice(0, -1);
  return { segmentos, nome };
}

async function sociedadesComS3(base: Base) {
  const alvo = argumento("org");

  const linhas = await base
    .select({
      organizacaoId: armazenamentoSociedade.organizacaoId,
      nome: organizacao.nome,
      bucketS3: armazenamentoSociedade.bucketS3,
      ativo: armazenamentoSociedade.ativo,
      parametros: armazenamentoSociedade.parametros,
    })
    .from(armazenamentoSociedade)
    .innerJoin(organizacao, eq(organizacao.id, armazenamentoSociedade.organizacaoId))
    .where(and(isNotNull(armazenamentoSociedade.bucketS3), eq(armazenamentoSociedade.ativo, true)));

  if (!alvo) return linhas;
  return linhas.filter((l) => l.organizacaoId === alvo || l.nome === alvo);
}

async function documentosPorMigrar(base: Base, organizacaoId: string) {
  return base
    .select({
      id: documento.id,
      nomeOriginal: documento.nomeOriginal,
      mime: documento.mime,
      dados: documento.dados,
      chaveStorage: documento.chaveStorage,
    })
    .from(documento)
    .innerJoin(processoOnboarding, eq(processoOnboarding.id, documento.processoId))
    .where(
      and(
        eq(processoOnboarding.organizacaoId, organizacaoId),
        isNotNull(documento.dados),
        isNull(documento.apagadoEm),
      ),
    );
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL não definido. Copia o .env.example para .env.");
    process.exit(1);
  }

  const chaveBruta = process.env.ARMAZENAMENTO_CHAVE?.trim();
  if (!chaveBruta) {
    console.error("ARMAZENAMENTO_CHAVE não definida — não há como decifrar as credenciais.");
    process.exit(1);
  }
  const chave = chaveDeAmbiente();
  if (!chave) {
    console.error("ARMAZENAMENTO_CHAVE inválida.");
    process.exit(1);
  }

  const ligacao = postgres(url, { max: 1, prepare: false });
  const base = drizzle(ligacao, { casing: "snake_case" });

  let totalMigrados = 0;
  let totalFalhados = 0;
  let totalIgnorados = 0;

  try {
    const sociedades = await sociedadesComS3(base);
    if (sociedades.length === 0) {
      console.log("Nenhuma sociedade com S3 ativo encontrada (ou --org não corresponde a nenhuma).");
      return;
    }

    for (const soc of sociedades) {
      if (!soc.parametros) {
        console.log(`⚠ ${soc.nome}: sem credenciais gravadas — a saltar.`);
        continue;
      }

      const params = parametrosS3.parse(decifrar(soc.parametros, chave));
      const destino = criarDestinoS3(params);
      const docs = await documentosPorMigrar(base, soc.organizacaoId);

      console.log(`${soc.nome} (bucket ${soc.bucketS3}): ${docs.length} documento(s) por migrar.`);

      for (const doc of docs) {
        const { segmentos, nome } = segmentosDaChave(doc.chaveStorage);
        console.log(`  · ${doc.nomeOriginal} → ${doc.chaveStorage}`);

        if (SIMULAR) {
          totalIgnorados += 1;
          continue;
        }

        try {
          await destino.enviar(segmentos, {
            nome,
            mime: doc.mime,
            conteudo: Buffer.from(doc.dados!, "base64"),
          });
          await base.update(documento).set({ dados: null }).where(eq(documento.id, doc.id));
          totalMigrados += 1;
        } catch (e) {
          totalFalhados += 1;
          console.error(
            `    ✗ falhou (${e instanceof Error ? e.message : String(e)}) — "dados" mantido, tenta-se noutra corrida.`,
          );
        }
      }
    }

    console.log(
      SIMULAR
        ? `Simulação: ${totalIgnorados} documento(s) seriam migrados.`
        : `Concluído: ${totalMigrados} migrado(s), ${totalFalhados} falhado(s).`,
    );
  } finally {
    await ligacao.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
