# PROMPT — Legal Matter Platform · Module 1: Client Onboarding

> Before you start, put the 7 screenshots in `docs/onboarding-screens/` — Claude Code must read them and validate each field against the corresponding image.

---

## 0. Context

I am building an internal platform to centralise the matters of a law firm / legal consultancy (PMF Consulting). Today, client onboarding lives in a scattered form and the information does not end up accessible in a structured way.

**Scope of this first delivery: the Onboarding module only.** No billing, matter management, timesheets or calendar. But the architecture has to assume those modules are coming — this is a modular platform, not a single-form app.

**Non-negotiable requirement:** there has to be a back-office where I can view, filter, open and manage every submitted record. A form that only sends an email will not do.

**Nature of the domain:** this is KYC/AML. It is subject to Lei 83/2017 (prevention of money laundering and terrorist financing), Bar Association Regulation 2/2020 and the GDPR. Concrete technical implications: immutable audit trail, minimum 7-year retention, especially sensitive data (PEP, source of funds), consents with date/time evidence, and a right to erasure that **cannot** delete what the law requires to be kept. Treat this as a functional requirement, not as a footer disclaimer.

---

## 1. Stack

Use exactly this, unless you hit a real blocker (in which case ask before swapping):

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 15+ (App Router) + TypeScript strict** | Server Actions avoid half the API layer; RSC gives us server-side tables effortlessly |
| UI | **Tailwind CSS + shadcn/ui** | Components we own in the repo, not a dependency we cannot change |
| Forms | **React Hook Form + Zod** | A single Zod schema per step, shared between client and server |
| Database | **PostgreSQL** (Neon or Supabase) | We need JSONB, RLS and Portuguese full-text search |
| ORM | **Drizzle ORM** + drizzle-kit migrations | Versioned migrations in readable SQL — important for auditing |
| Auth | **Better Auth** (or Auth.js if you prefer) with email+password, TOTP MFA and DB sessions | Lawyers with mandatory MFA |
| Tables | **TanStack Table v8** with server-side pagination/sorting/filtering | Volume will grow; never load everything on the client |
| URL state | **nuqs** | Back-office filters shareable by link |
| Files | **UploadThing** or S3/R2 with short-lived signed URLs | Identification documents never in a public bucket |
| PDF | **pdf-lib** (assembly) + **@react-pdf/renderer** (generation) | Final signed case file |
| Email | **Resend** + React Email | Invitations, reminders, confirmations |
| PT validation | Implement it yourself (tax number mod-11, IBAN mod-97, postcode) | The existing libraries are one-star; the algorithm is 15 lines |
| Tests | Vitest (unit) + Playwright (E2E of the complete flow) | The 7-step flow has to have an E2E that walks it end to end |
| i18n | `next-intl` — **pt-PT as default**, EN as second locale | International clients always show up |

A monorepo is not needed. Single app, `pnpm`.

---

## 2. Reference GitHub repositories

Do not clone any of them as the project base. Scaffold clean and take specific patterns from each:

**Back-office base**

- `Kiranism/next-shadcn-dashboard-starter` (6.7k ⭐) — **the main reference.** Next.js + shadcn + TanStack. Copy the layout structure (sidebar, breadcrumbs, command palette) and the parallel routes pattern.
- `satnaing/shadcn-admin` (12.7k ⭐) — better navigation system and per-folder feature organisation. Steal the `features/` architecture.
- `arhamkhnz/next-shadcn-admin-dashboard` (2.8k ⭐) — good example of multi-preset theming.

**Record tables (the critical requirement)**

- `sadmann7/tablecn` (6.2k ⭐) — **study this one seriously.** Data table with advanced filters, server-side sorting and pagination with state in the URL. It is exactly what I need in the matter listing.
- `openstatusHQ/data-table-filters` (2.1k ⭐) — faceted filters + infinite scroll. Steal the faceted-filters-with-counts pattern.

**Digital signature**

- `documenso/documenso` (14.2k ⭐) — **the compliance reference.** PAdES, certificates, audit trail. Either we integrate via a self-hosted API, or we copy the `Document`/`Recipient`/`Field`/`AuditLog` data model.
- `docusealco/docuseal` (18.1k ⭐) — better UX for placing fields on the PDF. It has a REST API and a Docker image — the fastest route if we want to integrate rather than build.
- `OpenSignLabs/OpenSign` (6.7k ⭐) — alternative with an explicit legaltech focus.
- `szimek/signature_pad` (12k ⭐) — handwritten signature canvas. For the simple step 7 signature in v1.

**Multi-step forms / data capture**

- `formbricks/formbricks` (12.7k ⭐) — study how they model `Survey → Question → Response` with answers in JSONB and conditional logic. Our onboarding will need conditional logic (individual vs. company, PEP yes/no).

**Architecture decision I want you to make in Phase 0 and present to me:** build the signature in-house with `signature_pad` + `pdf-lib`, or integrate self-hosted DocuSeal via API. Give me pros/cons in 10 lines before writing code.

---

## 3. Design direction

I do not want a generic dashboard. I want it to look like a serious piece of legal software — sober, dense, precise, with the authority of an official document.

**Mental reference:** a case file dossier. Spine, numbered tabs, stamps, references typeset in mono. It is not decoration — each element encodes real state.

### Tokens

```css
--tinta:        #101A24;  /* primary text, sidebar */
--tinta-suave:  #5C6672;  /* secondary, labels */
--papel:        #EDEFEA;  /* background — archive paper, not cream */
--papel-alto:   #FFFFFF;  /* elevated surfaces, cards */
--selo:         #8C2F39;  /* stamp crimson — destructive actions, critical state */
--arquivo:      #2F5D50;  /* archive green — validated, approved */
--latao:        #A9884F;  /* brass — pending, attention, fine details */
--linha:        #D6DAD2;  /* rules and dividers, 1px, always */
```

Forbidden: cream #F4F1EA with a high-contrast serif and a terracotta accent. It is the default of any AI-generated dashboard in 2026 and it reads as such.

### Typography

- **Display:** `Instrument Serif` or `Newsreader` — section titles and matter numbers. With restraint: H1/H2 only.
- **Body:** `Inter Tight` — forms, tables, everything else.
- **Mono:** `IBM Plex Mono` — matter references, tax numbers, IBANs, hashes, audit timestamps. Any identifier is mono. This is a rule, not a suggestion.

Type scale defined in `globals.css` with `clamp()`. High information density: `text-sm` as the base in tables, not `text-base`.

### Signature element: the matter spine

A fixed vertical column to the left of the onboarding form representing the dossier: the 7 numbered steps (numbering is justified here — it is a real and mandatory sequence), each with its own state. When a step is validated and saved it receives a **stamp** — a circular seal in `--selo` at 8% opacity, with the date/time in mono inside it, applied with a 180ms micro-animation (2–3° rotation, like a real stamp hitting paper). It is the only animation moment with weight in the application. Everything else is immediate and silent.

In the record listing, the same vocabulary: each matter shows the reference in mono (`PMF-2026-0142`) and how many of the 7 stamps it already has.

### Quality floor

Responsive down to mobile (lawyers open this on their phones). Visible keyboard focus on every interactive element. `prefers-reduced-motion` respected — no animated stamp. AA contrast minimum. The client form has to work on 360px screens.

### Interface writing

European Portuguese, professional but human register. Buttons say what they do: "Guardar e continuar", not "Submeter". Errors explain what failed and how to fix it: "O NIF tem de ter 9 dígitos e começar por 1, 2, 3, 5, 6, 8 ou 9", not "Valor inválido". Empty states invite action.

(The UI copy examples above are quoted verbatim in Portuguese: all client-facing text stays in
European Portuguese.)

---

## 4. Data model

Design the Drizzle schema from this. Everything with a UUID v7 `id`, `created_at`, `updated_at`, and soft delete where the law requires retention.

```
organizacao          — multi-tenant from day 1 (the firm; others later)
utilizador           — lawyers, assistants, admin
processo_onboarding  — the central entity
  ├─ referencia (PMF-{year}-{sequence}, unique per organisation)
  ├─ tipo_cliente (particular | empresa)
  ├─ estado (rascunho | submetido | em_revisao | pendente_cliente | aprovado | rejeitado | arquivado)
  ├─ passo_atual (1..7)
  ├─ responsavel_id → utilizador
  ├─ nivel_risco (baixo | medio | elevado)  ← computed, see §6
  ├─ token_acesso_cliente (for the magic fill-in link)
  ├─ expira_em
  └─ submetido_em, aprovado_em, aprovado_por

dados_identificacao   } one table per section, 1:1 with the matter.
dados_fiscais         } Do not put everything in one giant JSONB — we need to
representante_legal   } search by tax number, filter by PEP, index the name.
declaracao_ppe        } Genuinely variable fields go into an
consentimento_rgpd    } `extra JSONB` column inside each table.
dados_faturacao       }
fecho_proposta        }

documento             — uploaded files (type, mime, size, SHA-256 hash, storage key, expiry)
assinatura            — step 7 signature (image/certificate, IP, user-agent, hash of the signed doc)
consentimento         — each consent is its own row (purpose, text version, date, IP, revoked_at)
nota                  — internal notes per matter, with author and timestamp
evento_auditoria      — append-only, NEVER update or delete
```

**`evento_auditoria` is sacred.** Every read of sensitive data, state change, document download and consent produces a row: `{processo_id, ator_id, acao, entidade, valor_anterior, valor_novo, ip, user_agent, criado_em}`. No update, no delete — revoke those permissions at the Postgres level if you can. Chain by hash (each row includes the previous row's hash) so the record is verifiably intact.

---

## 5. The onboarding flow — 7 steps

**Read each screenshot in `docs/onboarding-screens/` before implementing the corresponding step and validate the fields against the image.** What follows is the skeleton and the rules; the image wins on the details.

Cross-cutting rules:

- Auto-save as a draft on each completed step. The client has to be able to leave and come back via the magic link.
- Zod validation per step, on the client and revalidated on the server. Never trust the client.
- Each step is its own route (`/onboarding/[token]/passo/[n]`), not in-memory state. A refresh must not lose data.
- Conditional fields appear/disappear based on earlier answers — with no abrupt layout jumps.

### Step 1 — Client identification

Client type (individual/company) — **this choice branches everything else in the flow**. Full name or legal name, date of birth, nationality, place of birth, marital status, occupation. Identification document: type (Citizen Card / Passport / Residence permit), number, expiry, issuing country. Full address with postcode validated in the `NNNN-NNN` format. Email and mobile with international dialling code.

*Upload:* identification document, front and back. Automatic warning if the expiry is less than 3 months away.

### Step 2 — Tax identification

Tax number (individual/corporate) with mod-11 checksum validation. Country of tax residence. Additional tax residences (CRS/FATCA) with a TIN per jurisdiction — dynamic array. For companies: CAE code, permanent certificate access code, VAT regime.

*Upload:* tax number proof / permanent certificate.

### Step 3 — Legal representative

Only relevant for companies or representation under a power of attorney — **conditional on step 1**. Name, capacity/role, identification document, tax number, contacts, scope of the representation powers. RCBE access code and identification of beneficial owners (dynamic list: name, tax number, % holding, nature of control).

*Upload:* power of attorney, appointment minutes, RCBE proof.

### Step 4 — PEP (Politically Exposed Person)

The most sensitive step. Are they a PEP? If so: office, country, entity, period held. Are they a close family member or a person with close ties to a PEP? If so: relationship and identification of the PEP. Source of funds and source of wealth (mandatory fields if PEP = yes). Formal declaration with explicit acceptance.

**Business rule:** PEP = yes forces `nivel_risco = elevado`, requires approval by a user with the partner/admin role, and blocks automatic approval. This is not optional — it is what the law requires.

### Step 5 — GDPR

**Granular and independent** consents, one checkbox per purpose — never a single "I accept everything". Separate purposes: provision of the legal service, compliance with legal obligations, billing, marketing communications (isolated opt-in, never pre-ticked). Information about retention periods, data subject rights and DPO contact. Each consent records the exact version of the text presented, date/time, IP — because in 4 years' time we have to be able to prove what the person saw.

### Step 6 — Billing details

Billing legal name and tax number (with a "same as tax details" option that copies), billing address, email for sending invoices, payment terms and frequency, IBAN validated by mod-97 displayed in mono and spaced in groups of 4, client's internal reference/PO.

### Step 7 — Closing, T&C and digital signature

Proposal summary (contracted services, fee model, amounts). Acceptance of the Terms and Conditions with mandatory scrolling to the end before the checkbox activates. Acceptance of the proposal. Digital signature.

On submission: generate the PDF of the complete case file (all steps + attached documents + signature page), compute SHA-256, record it in `assinatura` with IP, user-agent and server timestamp (never the client's), email a copy to the client and notify the internal owner.

---

## 6. Back-office — the records

This is the half of the application that is not in the screenshots and the one I care about most.

**`/processos` — listing**

Server-side TanStack Table. Columns: reference (mono), client, type, state (badge), risk level, owner, progress (7 stamps), submitted at, last activity. Faceted filters with counts: state, client type, risk level, owner, date range, PEP yes/no. Global search by name, tax number and reference (Portuguese full-text with `unaccent`). Filter state in the URL via nuqs. Bulk actions: assign owner, export, archive. CSV and PDF export — **every export writes to the audit log**.

**`/processos/[id]` — detail**

Header with reference, client, state, risk level and actions. Tabs: Data (the 7 sections, each expandable and editable by those with permission, with a field-by-field change history), Documents (inline preview, download with a signed URL and an audit record, expiry alerts), Audit (complete, immutable, filterable timeline), Notes (internal, never visible to the client).

Review flow: approve, reject with a mandatory reason, return to the client indicating the fields to correct (generates a new magic link and an automatic email).

**`/` — dashboard**

Counts by state, matters stalled for more than X days, identification documents expiring in the next 60 days, high-risk matters awaiting approval, recent activity. No decorative charts — only what makes me act.

**Risk engine** (`lib/risco.ts`, a pure and tested function): PEP, high-risk jurisdiction, opaque corporate structure, document close to expiry, missing data. Returns level + the factors that justify it. Always show the *why* next to the level, never just the badge.

**Roles:** `admin` (everything, including user management), `socio` (everything on matters, the only one who approves high risk), `advogado` (assigned matters + create), `assistente` (create and edit, does not approve, does not see PEP or source of funds). Enforce with Row Level Security in Postgres **and** guards in the application. Two layers.

---

## 7. Folder structure

```
src/
  app/
    (auth)/                    login, mfa, recovery
    (backoffice)/              layout with sidebar
      page.tsx                 dashboard
      processos/
      processos/[id]/
      definicoes/
    (cliente)/
      onboarding/[token]/      public flow authenticated by token
    api/
  features/                    ← organise by domain, not by file type
    onboarding/                schemas/, componentes/, actions/, queries/
    processos/
    documentos/
    auditoria/
    risco/
  components/ui/               shadcn
  components/                  app-wide shared (Carimbo, RefProcesso, EstadoBadge…)
  db/                          schema/, migrations/, index.ts
  lib/                         validacao-pt.ts, auth.ts, storage.ts, pdf.ts, email.ts
docs/
  onboarding-screens/          the 7 screenshots
  BRIEF.md                     this file
CLAUDE.md
```

---

## 8. Execution plan

Do not write code before Phase 0 is validated with me.

**Phase 0 — Analysis.** Read the 7 screenshots. Produce `docs/CAMPOS.md` with the complete field-by-field inventory: name, type, mandatory status, validation, conditionality, and which table it belongs to. Clearly mark what is ambiguous in the image. Propose the Drizzle schema. Give me the recommendation on the digital signature (§2). **Stop and wait for approval.**

**Phase 1 — Foundations.** Scaffold, Tailwind + shadcn, §3 design tokens, back-office layout, auth with MFA, schema + migrations, development seeds.

**Phase 2 — Onboarding flow.** The 7 steps, Zod schemas, automatic draft saving, conditional logic, uploads, the spine with stamps. Playwright E2E of the complete individual and company paths.

**Phase 3 — Back-office.** Listing with filters, detail with tabs, review flow, risk engine, audit trail, permissions and RLS.

**Phase 4 — Closing.** Case file PDF generation, signature, transactional emails, exports, dashboard.

At the end of each phase: `pnpm build` clean, `pnpm test` green, and a summary of what was done and what is left to decide.

---

## 9. Acceptance criteria

- [ ] A client completes the 7 steps on a 360px phone, leaves halfway, comes back via the link and loses nothing.
- [ ] The "company + PEP" path asks for a legal representative, beneficial owners and source of funds, and flags high risk.
- [ ] The "individual + non-PEP" path skips step 3 without leaving it in a confusing limbo.
- [ ] Invalid tax numbers, IBANs and postcodes are rejected with a message that says how to fix them.
- [ ] No document is accessible via a public URL. Every download is recorded.
- [ ] `evento_auditoria` accepts neither UPDATE nor DELETE, and the hash chain is verifiable by a script.
- [ ] An `assistente` cannot see step 4, neither by direct URL nor by API call.
- [ ] I can filter the listing by "high risk + awaiting approval", share that URL, and a colleague sees the same thing.
- [ ] The final PDF contains the 7 sections, the attachments and the signature page with hash and timestamp.
- [ ] `pnpm build` with no TypeScript errors. `strict: true`, zero `any`.

---

## 10. Rules for you, Claude Code

1. **Ask before assuming.** If a field in the screenshot is ambiguous, list the ambiguity instead of inventing.
2. **No fictional data in production.** Seeds only in `db/seed.dev.ts`, with a `NODE_ENV` guard.
3. **Server Actions with Zod validation on the server, always.** Client validation is UX; server validation is security.
4. **Secrets only in `.env`,** `.env.example` documented, never committed.
5. **Small, descriptive commits in Portuguese,** one per logical unit.
6. **Keep `CLAUDE.md` up to date** with architecture decisions and commands, as you go.
7. **Do not install dependencies that are not in §1** without explaining why to me.
8. **When you make a design choice not covered by §3, say what it was and why** in one line.
