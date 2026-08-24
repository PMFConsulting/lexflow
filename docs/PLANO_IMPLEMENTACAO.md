# Implementation Plan — Legal Matter Platform

> **Goal:** take the platform from POC (`poc.terlicalabs.com`) to production, roll it out for the law firm and switch on customer service. Working document — implementation only (commercial figures are in the proposal).
>
> Basis: proposal v2 (stock fee €1,500/500 users) · Section 06 of the proposal · Risks R1/R5/R6 from that document.

---

## 1. Starting point (what already exists)

| Area | Status |
|---|---|
| Next.js 16 app (App Router, TS strict, Drizzle + Postgres) | ✅ in production on the POC |
| Client onboarding flow (single-use token) | ✅ 7 steps + conditionals |
| Back-office (listing, detail, review) | ✅ in production |
| PT validations (tax number, IBAN, postcode, phone) | ✅ tested |
| Immutable audit trail + PT full-text search | ✅ |
| Better Auth authentication (email+password, DB sessions) | ✅ no MFA |
| Tests | ✅ 347/347 green · typecheck clean |
| Transactional email | ✅ Resend→Mailjet→Brevo→SMTP (cascade) — Twilio SendGrid still missing |
| Multi-firm (table `organizacao`, `utilizador` with `organizacao_id`) | ❌ **real defect: `listarProcessos()` does not filter by `organizacaoId`** (cross-tenant) + no RLS |
| Document storage | ⚠️ SFTP via curl + base64 in the DB (4 MB) — migrate to AWS S3 |
| Customer service (chatbot, tickets, knowledge base) | ❌ still to be built (zero code) |
| User management | ⚠️ CLI only (`criar_utilizador.mjs`); no UI, no deactivate/reactivate |
| Backups + port 8000 | ❌ no backups · port 8000 open (runbook) |

---

## 2. Implementation phases (execution order)

### Phase 0 · Technical prerequisites (before production)
> Corresponds to risks R1 and R6 in the proposal. Without this, the multi-firm model and AWS S3 are not possible.

- [ ] **0.1 · Migrate documents from the DB to AWS S3** (R1)
  - Today: documents stored as base64 in the DB, 4 MB limit (`src/db/schema/documentos.ts`)
  - Target: AWS S3 `eu-central-1` (Frankfurt), private bucket, access via presigned URLs
  - Data migration: extraction script → upload → backfill of the paths
  - Verification: uploading a document > 4 MB works; reading via a presigned URL expires as expected
- [ ] **0.2 · Complete the multi-firm isolation** (R6) — **CRITICAL: real defect identified**
  - **Confirmed BUG:** `listarProcessos()` neither receives nor filters by `organizacaoId` (`src/features/processos/consultas.ts:25-53`), and is called without an org in `src/app/(backoffice)/processos/page.tsx:71` — one firm sees another firm's matters. Fix this first.
  - Confirm that ALL matter/document queries filter by `organizacao_id`
  - Implement RLS in Postgres (the app role owns the tables — known hole, `docs/INFRAESTRUTURA.md:217`)
  - Verification: 2 test firms cannot see each other's data (E2E test)

### Phase 1 · Platform production (weeks 1–2) · €435
- [ ] **1.1 · Production server in the EU (Lithuania)** — migrate from the current server to Lithuania, same price (Hostinger). Note: the runbook (`docs/INFRAESTRUTURA.md`) only says "EU" — confirm the real location of the current server before assuming the United Kingdom
- [ ] **1.2 · DNS** — point the final domain at the new server (zone in `infra/terlicalabs.com.zone`)
- [ ] **1.3 · TLS/HTTPS** — automatic certificates (Traefik/Let's Encrypt already configured in Coolify)
- [ ] **1.4 · Transactional email: Twilio SendGrid** — integrate as a sending channel (the proposal fixes Twilio SendGrid; Resend stays as the alternative/fallback channel — the current cascade already supports multiple channels)
- [ ] **1.5 · General configuration** — environment variables, final domain, full test in production
- [ ] **1.6 · Infrastructure security** — close port 8000 (Coolify panel) and enable backups (no backups today — `docs/INFRAESTRUTURA.md:218-220`)
- [ ] **1.7 · Load test before the 20 firms** (R5) — measure server capacity

### Phase 2 · Customer service production (weeks 3–4) · €435
- [ ] **2.1 · AI chatbot (level 1)** — assistant that answers within 24 business hours, cost ≈ €0.00052/conversation (already within the ≈ €67/year)
- [ ] **2.2 · Ticket engine (levels 2 and 3)** — tickets with states, priorities, SLAs, automatic escalation level 1 → 2 → 3
- [ ] **2.3 · Support email** — support inbox wired to the ticket engine
- [ ] **2.4 · Knowledge base** — articles reusable by the chatbot and by the team
- [ ] **2.5 · Hours pool** — per-ticket deduction mechanism (level 2: €25/h; level 3: €30/h ×1.2), 12-month balance, auditable hours

### Phase 3 · Firm rollout (48 h of work · included in the stock fee)
- [ ] **3.1 · Real data** — firm configuration (name, tax number, reference prefix, email domain)
- [ ] **3.2 · Users** — creation of accounts, roles and team permissions (SLA 48 business hours between request and credentials). Note: management today is CLI only (`scripts/criar_utilizador.mjs`) — assess a management UI (create/deactivate/reactivate) as part of the rollout
- [ ] **3.3 · Team training** — training session + internal documentation (there is no usage guide in the repo today)
- [ ] **3.4 · Onboarding of the first real matter** — end to end with real data

### Phase 4 · Ongoing maintenance (included in the fee)
- Updates, monitoring, fixes, tuning of the chatbot and the knowledge base — at no additional cost.

---

## 3. Technical notes (differences between the current code and the proposal)

1. **Email:** the proposal fixes **Twilio SendGrid** (€81.10/year, pay-as-you-go). The current code has Resend/Mailjet/SMTP in `src/lib/email.ts`. The SendGrid integration is a Phase 1.4 item. (NEVER our own Postfix/SMTP — decision on record.)
2. **Storage:** the proposal says **AWS S3** (€22.39/year). The code uses SFTP via `curl` (`src/lib/storage/servidor.ts`) + base64 in the DB (4 MB). Migrating to S3 is prerequisite R1 (Phase 0.1).
3. **Server upgrade:** KVM 2 → KVM 4 (≈ €301.45/year) above ~30 firms; it replaces the €155.88/year, it is not added to it. (Today: KVM 1 on the POC.)
4. **Email OTP (being validated with the Lawyers):** if confirmed, the flow goes from 4 to 5 emails per matter — email cost goes from €81.10 to ≈ €101.38/year (+€20.28). Integration into onboarding in Phase 1/3 once confirmed.
5. **MFA:** outside the POC scope cut (`src/lib/auth.ts:9-10`) — assess whether it enters the production scope (the stack planned in the README includes MFA).
6. **Current server:** the runbook only says "EU" (`docs/INFRAESTRUTURA.md:13-35`) — the proposal talks about migrating from the United Kingdom to Lithuania. Confirm the real location before Phase 1.1.

---

## 4. What is needed from the client / from us to get started

| Item | Who provides it | What for |
|---|---|---|
| Final domain (e.g. `lexflow.jmassano.pt` or similar) | Client | Phase 1.2 |
| Access to the domain's DNS | Client | Phase 1.2 |
| AWS account (S3 bucket `eu-central-1`) | Us (cost on the operation) | Phase 0.1 |
| Twilio SendGrid API key | Us | Phase 1.4 |
| List of team users (names, emails, roles) | Client | Phase 3.2 |
| Tax number/legal name for the firm configuration | Client | Phase 3.1 |
| OTP confirmation (compliance) | Client (Lawyers) | Note 4 |

---

## 5. Acceptance criteria (everything must pass before a phase is called done)

- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` green (347+ tests)
- [ ] `pnpm build` OK
- [ ] Playwright E2E test: desktop + mobile (390 px), 0 console errors
- [ ] Real navigation in Chrome (mouse + keyboard) — not just CDP
- [ ] Document upload/read via S3 (including > 4 MB)
- [ ] 2 isolated firms cannot see each other's data
- [ ] Level 1 → 2 → 3 ticket with escalation and correct deduction from the pool
- [ ] Independent verification (subagent) of each phase before communicating to the client
