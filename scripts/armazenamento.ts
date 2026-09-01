/**
 * Configuração do armazenamento de uma sociedade — o servidor dedicado, por
 * SFTP, ou um bucket S3 dedicado a essa sociedade.
 *
 * As credenciais entram por aqui e não por um formulário no back-office: uma
 * palavra-passe colada numa caixa de texto passa pelo browser, pelo proxy e
 * pelos logs de ambos. Por script, no servidor, só passa pela base de dados —
 * e mesmo aí, cifrada.
 *
 *   pnpm armazenamento estado
 *   pnpm armazenamento testar
 *   pnpm armazenamento configurar --pasta /Clientes
 *   pnpm armazenamento configurar --protocolo s3 --bucket lexflow-jmassano
 *   pnpm armazenamento desligar
 *
 * O `configurar` lê os parâmetros do ambiente, nunca de argumentos da linha de
 * comandos — `ps aux` mostra argumentos, e o histórico da shell guarda-os:
 *
 *   SFTP:  SERVIDOR_HOST, SERVIDOR_PORTA, SERVIDOR_UTILIZADOR, SERVIDOR_SEGREDO,
 *          SERVIDOR_CHAVE_PRIVADA, SERVIDOR_IMPRESSAO_HOST, SERVIDOR_CAMINHO_BASE
 *   S3:    AWS_REGION, LEXFLOW_S3_ACCESS_KEY_ID, LEXFLOW_S3_SECRET_ACCESS_KEY
 *
 * O nome do bucket (`--bucket`) não é segredo nenhum e por isso não vem do
 * ambiente: é o próprio argumento que fica gravado, em claro, na coluna
 * `bucket_s3` — é essa coluna, e não as credenciais cifradas, que decide o
 * destino. A criação do bucket em si fica fora deste script (manual, na
 * consola da AWS) enquanto só houver um punhado de sociedades.
 */
import { config } from "dotenv";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";
import { armazenamentoSociedade } from "../src/db/schema/armazenamento";
import { organizacao } from "../src/db/schema/organizacao";
import { cifrar, decifrar, lerChave } from "../src/lib/storage/cifra";
import { criarDestinoS3 } from "../src/lib/storage/s3";
import { criarDestinoServidor } from "../src/lib/storage/servidor";
import { parametrosS3, parametrosServidor, type Destino } from "../src/lib/storage/tipos";

config({ path: ".env" });

type Base = ReturnType<typeof drizzle>;

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function chave() {
  const bruta = process.env.ARMAZENAMENTO_CHAVE?.trim();
  if (!bruta) {
    console.error(
      "ARMAZENAMENTO_CHAVE não definida. Gera uma e põe no .env:\n" +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
    process.exit(1);
  }
  return lerChave(bruta);
}

/** A sociedade alvo: a indicada em `--org`, ou a única que existir. */
async function sociedade(base: Base) {
  const alvo = argumento("org");
  const linhas = await base
    .select({ id: organizacao.id, nome: organizacao.nome })
    .from(organizacao)
    .orderBy(asc(organizacao.criadoEm));

  if (linhas.length === 0) {
    console.error("Não há nenhuma organização na base de dados. Corre `pnpm db:seed`.");
    process.exit(1);
  }
  if (alvo) {
    const escolhida = linhas.find((o) => o.id === alvo || o.nome === alvo);
    if (!escolhida) {
      console.error(`Organização "${alvo}" não encontrada.`);
      process.exit(1);
    }
    return escolhida;
  }
  if (linhas.length > 1) {
    console.error("Há mais do que uma organização. Indica qual com --org <id|nome>:");
    for (const o of linhas) console.error(`  · ${o.nome} — ${o.id}`);
    process.exit(1);
  }
  return linhas[0];
}

function parametrosSftpDoAmbiente() {
  return parametrosServidor.parse({
    protocolo: "sftp",
    host: process.env.SERVIDOR_HOST,
    porta: process.env.SERVIDOR_PORTA ? Number(process.env.SERVIDOR_PORTA) : undefined,
    utilizador: process.env.SERVIDOR_UTILIZADOR,
    segredo: process.env.SERVIDOR_SEGREDO || undefined,
    chavePrivada: process.env.SERVIDOR_CHAVE_PRIVADA || undefined,
    impressaoDigitalHost: process.env.SERVIDOR_IMPRESSAO_HOST || undefined,
    caminhoBase: process.env.SERVIDOR_CAMINHO_BASE || undefined,
  });
}

function parametrosS3DoAmbiente(bucket: string) {
  return parametrosS3.parse({
    protocolo: "s3",
    regiao: process.env.AWS_REGION,
    bucket,
    accessKeyId: process.env.LEXFLOW_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.LEXFLOW_S3_SECRET_ACCESS_KEY,
  });
}

function destinoDe(parametros: unknown, bucketS3: string | null): Destino {
  return bucketS3
    ? criarDestinoS3(parametrosS3.parse(parametros))
    : criarDestinoServidor(parametrosServidor.parse(parametros));
}

async function linhaDe(base: Base, organizacaoId: string) {
  const [linha] = await base
    .select()
    .from(armazenamentoSociedade)
    .where(eq(armazenamentoSociedade.organizacaoId, organizacaoId))
    .limit(1);
  return linha ?? null;
}

/* ------------------------------------------------------------------ comandos */

async function estado(base: Base) {
  const org = await sociedade(base);
  const linha = await linhaDe(base, org.id);

  console.log(`Sociedade: ${org.nome}`);
  if (!linha) {
    console.log("Estado:    sem linha em armazenamento_sociedade — corre `pnpm db:migrate`.");
    return;
  }

  console.log(
    `Destino:   ${linha.bucketS3 ? `bucket S3 dedicado (${linha.bucketS3})` : "servidor da sociedade (SFTP)"}`,
  );
  console.log(`Pasta:     ${linha.pastaRaiz}`);
  console.log(`Credenciais: ${linha.parametros ? "gravadas (cifradas)" : "por gravar"}`);
  console.log(`Ativo:     ${linha.ativo ? "sim" : "não"}`);
  console.log(`Última sincronização: ${linha.ultimaSincronizacaoEm?.toISOString() ?? "—"}`);
  if (linha.ultimoErro) console.log(`Último erro: ${linha.ultimoErro}`);
  if (linha.parametros && !process.env.ARMAZENAMENTO_CHAVE) {
    console.log("\n⚠ ARMAZENAMENTO_CHAVE em falta: as credenciais não podem ser decifradas.");
  }
}

async function configurar(base: Base) {
  const org = await sociedade(base);
  const protocolo = argumento("protocolo") === "s3" ? "s3" : "sftp";
  const bucket = argumento("bucket") || undefined;

  if (protocolo === "s3" && !bucket) {
    console.error(
      "--bucket é obrigatório com --protocolo s3 (um bucket dedicado por sociedade, nunca partilhado).",
    );
    process.exit(1);
  }

  const parametros = protocolo === "s3" ? parametrosS3DoAmbiente(bucket!) : parametrosSftpDoAmbiente();
  const envelope = cifrar(parametros, chave());
  const pastaRaiz = argumento("pasta") ?? "/Clientes";
  const ativo = argumento("ativo") !== "false";
  const bucketS3 = protocolo === "s3" ? bucket! : null;

  const existente = await linhaDe(base, org.id);

  if (existente) {
    await base
      .update(armazenamentoSociedade)
      .set({ parametros: envelope, pastaRaiz, ativo, bucketS3, ultimoErro: null })
      .where(eq(armazenamentoSociedade.id, existente.id));
  } else {
    await base.insert(armazenamentoSociedade).values({
      id: uuidv7(),
      organizacaoId: org.id,
      parametros: envelope,
      pastaRaiz,
      ativo,
      bucketS3,
    });
  }

  const descricaoDestino = protocolo === "s3" ? `S3 (bucket ${bucket})` : "SFTP";
  console.log(`✓ ${org.nome}: ${descricaoDestino} em ${pastaRaiz}, ${ativo ? "ativo" : "desativado"}.`);
  console.log("  As credenciais ficaram cifradas com ARMAZENAMENTO_CHAVE.");
  console.log("  Confirma com: pnpm armazenamento testar");
}

async function testar(base: Base) {
  const org = await sociedade(base);
  const linha = await linhaDe(base, org.id);

  if (!linha?.parametros) {
    console.error("Sem credenciais gravadas. Corre `pnpm armazenamento configurar` primeiro.");
    process.exit(1);
  }

  const destino = destinoDe(decifrar(linha.parametros, chave()), linha.bucketS3);
  const r = await destino.verificar();
  console.log(`${r.ok ? "✓" : "✗"} ${r.detalhe}`);
  if (!r.ok) process.exit(1);
}

async function desligar(base: Base) {
  const org = await sociedade(base);
  const linha = await linhaDe(base, org.id);
  if (!linha) {
    console.error("Nada para desligar.");
    process.exit(1);
  }

  // As credenciais ficam: desligar não é esquecer, e voltar a ligar não pode
  // obrigar a pedir tudo outra vez à sociedade.
  await base
    .update(armazenamentoSociedade)
    .set({ ativo: false })
    .where(eq(armazenamentoSociedade.id, linha.id));

  console.log(`✓ ${org.nome}: sincronização desligada. As credenciais ficaram gravadas.`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL não definido. Copia o .env.example para .env.");
    process.exit(1);
  }

  const ligacao = postgres(url, { max: 1, prepare: false });
  const base = drizzle(ligacao, { casing: "snake_case" });

  const comando = process.argv[2] ?? "estado";

  try {
    if (comando === "estado") await estado(base);
    else if (comando === "configurar") await configurar(base);
    else if (comando === "testar") await testar(base);
    else if (comando === "desligar") await desligar(base);
    else {
      console.error(`Comando desconhecido: ${comando}`);
      console.error("Usa: estado | configurar | testar | desligar");
      process.exit(1);
    }
  } finally {
    await ligacao.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
