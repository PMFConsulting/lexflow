/**
 * Abre o registo de uma sociedade e imprime o link.
 *
 * É por aqui que uma sociedade entra na plataforma. Cria a linha da
 * `organizacao` como casca — nome provisório, NIF por confirmar, prefixo de
 * referência a definir — e o `onboarding_sociedade` que lhe dá o link mágico;
 * o resto é preenchido por quem estiver do lado da sociedade, nos seis passos.
 *
 *   node scripts/convidar_sociedade.mjs --nome "JMASSANO" --email geral@jmassano.pt
 *
 * Um script no servidor, e não um formulário público, pela mesma razão da D23:
 * um sistema que guarda declarações de PPE e documentos de identificação não
 * tem uma porta aberta a criar organizações. Quem abre uma sociedade nova é
 * quem tem acesso à máquina.
 *
 * `--sem-email` imprime o link sem o enviar — serve quando o endereço ainda não
 * está confirmado, ou quando o canal de email ainda não está configurado.
 * O link é impresso **sempre**, com ou sem envio: um link que só existe dentro
 * de um email que pode não chegar é um registo que ninguém consegue destrancar.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";

/* ----------------------------------------------------------------- entrada */

function argumento(nome) {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const temBandeira = (nome) => process.argv.includes(`--${nome}`);

/** Lê o .env sem dependências — o `dotenv` é devDependency e não existe em produção. */
function carregarAmbiente(ficheiros = [".env", ".env.local"]) {
  for (const ficheiro of ficheiros) {
    let bruto;
    try {
      bruto = readFileSync(ficheiro, "utf8");
    } catch {
      continue;
    }
    for (const linha of bruto.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(linha);
      if (!m) continue;
      const chave = m[1];
      if (process.env[chave] !== undefined) continue; // o ambiente real manda
      let valor = m[2].trim();
      if (
        (valor.startsWith('"') && valor.endsWith('"')) ||
        (valor.startsWith("'") && valor.endsWith("'"))
      ) {
        valor = valor.slice(1, -1);
      }
      process.env[chave] = valor;
    }
  }
}

function morrer(mensagem) {
  console.error(`✗ ${mensagem}`);
  process.exit(1);
}

/**
 * O token e o seu hash, saídos do mesmo sítio.
 *
 * A mesma regra da D47, e por escrito aqui porque este ficheiro não pode
 * importar `src/lib/token.ts` (é `server-only`): gerar num sítio e fazer o hash
 * noutro dá, no dia em que um deles mudar, uma organização real com um link que
 * a consulta nunca encontra.
 */
function novoToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}

/** Prefixo provisório a partir do nome: as iniciais, em maiúsculas. */
function prefixoProvisorio(nome) {
  const letras = nome
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase();
  return (letras || "SOC").slice(0, 6).padEnd(2, "X");
}

/* -------------------------------------------------------------------- main */

async function main() {
  carregarAmbiente();

  const nome = argumento("nome") ?? process.env.SOCIEDADE_NOME;
  const email = argumento("email") ?? process.env.SOCIEDADE_EMAIL;
  const dias = Number(argumento("dias") ?? 30);

  if (!nome) morrer("Falta o nome da sociedade. Use --nome \"JMASSANO\".");
  if (!Number.isFinite(dias) || dias < 1) morrer("--dias tem de ser um número de dias positivo.");

  const url = process.env.DATABASE_URL;
  if (!url) {
    morrer(
      "DATABASE_URL não definida. Corra este script no servidor, onde a base de dados está.",
    );
  }

  const origem = (
    process.env.APP_URL ??
    process.env.BETTER_AUTH_URL ??
    "http://localhost:3000"
  ).replace(/\/+$/, "");

  const { token, hash } = novoToken();
  const sql = postgres(url, { max: 1, prepare: false });

  try {
    const organizacaoId = uuidv7();
    const onboardingId = uuidv7();
    const expira = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);

    await sql.begin(async (tx) => {
      await tx`
        insert into organizacao (id, nome, nif, prefixo_referencia, email_geral)
        values (${organizacaoId}, ${nome}, ${""}, ${prefixoProvisorio(nome)}, ${email ?? null})
      `;
      await tx`
        insert into onboarding_sociedade (id, organizacao_id, token_acesso_hash, expira_em)
        values (${onboardingId}, ${organizacaoId}, ${hash}, ${expira})
      `;
    });

    const link = `${origem}/sociedade/${token}`;

    console.error(`✓ Sociedade «${nome}» criada.`);
    console.error(`  organização: ${organizacaoId}`);
    console.error(`  válido até:  ${expira.toISOString().slice(0, 10)}`);
    console.error("");
    console.error("O link só é impresso uma vez — a base guarda apenas o SHA-256 (D4).");
    console.error("");
    // Só o link no stdout, para poder ser capturado com `$( … )`.
    console.log(link);

    if (email && !temBandeira("sem-email")) {
      console.error("");
      console.error(
        `Nota: o envio automático não é feito por este script. Envie o link acima para ${email}, ` +
          "ou use a plataforma depois de a conta de administrador existir.",
      );
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => morrer(e instanceof Error ? e.message : String(e)));
