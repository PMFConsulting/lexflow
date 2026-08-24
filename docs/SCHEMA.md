# Proposed Drizzle schema

> **Status: proposal, awaiting approval.** None of this is in `src/db/` — Phase 0 writes no
> code.
>
> **Revised after reading the 7 screenshots.** The sections below already reflect the real form
> (multi-value nationalities, address with freguesia/concelho/distrito, identification document
> at step 2, contact preferences at step 5). The divergences between the brief and the form are
> in `docs/CAMPOS.md` §D — worth reading before this page.

Planned files: `src/db/schema/` with one module per domain (`organizacao.ts`, `processo.ts`,
`seccoes.ts`, `documentos.ts`, `auditoria.ts`, `legal.ts`) re-exported by
`src/db/schema/index.ts`.

---

## Conventions

- **UUID v7 ids** — time-sortable, which gives B-tree indexes good locality and stable cursor
  pagination. See "Dependencies to approve" at the end.
- **`criado_em` / `atualizado_em`** on every table, `timestamptz`, server-side default.
- **Soft delete** (`apagado_em timestamptz`) on the tables under legal retention.
  `evento_auditoria` does not even have soft delete — it is not deleted in any way.
- **`extra jsonb`** on each section table, for whatever is genuinely variable. It is not an
  excuse to dump in there what should be a column: if it is searched, filtered or indexed, it
  is a column.
- Names in Portuguese, `snake_case`, like the rest of the brief.

```ts
// src/db/schema/_comum.ts
import { sql } from 'drizzle-orm'
import { pgTable, timestamp, uuid, jsonb } from 'drizzle-orm/pg-core'
import { uuidv7 } from 'uuidv7'

export const id = () => uuid('id').primaryKey().$defaultFn(() => uuidv7())

export const timestamps = {
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true })
    .notNull().defaultNow().$onUpdate(() => new Date()),
}

export const softDelete = {
  apagadoEm: timestamp('apagado_em', { withTimezone: true }),
}

export const extra = jsonb('extra').$type<Record<string, unknown>>().default({})
```

---

## Enums

```ts
export const tipoCliente     = pgEnum('tipo_cliente', ['particular', 'empresa'])
export const estadoProcesso  = pgEnum('estado_processo', [
  'rascunho', 'submetido', 'em_revisao', 'pendente_cliente',
  'aprovado', 'rejeitado', 'arquivado',
])
export const nivelRisco      = pgEnum('nivel_risco', ['baixo', 'medio', 'elevado'])
export const papelUtilizador = pgEnum('papel_utilizador', ['admin', 'socio', 'advogado', 'assistente'])
export const tipoDocId       = pgEnum('tipo_doc_id', ['cc', 'passaporte', 'titulo_residencia'])
// estado_civil dropped: it does not exist in the real form (divergence D6)
export const regimeIva       = pgEnum('regime_iva', [
  'normal', 'isento_art53', 'isento_art9', 'misto',
]) // ← ambiguity A8
export const tipoDocumento   = pgEnum('tipo_documento', [
  'id_frente', 'id_verso', 'comprovativo_nif', 'certidao_permanente',
  'procuracao', 'ata_designacao', 'comprovativo_rcbe', 'outro',
])
export const finalidade      = pgEnum('finalidade_consentimento', [
  'newsletter', 'convites_iniciativas',   // the only real consents (D2/A11)
  'declaracao_veracidade',                // current step 7
  'termos_condicoes', 'proposta',         // new, if the brief's step 7 goes ahead
])
export const origemContacto  = pgEnum('origem_contacto', [
  'recomendacao', 'pesquisa_online', 'evento_conferencia', 'outro',
])
export const titularNacionalidade = pgEnum('titular_nacionalidade', ['cliente', 'representante'])
export const tipoAssinatura  = pgEnum('tipo_assinatura', ['simples', 'avancada', 'qualificada'])
```

---

## Core

```ts
export const organizacao = pgTable('organizacao', {
  id: id(),
  nome: text('nome').notNull(),
  nif: char('nif', { length: 9 }).notNull(),
  prefixoReferencia: text('prefixo_referencia').notNull(),   // 'PMF'
  ...timestamps, ...softDelete,
})

export const utilizador = pgTable('utilizador', {
  id: id(),
  organizacaoId: uuid('organizacao_id').notNull().references(() => organizacao.id),
  nome: text('nome').notNull(),
  email: text('email').notNull(),
  papel: papelUtilizador('papel').notNull().default('assistente'),
  mfaAtivo: boolean('mfa_ativo').notNull().default(false),
  ativoEm: timestamp('ativo_em', { withTimezone: true }),
  ...timestamps, ...softDelete,
}, (t) => [uniqueIndex('utilizador_email_org').on(t.organizacaoId, t.email)])
```

> **Note:** Better Auth generates its own tables (`user`, `session`, `account`,
> `verification`, `twoFactor`). `utilizador` is the **domain** table — role, organisation,
> assignments — linked 1:1 to Better Auth's `user` via `auth_user_id`. Mixing the two turns any
> library update into a data migration. A design decision not covered by §3, recorded here as
> rule 8 requires.

```ts
export const processoOnboarding = pgTable('processo_onboarding', {
  id: id(),
  organizacaoId: uuid('organizacao_id').notNull().references(() => organizacao.id),
  referencia: text('referencia').notNull(),                  // PMF-2026-0142
  tipoCliente: tipoCliente('tipo_cliente').notNull(),
  estado: estadoProcesso('estado').notNull().default('rascunho'),
  passoAtual: smallint('passo_atual').notNull().default(1),
  responsavelId: uuid('responsavel_id').references(() => utilizador.id),
  nivelRisco: nivelRisco('nivel_risco').notNull().default('baixo'),
  fatoresRisco: jsonb('fatores_risco').$type<FatorRisco[]>().notNull().default([]),
  tokenAcessoHash: text('token_acesso_hash').notNull(),       // see note below
  expiraEm: timestamp('expira_em', { withTimezone: true }),
  submetidoEm: timestamp('submetido_em', { withTimezone: true }),
  aprovadoEm: timestamp('aprovado_em', { withTimezone: true }),
  aprovadoPor: uuid('aprovado_por').references(() => utilizador.id),
  motivoRejeicao: text('motivo_rejeicao'),
  pesquisa: tsvector('pesquisa'),                             // generated, see "Search"
  ...timestamps, ...softDelete,
}, (t) => [
  uniqueIndex('processo_referencia_org').on(t.organizacaoId, t.referencia),
  index('processo_estado').on(t.organizacaoId, t.estado),
  index('processo_risco').on(t.organizacaoId, t.nivelRisco),
  index('processo_responsavel').on(t.responsavelId),
  index('processo_pesquisa').using('gin', t.pesquisa),
  check('passo_valido', sql`${t.passoAtual} between 1 and 7`),
])
```

**Two decisions worth flagging:**

1. **`token_acesso_hash`, not `token_acesso`.** The magic link token is stored as SHA-256,
   never in the clear. Anyone with read access to the DB does not gain the ability to open any
   client's case file. The plaintext token exists once, in the email.
2. **Generating `referencia`.** A per-organisation, per-year sequence has to be
   concurrency-safe — a Postgres sequence keyed on `(organizacao, ano)` or `INSERT ...
   RETURNING` with an `advisory lock`. A `SELECT max()+1` produces duplicate references on the
   first day with two users. I propose a `contador_referencia` table with
   `UPDATE ... RETURNING`.

---

## Sections (1:1 with the matter)

They all follow the same pattern — unique `processoId`, `extra jsonb`, timestamps:

The address repeats in four places (client, representative, billing and, later, the company's
registered office). It stays as a reusable set of columns, not as a table — it is always 1:1
and is never searched on its own:

```ts
// src/db/schema/_morada.ts — the 7 fields the real form uses
export const morada = {
  morada: text('morada').notNull(),
  pais: char('pais', { length: 2 }).notNull(),
  localidade: text('localidade').notNull(),
  codigoPostal: text('codigo_postal').notNull(),
  freguesia: text('freguesia').notNull(),
  concelho: text('concelho').notNull(),
  distrito: text('distrito').notNull(),
}
```

```ts
export const dadosIdentificacao = pgTable('dados_identificacao', {
  id: id(),
  processoId: uuid('processo_id').notNull().unique().references(() => processoOnboarding.id),
  nome: text('nome').notNull(),
  profissao: text('profissao').notNull(),
  entidadePatronal: text('entidade_patronal').notNull(),   // "N/A" if not applicable
  dataNascimento: date('data_nascimento').notNull(),
  telefone: text('telefone').notNull(),
  email: text('email').notNull(),
  ...morada,
  extra, ...timestamps,
}, (t) => [index('identificacao_nome').on(t.nome)])

// Nationality is multi-value in the form (chips). Own table, polymorphic by holder.
export const nacionalidade = pgTable('nacionalidade', {
  id: id(),
  processoId: uuid('processo_id').notNull().references(() => processoOnboarding.id),
  titular: titularNacionalidade('titular').notNull(),      // 'cliente' | 'representante'
  pais: char('pais', { length: 2 }).notNull(),
  ...timestamps,
}, (t) => [uniqueIndex('nacionalidade_unica').on(t.processoId, t.titular, t.pais)])

export const dadosFiscais = pgTable('dados_fiscais', {
  id: id(),
  processoId: uuid('processo_id').notNull().unique().references(() => processoOnboarding.id),
  nifPortugues: boolean('nif_portugues').notNull(),
  resideEmPortugal: boolean('reside_em_portugal').notNull(),
  nif: text('nif').notNull(),                    // mod-11 only if nifPortugues
  docTipo: tipoDocId('doc_tipo').notNull(),      // the ID doc lives here, not at step 1 (D3)
  docNumero: text('doc_numero').notNull(),
  docValidade: date('doc_validade').notNull(),
  extra, ...timestamps,
}, (t) => [index('fiscais_nif').on(t.nif), index('fiscais_doc_validade').on(t.docValidade)])
```

`dados_fiscais.nif` gets its own index: it is one of the three global search fields.
`doc_validade` too: it feeds the 60-day alert on the dashboard.

**The remaining ones with the same shape**, per `docs/CAMPOS.md`:

| Table | Step | Notes |
|---|---|---|
| `representante_legal` | 3 | `e_representante` as a toggle, `relacao`, personal details, `...morada`, its own tax block |
| `declaracao_ppe` | 4 | `e_ppe`, `e_relacionado_ppe` + detail fields (A16) |
| `relacao_negocio` | 4 | `servicos` and `origem_fundos`, both mandatory |
| `preferencias_contacto` | 5 | `origem_contacto`, `origem_detalhe`, `newsletter`, `convites_iniciativas`, `convites_nome`, `convites_email` |
| `dados_faturacao` | 6 | `igual_ao_cliente`, name, tax number, `...morada`, email + "Ao cuidado de" block (`ac_*`) |
| `fecho_proposta` | 7 | today only `declaracao_veracidade`; grows if D1 goes ahead |

**1:N children:** `nacionalidade`, `email_newsletter` and `area_interesse` (step 5, both
chips). `residencia_fiscal_adicional` and `beneficiario_efetivo` stay in the schema but with no
UI until there are screenshots of the Company path (A18/A19).

---

## Documents, signature, consents

```ts
export const documento = pgTable('documento', {
  id: id(),
  processoId: uuid('processo_id').notNull().references(() => processoOnboarding.id),
  tipo: tipoDocumento('tipo').notNull(),
  nomeOriginal: text('nome_original').notNull(),
  mime: text('mime').notNull(),
  tamanhoBytes: integer('tamanho_bytes').notNull(),
  hashSha256: char('hash_sha256', { length: 64 }).notNull(),
  chaveStorage: text('chave_storage').notNull(),   // private bucket, always
  validade: date('validade'),                      // 60-day alerts
  carregadoPor: uuid('carregado_por').references(() => utilizador.id), // null = client
  extra, ...timestamps, ...softDelete,
}, (t) => [index('documento_processo').on(t.processoId), index('documento_validade').on(t.validade)])

export const assinatura = pgTable('assinatura', {
  id: id(),
  processoId: uuid('processo_id').notNull().unique().references(() => processoOnboarding.id),
  tipo: tipoAssinatura('tipo').notNull().default('simples'),
  imagemChave: text('imagem_chave'),               // squiggle in private storage
  hashDocumento: char('hash_documento', { length: 64 }).notNull(),  // SHA-256 of the PDF
  documentoId: uuid('documento_id').references(() => documento.id), // the generated case file
  ip: inet('ip').notNull(),
  userAgent: text('user_agent').notNull(),
  assinadoEm: timestamp('assinado_em', { withTimezone: true }).notNull(), // SERVER clock
  metadados: jsonb('metadados').default({}),       // room for a future QTSP
  ...timestamps,
})

export const consentimento = pgTable('consentimento', {
  id: id(),
  processoId: uuid('processo_id').notNull().references(() => processoOnboarding.id),
  finalidade: finalidade('finalidade').notNull(),
  textoLegalId: uuid('texto_legal_id').notNull().references(() => versaoTextoLegal.id),
  aceite: boolean('aceite').notNull(),
  aceiteEm: timestamp('aceite_em', { withTimezone: true }).notNull(),
  ip: inet('ip').notNull(),
  userAgent: text('user_agent').notNull(),
  revogadoEm: timestamp('revogado_em', { withTimezone: true }),
  ...timestamps,
}, (t) => [uniqueIndex('consentimento_unico').on(t.processoId, t.finalidade, t.textoLegalId)])

export const versaoTextoLegal = pgTable('versao_texto_legal', {
  id: id(),
  chave: text('chave').notNull(),        // 'rgpd.marketing', 'termos_condicoes'
  versao: text('versao').notNull(),      // '2026-07-31.1'
  conteudo: text('conteudo').notNull(),  // the exact text presented
  hash: char('hash', { length: 64 }).notNull(),
  vigenteDesde: timestamp('vigente_desde', { withTimezone: true }).notNull(),
  ...timestamps,
}, (t) => [uniqueIndex('texto_chave_versao').on(t.chave, t.versao)])
```

**`versao_texto_legal` is my addition to §4.** The brief says "each consent records the exact
version of the text presented […] because in 4 years' time we have to be able to prove what the
person saw". Storing a version string only proves the label; storing the whole text on every
consent row duplicates megabytes. An immutable versions table, referenced by FK, proves the
content and duplicates nothing. Recorded here as rule 8 requires.

`nota` is trivial: `processo_id`, `autor_id`, `conteudo`, timestamps. Never visible to the
client — and that is guaranteed in the query, not in the component.

---

## `evento_auditoria` — the sacred piece

```ts
export const eventoAuditoria = pgTable('evento_auditoria', {
  id: id(),
  organizacaoId: uuid('organizacao_id').notNull(),
  processoId: uuid('processo_id'),
  atorId: uuid('ator_id'),                  // null = client via the magic link
  acao: text('acao').notNull(),             // 'processo.aprovado', 'documento.descarregado'
  entidade: text('entidade').notNull(),
  entidadeId: uuid('entidade_id'),
  valorAnterior: jsonb('valor_anterior'),
  valorNovo: jsonb('valor_novo'),
  ip: inet('ip'),
  userAgent: text('user_agent'),
  hashAnterior: char('hash_anterior', { length: 64 }),
  hash: char('hash', { length: 64 }).notNull(),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('auditoria_processo').on(t.processoId, t.criadoEm),
  index('auditoria_ator').on(t.atorId, t.criadoEm),
])
```

**Chaining:** `hash = sha256(hash_anterior || id || acao || entidade || entidade_id ||
valor_anterior || valor_novo || ator_id || criado_em)`, with canonical serialisation (JSON with
sorted keys). The chain is **per organisation** — a global chain would serialise every write in
the system through a single point of contention.

**Real immutability, in SQL, not in application code** — dedicated migration:

```sql
REVOKE UPDATE, DELETE, TRUNCATE ON evento_auditoria FROM app_user;

CREATE RULE evento_auditoria_sem_update AS ON UPDATE TO evento_auditoria DO INSTEAD NOTHING;
CREATE RULE evento_auditoria_sem_delete AS ON DELETE TO evento_auditoria DO INSTEAD NOTHING;
```

The `REVOKE` is the real defence; the `RULE`s catch the case of someone running with a
privileged role by mistake. The chain verification script (`pnpm auditoria:verificar`) re-reads
everything in order and recomputes — it is a §9 acceptance criterion.

**Retention vs. erasure (§0).** The right to erasure cannot delete what Lei 83/2017 requires to
be kept for 7 years. The design: `apagado_em` on the section tables hides it from the
application; a purge routine only actually removes it 7 years after the end of the business
relationship; `evento_auditoria` is never touched — it records who requested the erasure, not
the erased data. **This needs your legal validation before Phase 1**, it is not a technical
decision.

---

## Search and RLS

**Portuguese full-text with `unaccent`** — `unaccent` is not immutable, so it cannot go
directly into a generated column. The route is a dedicated text configuration:

```sql
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE TEXT SEARCH CONFIGURATION pt_unaccent (COPY = portuguese);
ALTER TEXT SEARCH CONFIGURATION pt_unaccent
  ALTER MAPPING FOR hword, hword_part, word WITH unaccent, portuguese_stem;
```

And `processo_onboarding.pesquisa` maintained by a trigger over name + tax number + reference
(a generated column will not do because the sources are in other tables).

**RLS** — enabled on every table with client data, with `current_setting('app.utilizador_id')`
set per transaction. The policies follow the §6 roles, with the `assistente` one explicitly
denying `declaracao_ppe` and the source-of-funds columns. Guards in the application **as
well**, as the brief requires: two layers.

> Possible blocker note: **Neon vs. Supabase.** RLS via `SET LOCAL` works on both, but Supabase
> brings integrated auth+storage that partly collides with Better Auth + UploadThing. If
> storage is Supabase, it is worth discussing; if it is R2/S3, it makes no difference and Neon
> is simpler. Needs a decision before Phase 1.

---

## Dependencies to approve (rule 7)

| Package | Why | Alternative if you decline |
|---|---|---|
| `uuidv7` (~2 kB) | §4 requires UUID v7. Postgres only has native `uuidv7()` in v18; Neon and Supabase are on earlier versions. | `gen_random_uuid()` (v4) — loses time ordering and index locality |
| `signature_pad` | Signature canvas for step 7. It is in §2 as a reference but not in §1 as part of the stack. | — |

Nothing else outside §1.
