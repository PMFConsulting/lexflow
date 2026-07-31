/**
 * Seeds de desenvolvimento. Nunca corre fora de development — regra 2 do §10.
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

  await db.insert(utilizador).values([
    { organizacaoId: org.id, nome: "Sócia responsável", email: "socio@pmf.local", papel: "socio" },
    { organizacaoId: org.id, nome: "Advogado", email: "advogado@pmf.local", papel: "advogado" },
    { organizacaoId: org.id, nome: "Assistente", email: "assistente@pmf.local", papel: "assistente" },
  ]);

  // Os textos legais são versionados desde o início: sem eles não há
  // consentimento com prova do que a pessoa viu.
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
