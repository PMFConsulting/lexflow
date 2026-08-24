# Architecture — Legal Matter Platform

Reference document for every phase: what exists, what is missing, and **why** each
piece is the way it is. The individual decisions live in `CLAUDE.md`; the complete
design is here.

Last revised: 1 August 2026.

---

## 1. What this is

Internal platform for **PMF Consulting**, a law firm, for client onboarding under
the identification and due diligence duties of **Lei 83/2017** (money laundering
and terrorist financing), **Bar Association Regulation 2/2020** and the **GDPR**.

Two halves, with opposite audiences and rules:

| | Client | Firm |
|---|---|---|
| Who gets in | anyone with the link | authenticated user |
| How they authenticate | single-use token in the URL | email + password, DB session |
| What they can do | fill in their own matter | view, filter, review, approve |
| Where it lives | `src/app/(cliente)/` | `src/app/(backoffice)/` |

Splitting into route groups is not file organisation: they are different security
surfaces, and mixing them is how data leaks happen.

---

## 2. Status by phase

| Phase | Scope | Status |
|---|---|---|
| 0 | Analysis: field inventory, ambiguities, data model | **complete** |
| 1 | Foundations: schema, migrations, auth, design tokens, dashboard | **complete, in production** |
| 2 | Onboarding flow: 7 steps, conditionals, signature | **complete, in production** |
| 3 | Back-office: listing, detail, review, risk engine, RLS | not started |
| 4 | Closing: case file PDF, emails, exports | outside current scope |

Production address: **https://poc.terlicalabs.com**

---

## 3. How it is assembled

```
┌─ Cloudflare ────────── DNS, wildcard *.terlicalabs.com, proxy off
│
└─→ Hostinger VPS KVM 1 (Ubuntu 24.04, EU)
    │
    ├─ Coolify ─────────── deploy on every git push, automatic TLS
    │
    ├─ Traefik ─────────── routes by domain, Let's Encrypt
    │
    ├─ law-project ─────── Next.js 16, 3-stage Docker image
    │                      migrates at startup; if it fails, it does not come up
    │
    ├─ PostgreSQL ──────── no published port, Docker internal network only
    │
    └─ terlicalabs ─────── marketing site (separate repository)
```

**Why a VPS and not Vercel:** the Hobby plan forbids commercial use and Pro is
€20/month per project. A small fixed cost that does not grow with the number of
clients is a better deal for POCs.

**Why Postgres on the server itself and not Supabase:** the free plan suspends after
7 days without use, which is exactly the pattern of a POC shown once a fortnight.

**Why an EU provider:** this stores identification documents and PEP declarations. A
US provider brings Cloud Act exposure even with a European datacenter.

Step-by-step guide in [`DEPLOY.md`](DEPLOY.md).

---

## 4. Application layers

```
src/
  app/
    (cliente)/onboarding/[token]/     public flow, authenticated by token
    (backoffice)/                     dashboard, authenticated by session
    api/auth/[...all]/                Better Auth
  features/                           organised by domain, not by type
    onboarding/  schemas · passos · dados · acoes · componentes
    processos/   creation and magic link
    auditoria/   chained hash and writes
  components/    shared visual vocabulary
  db/            schema · migrations
  lib/           validacao-pt · token · auth
```

**Why `features/` by domain:** when you touch onboarding, you touch one place. The
alternative — folders by file type — forces you to jump between four directories for
a single change.

### The path of a saved step

```
Form (client)
  └─ Zod validates ............. convenience: immediate errors
       └─ Server Action
            ├─ revalidates the token .. it is a public endpoint like any other
            ├─ Zod again ............. security: the client is never the source of truth
            ├─ section upsert
            ├─ business rules ........ PEP → high risk
            └─ audit event
```

Validation runs twice on purpose, with **the same schema file** on both sides. That is
what prevents the classic mistake of tightening the form and leaving the action open.

---

## 5. Data model

27 tables. The section tables are 1:1 with the matter, one per step.

```
organizacao ──┬── utilizador
              ├── contador_referencia      atomic per-year sequence
              └── processo_onboarding ─────┬── dados_identificacao ── nacionalidade (1:N)
                                           ├── dados_fiscais ─────── residencia_fiscal_adicional
                                           ├── representante_legal ─ beneficiario_efetivo
                                           ├── declaracao_ppe
                                           ├── relacao_negocio
                                           ├── preferencias_contacto ┬ email_newsletter
                                           │                         └ area_interesse
                                           ├── dados_faturacao
                                           ├── fecho_proposta
                                           ├── documento
                                           ├── assinatura
                                           ├── consentimento ──────── versao_texto_legal
                                           └── nota

evento_auditoria    append-only, hash-chained, outside the tree
```

**Why one table per section and not one giant JSONB:** we need to search by tax number,
filter by PEP and index the name. What gets searched is a column; only what is genuinely
variable goes into each table's `extra JSONB`.

**Why lists in 1:N tables:** global search has to find by a beneficial owner's tax number,
and that cannot be done inside a JSON array.

**UUID v7 ids generated in the application:** time-sortable, which gives index locality and
stable cursor pagination. Generated in code because Postgres only has native `uuidv7()` in
version 18. Practical consequence: any raw SQL `INSERT` has to supply the `id`.

---

## 6. Security and compliance

This section is the reason the project exists, not an appendix.

### Immutable audit trail

`evento_auditoria` is append-only and each row includes the previous row's hash. The chain
is **per organisation** — a global chain would serialise every write in the system through a
single point of contention.

Immutability lives in the database, not in a code convention:

```sql
CREATE RULE evento_auditoria_sem_update AS ON UPDATE TO evento_auditoria DO INSTEAD NOTHING;
CREATE RULE evento_auditoria_sem_delete AS ON DELETE TO evento_auditoria DO INSTEAD NOTHING;
REVOKE UPDATE, DELETE, TRUNCATE ON evento_auditoria FROM app_user;
```

Verified in production: `UPDATE` and `DELETE` return **zero rows affected**.

> **Known hole.** The `REVOKE` does not bite while the application user is also the table
> owner — and the owner always bypasses it. Only the `RULE`s protect. Creating a distinct
> `app_user` role closes this. Recorded as pending, not resolved.

Serialisation is **canonical**: keys sorted at any depth. Without that, the same object
serialised via two paths yields different hashes and the chain looks tampered with when it
is not.

### Magic link token

Stored only as SHA-256. The plaintext value exists once, on the creation screen. Anyone with
read access to the database does not end up with the key to every case file. Comparison is
constant-time, so response timing cannot be used to guess the token byte by byte.

Failures — wrong token, deleted matter, expired link — always return the same response.
Distinguishing "does not exist" from "expired" would tell a guesser they had hit one.

### Signature

**Simple** electronic signature. What counts as evidence is not the drawing: it is the
combination of who signed, from which address, at what time on the **server clock** — never
the client's — and over exactly which content. `hash_documento` is the SHA-256 of the entire
case file in canonical serialisation at the moment of signing. Changing a field after that
makes the hash stop matching.

Neither this approach nor integrating DocuSeal would produce a **qualified** signature: that
requires a QTSP (Chave Móvel Digital, Cartão de Cidadão). The full reasoning is in
[`DECISAO-ASSINATURA.md`](DECISAO-ASSINATURA.md).

> **POC compromise.** The signature squiggle is stored as base64 in the
> `assinatura.imagem_dados` column. The right answer is a private bucket with the key in the
> database. It holds for a POC, it does not hold at scale.

### Sensitive data

Step 4 — PEP and source of funds — is the most sensitive information in the system.
`assistente` cannot see it, neither by direct URL nor by API call. The rule exists in the
design; **the per-role guards land in Phase 3**.

A declared PEP forces `nivel_risco = elevado` and blocks automatic approval. It is not
configurable: it is what the law requires.

### Retention

The right to erasure cannot delete what Lei 83/2017 requires to be kept for seven years. The
design: `apagado_em` hides it from the application, a purge routine only actually removes it
after the seven years, and `evento_auditoria` is never touched — it records who requested the
erasure, not the erased data.

**Needs legal validation.** It is not a technical decision.

---

## 7. The onboarding flow

Seven steps, each on its own route (`/onboarding/[token]/passo/[n]`). State lives in the
database, not in memory: a refresh loses nothing and the client returns to the step where
they left off.

| # | Step | Conditional |
|---|---|---|
| 1 | Identification | branches individual/company — decides everything else |
| 2 | Tax + identification document | company fields only for companies |
| 3 | Legal representative | **company or power of attorney only** |
| 4 | PEP + business relationship | PEP details only when answering Yes |
| 5 | Contact preferences | fields depending on newsletter and invitations |
| 6 | Billing | — |
| 7 | Final declaration + signature | review of everything before submitting |

A step that does not apply is **skipped**, it does not error — anyone typing the URL by hand
or using the back button carries on. On the spine it appears struck through rather than
disappearing, so it reads as skipped and not lost.

### Divergences from the current form

PMF's existing form diverges from the brief on scope-level points, all recorded in
[`CAMPOS.md`](CAMPOS.md) §D. The three that weigh most:

1. The real step 7 **did not have** T&C, proposal acceptance or a signature.
2. The real step 5 **is not GDPR** — it is marketing capture. Granular consents with evidence
   remain to be built.
3. The identification document lives at **step 2**, not step 1.

---

## 8. Interface

Vocabulary of the **case file dossier**: spine, numbered tabs, stamps, monospaced identifiers.
It is not decoration — each element encodes real state.

| Token | Use |
|---|---|
| `--tinta` `#101A24` | text and sidebar |
| `--papel` `#EDEFEA` | background, archive paper |
| `--selo` `#8C2F39` | stamp, destructive, critical |
| `--arquivo` `#2F5D50` | validated, approved |
| `--latao` `#A9884F` | pending, attention, focus |

Three families: `Instrument Serif` only in H1/H2, `Inter Tight` for body text,
`IBM Plex Mono` for **any identifier** — reference, tax number, IBAN, hash, timestamp. A rule,
not a suggestion.

The **stamp** is the only animation moment with weight: 180 ms, 2.5° rotation, applied to the
step that has just been saved. With `prefers-reduced-motion` it does not happen.

### Mobile

Lawyers open this on their phones, and clients fill it in there.

- The spine lies down as a horizontal ribbon with a progress bar
- Action bar pinned to the bottom, with `env(safe-area-inset-bottom)`
- Fields at **16px**: below that, iOS Safari zooms on its own and knocks the page out of
  alignment — that alone ruins a seven-step form
- Finger signature, with the canvas resized by the screen's pixel ratio
- Zero horizontal scroll at 360px

---

## 9. Tests

| Layer | What |
|---|---|
| Unit | PT validations (tax number mod-11, IBAN mod-97, postcode, phone) — 21 |
| Unit | hash chain: determinism, canonical ordering, tamper detection — 8 |
| Migrations | `pnpm db:validar` applies everything to a Postgres in WASM and proves the audit trail refuses `UPDATE`/`DELETE` and that search resolves accents |
| Production | complete run of both paths, done by hand against the real database |

**Missing:** Playwright E2E for both paths. It is what is needed for this to stop depending on
somebody remembering to test.

---

## 10. What is missing, in order of importance

1. **Phase 3 — back-office.** Listing with filters and the matter detail. Without it, matters
   come in and nobody manages them.
2. **Per-role guards + RLS.** The rule that `assistente` does not see PEP data exists in the
   design and not in the code.
3. **`app_user` role** separate from the owner, so the audit `REVOKE` bites.
4. **GDPR consents with evidence** — text version, date/time, IP.
5. **Document uploads.** The table exists, the interface does not.
6. **Playwright E2E.**
7. **Beneficial owners and RCBE.** Legal obligation, schema ready, no UI.
8. **Legal validation** of the 7-year retention.
9. **Object storage** for the signature squiggle and the documents.
10. **Screenshots of the Company path** — it was built from the brief text, with no image to
    validate against. Rework risk accepted.

---

## 11. Commands

```bash
pnpm dev                  # development
pnpm build                # must pass clean
pnpm typecheck            # strict, zero any
pnpm test                 # Vitest
pnpm db:generate          # new migration from the schema
pnpm db:migrate           # apply
pnpm db:validar           # apply everything to a Postgres in WASM and verify
pnpm db:seed              # development only
pnpm auditoria:verificar  # revalidate the hash chain
```
