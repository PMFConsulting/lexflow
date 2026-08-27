/**
 * Criação de contas do back-office.
 *
 * O registo público deixou de existir (`disableSignUp: true` em
 * src/lib/auth.ts): quem entra na plataforma é criado aqui, no servidor, por
 * quem já lá tem acesso. Um sistema que guarda declarações de PPE e documentos
 * de identificação não pode ter um formulário aberto a criar contas.
 *
 *   node scripts/criar_utilizador.mjs --email pedro@pmf.pt --nome "Pedro Faria" \
 *     --papel society_admin --password '...'
 *
 * Os papéis são três: `super_admin` (dono da plataforma, **sem** sociedade),
 * `society_admin` (administra uma sociedade) e `utilizador` (trabalha os
 * processos dela). O primeiro `super_admin` tem de nascer aqui — não há
 * ninguém autenticado que o possa criar pela interface:
 *
 *   node scripts/criar_utilizador.mjs --papel super_admin \
 *     --email dono@exemplo.pt --nome "…" --password '...'
 *
 * A partir daí, as contas criam-se no portal `/admin`, que chama o mesmo par de
 * escritas através de `src/features/plataforma/contas.ts`. Este script fica
 * para o arranque e para operações de servidor.
 *
 *   node scripts/criar_utilizador.mjs --gerar-hash --password '...'
 *
 * O `--gerar-hash` não toca na base de dados: imprime só o hash da
 * palavra-passe, no formato exato que o Better Auth verifica no login. Serve
 * para preparar a conta numa máquina sem acesso à base de dados e aplicá-la
 * depois no servidor.
 *
 * A palavra-passe é melhor entrar por ambiente do que por argumento — o `ps` de
 * qualquer utilizador da máquina mostra os argumentos de um processo, e a shell
 * guarda-os no histórico:
 *
 *   UTILIZADOR_PASSWORD='...' node scripts/criar_utilizador.mjs --email … --nome …
 *
 * Também lê UTILIZADOR_EMAIL, UTILIZADOR_NOME e UTILIZADOR_PAPEL.
 *
 * Duas escritas, e as duas são precisas (decisão D2): a conta do Better Auth
 * (`user` + `account`, que é onde vive a palavra-passe) e o utilizador de
 * domínio (`utilizador`, que é quem tem papel e organização). Sem a segunda, o
 * login passa e a sessão não resolve — `sessaoAtual()` procura por
 * `auth_user_id` e manda de volta para /entrar.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { hashPassword } from "better-auth/crypto";
import postgres from "postgres";
import { uuidv7 } from "uuidv7";

/**
 * A organização das seeds de desenvolvimento — e só isso.
 *
 * É o recuo de `--organizacao` para os dois papéis que **têm** sociedade, e
 * numa base de dados nova ela não existe: o script morre a dizê-lo (ver o
 * `morrer` em `criar()`), em vez de inserir uma conta órfã. Numa instalação a
 * sério a ordem é a inversa — o primeiro `super_admin` nasce sem organização
 * nenhuma, e é ele que convida a sociedade com `pnpm sociedade:convidar`; daí
 * em diante as contas dela criam-se no portal `/admin`.
 */
const ORGANIZACAO_PMF = "fe6c269c-5358-43f9-8a7e-ccade4778940";

/**
 * Os três níveis da migração `0016`.
 *
 * O `super_admin` **não pertence a sociedade nenhuma** — a restrição
 * `utilizador_org_por_papel` exige `organizacao_id` a NULL para ele e a
 * NOT NULL para os outros dois. É por isso que o `--organizacao` deixou de ter
 * um valor por omissão universal: para um `super_admin`, esse valor por
 * omissão era o que fazia a inserção rebentar contra a restrição.
 */
const PAPEIS = ["super_admin", "society_admin", "utilizador"];

const PAPEL_DE_PLATAFORMA = "super_admin";

const MINIMO_PALAVRA_PASSE = 12;

/* ----------------------------------------------------------------- entrada */

function argumento(nome) {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const temBandeira = (nome) => process.argv.includes(`--${nome}`);

/**
 * Lê o .env sem dependências.
 *
 * O `dotenv` é devDependency, e num servidor com `pnpm install --prod` — que é
 * o que a imagem de produção faz — não existe. Isto são dez linhas que não
 * partem lá.
 */
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

function validarPalavraPasse(password) {
  if (!password) {
    morrer(
      "Falta a palavra-passe. Use --password ou, melhor, a variável UTILIZADOR_PASSWORD.",
    );
  }
  if (password.length < MINIMO_PALAVRA_PASSE) {
    morrer(
      `A palavra-passe tem de ter pelo menos ${MINIMO_PALAVRA_PASSE} caracteres — é o mínimo que o Better Auth aceita no login.`,
    );
  }
  return password;
}

/** Id no formato do Better Auth: texto opaco, sem hífenes. */
const idAuth = () => randomBytes(16).toString("hex");

/* ------------------------------------------------------------------- modos */

async function gerarHash(password) {
  const hash = await hashPassword(password);
  // Só o hash no stdout: assim `$(node scripts/criar_utilizador.mjs --gerar-hash …)`
  // devolve o valor limpo. As explicações vão para o stderr.
  console.error("Hash Better Auth (scrypt, formato salt:hash em hexadecimal):");
  console.log(hash);
}

async function criar({ email, nome, papel, password, organizacaoId, reativar }) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    morrer(
      "DATABASE_URL não definida. Localmente é o esperado — corra este script no servidor, " +
        "ou use --gerar-hash para preparar só o hash.",
    );
  }

  const hash = await hashPassword(password);
  const sql = postgres(url, { max: 1, prepare: false });

  try {
    // O `super_admin` não tem organização — a coluna fica a NULL, e é isso que
    // o mantém fora do âmbito de qualquer sociedade (todas as consultas do
    // back-office comparam organizações, e NULL nunca é igual a nada).
    let org = null;

    if (organizacaoId) {
      [org] = await sql`
        select id, nome from organizacao where id = ${organizacaoId} limit 1
      `;
      if (!org) {
        morrer(
          `A organização ${organizacaoId} não existe. Corra as migrações e as seeds, ou indique --organizacao.`,
        );
      }
    }

    let criouConta = false;
    let criouUtilizador = false;

    await sql.begin(async (tx) => {
      /* --- conta do Better Auth ------------------------------------------ */

      const [existente] = await tx`
        select id from "user" where email = ${email} limit 1
      `;

      let authUserId;
      if (existente) {
        authUserId = existente.id;
        await tx`
          update "user" set name = ${nome}, updated_at = now() where id = ${authUserId}
        `;
      } else {
        authUserId = idAuth();
        await tx`
          insert into "user" (id, name, email, email_verified, created_at, updated_at)
          values (${authUserId}, ${nome}, ${email}, true, now(), now())
        `;
        criouConta = true;
      }

      // A palavra-passe não vive em `user`: o Better Auth guarda-a na conta com
      // `provider_id = 'credential'`, e é lá que o login a vai buscar.
      const [conta] = await tx`
        select id from account
        where user_id = ${authUserId} and provider_id = 'credential'
        limit 1
      `;

      if (conta) {
        await tx`
          update account set password = ${hash}, updated_at = now() where id = ${conta.id}
        `;
      } else {
        await tx`
          insert into account
            (id, account_id, provider_id, user_id, password, created_at, updated_at)
          values
            (${idAuth()}, ${authUserId}, 'credential', ${authUserId}, ${hash}, now(), now())
        `;
      }

      /* --- utilizador de domínio ----------------------------------------- */

      // `is null` e não `= null`: em SQL, `= null` não é falso, é desconhecido,
      // e não encontrava nunca o `super_admin` que já lá estivesse — o script
      // tentava inserir outro e batia no índice único parcial.
      const [eu] = organizacaoId
        ? await tx`
            select id, apagado_em from utilizador
            where organizacao_id = ${organizacaoId} and email = ${email}
            limit 1
          `
        : await tx`
            select id, apagado_em from utilizador
            where organizacao_id is null and email = ${email}
            limit 1
          `;

      if (eu) {
        await tx`
          update utilizador set
            nome = ${nome},
            papel = ${papel},
            auth_user_id = ${authUserId},
            ativo = true,
            aprovado_em = now(),
            atualizado_em = now()
          where id = ${eu.id}
        `;
        // O apagamento é uma decisão de quem o fez: reverter por engano ao
        // recriar uma palavra-passe seria pior do que avisar.
        if (reativar) {
          await tx`update utilizador set apagado_em = null where id = ${eu.id}`;
        }
        if (eu.apagado_em && !reativar) {
          console.warn(
            "⚠ Este utilizador está marcado como apagado e não vai conseguir entrar. " +
              "Repita com --reativar para o repor.",
          );
        }
      } else {
        // `id` gerado na aplicação e não pela base de dados (decisão D15): o
        // Postgres só tem uuidv7() nativo na v18.
        //
        // `aprovado_em` a `now()`: uma conta criada no servidor não passa pela
        // aprovação da plataforma — quem tem acesso à consola já é quem
        // aprovaria. Sem esta coluna a conta nascia pendente e o guard
        // desviava-a para `/aguarda-aprovacao`, o que no arranque de uma
        // instalação é uma plataforma sem ninguém que consiga entrar.
        await tx`
          insert into utilizador
            (id, organizacao_id, auth_user_id, nome, email, papel, ativo, aprovado_em, criado_em, atualizado_em)
          values
            (${uuidv7()}, ${organizacaoId}, ${authUserId}, ${nome}, ${email}, ${papel}, true, now(), now(), now())
        `;
        criouUtilizador = true;
      }
    });

    const verbo = criouConta && criouUtilizador ? "criado" : "atualizado";
    console.log(`✓ Utilizador ${verbo}.`);
    console.log(`  Email:        ${email}`);
    console.log(`  Nome:         ${nome}`);
    console.log(`  Papel:        ${papel}`);
    console.log(`  Organização:  ${org ? org.nome : "— (administração da plataforma)"}`);
    if (!criouConta) {
      console.log("  A conta já existia — a palavra-passe foi substituída.");
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/* ------------------------------------------------------------------ início */

async function principal() {
  carregarAmbiente();

  const password = validarPalavraPasse(
    argumento("password") ?? process.env.UTILIZADOR_PASSWORD,
  );

  if (temBandeira("gerar-hash")) {
    await gerarHash(password);
    return;
  }

  const email = (argumento("email") ?? process.env.UTILIZADOR_EMAIL ?? "").trim().toLowerCase();
  const nome = (argumento("nome") ?? process.env.UTILIZADOR_NOME ?? "").trim();
  const papel = (argumento("papel") ?? process.env.UTILIZADOR_PAPEL ?? "utilizador").trim();

  if (!email || !email.includes("@")) morrer("Falta um email válido em --email.");
  // `nome` é NOT NULL em `utilizador`; sem ele o insert rebentava com uma
  // mensagem do Postgres em vez de uma explicação.
  if (!nome) morrer("Falta o nome em --nome.");
  if (!PAPEIS.includes(papel)) {
    morrer(`Papel inválido: "${papel}". Um de: ${PAPEIS.join(", ")}.`);
  }

  /**
   * A organização depende do papel, e a mensagem de erro também.
   *
   * Um `super_admin` **com** organização e um `society_admin` **sem** ela são
   * os dois recusados pela restrição `utilizador_org_por_papel`. Recusá-los
   * aqui é o que faz a diferença entre uma frase que diz o que fazer e um
   * `violates check constraint` no fim de uma transação.
   */
  const orgPedida = argumento("organizacao");
  let organizacaoId;

  if (papel === PAPEL_DE_PLATAFORMA) {
    if (orgPedida) {
      morrer(
        `Um ${PAPEL_DE_PLATAFORMA} não pertence a nenhuma sociedade — não indique --organizacao.`,
      );
    }
    organizacaoId = null;
  } else {
    organizacaoId = orgPedida ?? ORGANIZACAO_PMF;
  }

  await criar({
    email,
    nome,
    papel,
    password,
    organizacaoId,
    reativar: temBandeira("reativar"),
  });
}

principal().catch((e) => {
  console.error("✗ Falhou:", e?.message ?? e);
  process.exit(1);
});
