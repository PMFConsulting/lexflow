/**
 * Development seeds. Never runs outside development — rule 2 of §10.
 *
 *   pnpm db:seed
 */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createHash } from "node:crypto";
import { organizacao, utilizador } from "./schema/organizacao";
import { versaoTextoLegal } from "./schema/legal";

config({ path: ".env" });

if (process.env.NODE_ENV === "production") {
  console.error("Recusado: seeds não correm em produção.");
  process.exit(1);
}

const TEXTO_VERACIDADE =
  "Declaro que as informações prestadas são verdadeiras e assumo a responsabilidade pela sua atualização caso se verifiquem alterações.";

const TEXTO_NEWSLETTER =
  "Autorizo a PMF Consulting a enviar-me comunicações informativas e newsletters para os endereços de email que indiquei. Posso retirar esta autorização a qualquer momento.";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL não definido. Copia o .env.example para .env.");
    process.exit(1);
  }

  const ligacao = postgres(url, { max: 1, prepare: false });
  const db = drizzle(ligacao, { casing: "snake_case" });

  const [org] = await db
    .insert(organizacao)
    .values({
      nome: "PMF Consulting",
      nif: "500000000",
      prefixoReferencia: "PMF",
    })
    .returning();

  // Os três níveis da migração `0016`. O `super_admin` fica **sem** sociedade —
  // é a restrição `utilizador_org_por_papel`, e é também o que faz com que ele
  // não apareça em consulta nenhuma do back-office desta organização.
  await db.insert(utilizador).values([
    {
      organizacaoId: null,
      nome: "Administrador da plataforma",
      email: "plataforma@terlicalabs.local",
      papel: "super_admin",
    },
    {
      organizacaoId: org.id,
      nome: "Sócia responsável",
      email: "socio@pmf.local",
      papel: "society_admin",
    },
    { organizacaoId: org.id, nome: "Advogado", email: "advogado@pmf.local", papel: "utilizador" },
    {
      organizacaoId: org.id,
      nome: "Assistente",
      email: "assistente@pmf.local",
      papel: "utilizador",
    },
  ]);

  // The legal texts are versioned from the start: without them there is no
  // consent with evidence of what the person saw.
  await db.insert(versaoTextoLegal).values([
    {
      chave: "declaracao_veracidade",
      versao: "2026-07-31.1",
      conteudo: TEXTO_VERACIDADE,
      hash: createHash("sha256").update(TEXTO_VERACIDADE).digest("hex"),
    },
    {
      chave: "rgpd.newsletter",
      versao: "2026-07-31.1",
      conteudo: TEXTO_NEWSLETTER,
      hash: createHash("sha256").update(TEXTO_NEWSLETTER).digest("hex"),
    },
  ]);

  await ligacao.end();
  console.log(`Seeds aplicados. Organização: ${org.nome} (${org.id})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
