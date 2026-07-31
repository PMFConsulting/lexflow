import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./_comum";
import { finalidadeConsentimento } from "./enums";
import { processoOnboarding } from "./processo";

/**
 * O texto exato que foi apresentado ao titular, versionado e imutável.
 *
 * O brief exige provar daqui a 4 anos o que a pessoa viu. Guardar só um rótulo
 * de versão prova o rótulo; guardar o texto inteiro em cada consentimento
 * duplica megabytes. Uma tabela de versões referenciada por FK prova o conteúdo
 * e não duplica nada — decisão D3 em CLAUDE.md.
 */
export const versaoTextoLegal = pgTable(
  "versao_texto_legal",
  {
    id: id(),
    /** 'rgpd.newsletter', 'termos_condicoes', 'declaracao_veracidade'… */
    chave: text("chave").notNull(),
    /** '2026-07-31.1' */
    versao: text("versao").notNull(),
    conteudo: text("conteudo").notNull(),
    hash: text("hash").notNull(),
    vigenteDesde: timestamp("vigente_desde", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("texto_chave_versao").on(t.chave, t.versao),
    index("texto_chave").on(t.chave, t.vigenteDesde),
  ],
);

/** Cada consentimento é uma linha própria, com prova de data/hora e IP. */
export const consentimento = pgTable(
  "consentimento",
  {
    id: id(),
    processoId: uuid("processo_id")
      .notNull()
      .references(() => processoOnboarding.id, { onDelete: "restrict" }),
    finalidade: finalidadeConsentimento("finalidade").notNull(),
    textoLegalId: uuid("texto_legal_id")
      .notNull()
      .references(() => versaoTextoLegal.id, { onDelete: "restrict" }),
    aceite: boolean("aceite").notNull(),
    aceiteEm: timestamp("aceite_em", { withTimezone: true }).notNull().defaultNow(),
    ip: text("ip").notNull(),
    userAgent: text("user_agent").notNull(),
    revogadoEm: timestamp("revogado_em", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("consentimento_unico").on(t.processoId, t.finalidade, t.textoLegalId),
    index("consentimento_processo").on(t.processoId),
  ],
);
