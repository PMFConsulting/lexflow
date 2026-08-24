# Legal compliance assessment — JMASSANO POC

Code analysis performed by Opus 5 (direct reading of the repository, 19/08/2026).
Every statement carries a file path. Source: `src/` (features, db/schema, lib, app).

---

## 1. GDPR (Reg. 2016/679)

**✅ Present**
- Granular consents with evidence: `consentimento` (FK to `versao_texto_legal`, `aceite`, `aceite_em`, `ip`, `user_agent`, `revogado_em`) — `src/db/schema/legal.ts:42`. Versioned, immutable text with a SHA-256 hash — `legal.ts:22`.
- Newsletter and invitations are separate consents, with distinct texts and two independent writes — `src/features/onboarding/consentimentos.ts:26-37` and `src/features/onboarding/acoes.ts:382,390`. The `finalidade_consentimento` enum deliberately excludes service provision and legal obligation — `src/db/schema/enums.ts:73`.
- Revocation is modelled without deleting history — `consentimentos.ts:141-168`.
- Text lookup by key and version (D38) — `consentimentos.ts:58`.
- Security headers (HSTS, nosniff, X-Frame-Options, Referrer-Policy) — `next.config.ts:23`.
- Cookies: only strictly necessary ones (Better Auth session + `sidebar_state`, `src/components/ui/sidebar.tsx:27`). There is no tracking → a banner is not required.

**❌ Missing**
- Accepting the T&C and the proposal does not produce a row in `consentimento`. They are booleans in `fecho_proposta.tc_aceitacao` / `proposta_aceitacao` (`src/db/schema/seccoes.ts:264`). The enum has `termos_condicoes` and `proposta`, but the `TEXTOS` map in `consentimentos.ts:25` does not include them → they are never written, and `VERSAO_TERMOS` (`src/lib/termos.ts:18`) is not recorded anywhere in the DB. There is no way to prove which wording the client accepted. Module: `consentimentos.ts` + `acoes.ts` case 7.
- No privacy policy / article 13 notice presented before collection. There is no `/politica-privacidade`; the only text is clause 5 of the T&C (`termos.ts:59`), shown at step 7, after all the data has been collected.
- No channel for exercising data subject rights. No route, action or script for access, rectification, erasure, restriction, objection or portability. The client also has no way to withdraw the newsletter consent after submitting (the magic link expires after 30 days — `src/features/processos/acoes.ts:133`).
- 7-year retention not implemented. `softDelete()` only hides (`src/db/schema/_comum.ts:27`); there is no "end of business relationship" column, no job/cron, and no purge or anonymisation script. The T&C promise deletion at 7 years (`termos.ts:64`) — a promise with no execution today.
- No ROPA (article 30) and no DPIA (article 35). `docs/` has neither.
- No data protection officer and no privacy contact: `organizacao` only has name, tax number and prefix (`src/db/schema/organizacao.ts:14`).
- Processors without an article 28 contract and without a transfer assessment: channels `resend` / `brevo` / `mailjet` / `smtp` (`enums.ts:132`); Resend is a US entity and receives clients' names + emails.
- Minimisation: `email_log` (migration `0008`) stores recipients with no defined purge deadline.

**Priority: High** (privacy policy, rights, T&C consent, retention) · **Effort: 8–11 days**

---

## 2. Lei 83/2017 (anti-money laundering)

**✅ Present**
- Complete PEP declaration, including related PEPs and close family — `src/db/schema/seccoes.ts:164`; step 4 mandatory (`src/features/onboarding/passos.ts:36`).
- Source of funds and contracted services, always mandatory — `seccoes.ts:186`.
- Identification with a document (type, number, expiry), tax number with mod-11 — `seccoes.ts:68`, `src/lib/validacao-pt.ts`.
- Risk engine with PEP forcing high risk, and audited reset (`risco.elevado` / `risco.reposto`, `acoes.ts:314,331`).
- Legal representative mandatory for legal entities — `passos.ts:83`.
- Immutable audit trail supporting the record-keeping duty.

**❌ Missing**
- Beneficial owner with no UI. The table exists (`seccoes.ts:147`) and so does the `codigoRcbe` field (`seccoes.ts:135`), but no component writes them — `beneficiario` only appears in `db/schema`. For legal entities this is direct non-compliance with the identification duty (articles 23 and 30).
- No identity verification — the system collects the document but does not validate it against an independent source (permanent certificate, RCBE, sanctions/PEP lists). The duty is one of identification *and* verification (article 24).
- No record of suspicious transaction reporting (articles 43–45): no table, action or screen. There is also no record of refusal to enter a business relationship.
- No ongoing due diligence / periodic refresh (article 27): there is an index on `docValidade` and an alert planned, but no mechanism to review the data after N years.
- 7-year record keeping: foreseen in a comment, not executed.

**Priority: High** (beneficial owner, suspicious transaction reporting) · **Effort: 6–9 days**

---

## 3. eIDAS (Reg. 910/2014) / signature

**✅ Present**
- Simple electronic signature: PNG squiggle + SHA-256 of the case file in canonical serialisation + IP + user-agent + server clock — `src/features/onboarding/acoes.ts:412-434`, table `assinatura` in `src/db/schema/documentos.ts:63`.
- Mandatory reading of the T&C before the checkbox unlocks — `src/features/onboarding/componentes/LeitorTermos.tsx`.
- Hash-chained audit trail, append-only via `REVOKE` + `RULE` (migration `0002`), verifiable with `pnpm auditoria:verificar` (`scripts/verificar-auditoria.ts`).

**Legal assessment.** A simple signature is admissible (eIDAS article 25(1): it cannot be denied evidential effect solely because it is electronic) and adequate for accepting T&C and a fee proposal — no statutory written form is required here. Its evidential weight is freely assessed: in a challenge, the burden is on the firm. The audit chain + content hash is a solid base.

**❌ Missing**
- The hash is not time-sealed. Without a qualified timestamp (RFC 3161 / TSA), the proven date is the system's own — and whoever controls the server controls the clock. Module: new `lib/assinatura/timestamp.ts`, called in `acoes.ts` case 7.
- `hashDocumento` does not cover the T&C text or the proposal — only the case file sections (`seccoes.ts` via `seccoesDoProcesso`). Changing the wording after signature does not break the hash.
- For an advanced/qualified signature (needed if a power of attorney or an engagement contract with statutory form is ever signed): integration with Chave Móvel Digital (AMA) or a QTSP is missing. The schema is already prepared for an adapter (comment in `documentos.ts:58`).
- The client is not given a standalone signature receipt (the `summary.pdf` goes in the welcome email, but without the hash or the signature metadata).

**Priority: Medium** (High if there are documents with statutory form) · **Effort: 3 days (timestamp + extended hash); 8–12 days (CMD/QTSP)**

---

## 4. Bar Association Regulation 2/2020

**✅ Present**
- Differentiated roles with PEP data invisible to `assistente` — `src/lib/sessao.ts:43`, applied in `processos/page.tsx:41` and `processos/[id]/page.tsx:117`.
- Approval reserved to `admin`/`socio`/`advogado` — `sessao.ts:54`.
- Retainable audit record.

**❌ Missing**
- No compliance officer designated in the system (article 12 of the Regulation) — there is no field, role or screen.
- No annual activity report and no aggregate export for the Bar Association.
- No materialised written client acceptance procedures: the flow approves/rejects (`features/processos/acoes.ts:559,610`) but does not require justifying acceptance at high risk, nor does it require senior approval in those cases (`podeAprovarRiscoElevado` was removed — D20).
- `ppe.consultado` is never emitted. It is documented as an example in `src/db/schema/auditoria.ts:22` but does not exist in the code — access to sensitive data by those permitted to see it leaves no trace.

**Priority: Medium-High** · **Effort: 4–5 days**

---

## 5. Bar Association Statute / professional conduct

**✅ Present**
- Confidentiality clause in the T&C — `src/lib/termos.ts:52`.
- Multi-tenant isolation verified in the queries (the download route compares `organizacaoId` and returns an indistinguishable 404 — `src/app/(backoffice)/processos/[id]/documentos/[documentoId]/route.ts:70`).
- Document downloads audited (`documento.descarregado`, `route.ts:118`).
- AES-256-GCM in `src/lib/storage/cifra.ts`.

**❌ Missing — the most serious point in this section**
- AES-256-GCM encryption protects only the storage connection credentials, not client data. The only consumers of `cifrar`/`decifrar` are `lib/storage/index.ts:67` and `features/configuracao`. Tax numbers, document numbers, addresses, PEP declarations and the identification documents themselves in base64 (`documento.dados`, `src/db/schema/documentos.ts:41`) sit in the clear in Postgres. Anyone with read access to the database has a law firm's entire archive.
- No MFA. `src/lib/auth.ts` has email+password only.
- 30-day session (`auth.ts:44`) — contradicts D14, which decided on 8 hours, and is far too long for a system holding privileged data.
- No RLS in Postgres (assumed in the scope cut) — the guards are application-level only.
- No conflict-of-interest check: grepping for `conflito` returns nothing outside the T&C. It is a professional duty that precedes acceptance (article 99 EOA).
- Advertising: not assessable in code — it depends on the newsletter content, which the system does not manage.

**Priority: High** (encryption at rest, MFA, session) · **Effort: 5–7 days**

---

## 6. Legal documents

**✅ Present**
- Complete, versioned T&C: subject matter, fees, AML, confidentiality, GDPR, signature, communications, termination, governing law and jurisdiction — `src/lib/termos.ts:25-98`. In three places from the same source (reader, `/termos-condicoes`, attached PDF).
- Fee proposal with acceptance separate from the T&C — `seccoes.ts:276`, `schemas.ts` step 7.
- Declaration of truthfulness with proof of consent.

**❌ Missing**
- The wording is demonstration text — declared in the file itself (`termos.ts:10`). None of this goes to production without review and adoption by the firm.
- Standalone privacy policy: non-existent.
- Pre-contractual information and right of withdrawal (DL 24/2014). Onboarding is concluded at a distance; if the client is a consumer, there is a pre-contractual information duty and a 14-day withdrawal right, with its own form. The T&C mention neither — and clause 9 imposes an agreed jurisdiction, which is void against a consumer (article 74 CPC / DL 446/85). Must be reviewed by a lawyer.
- No platform terms of use distinct from the engagement contract.
- The summary block for email (`termos.ts:101`) states that the matter "is subject to review by the team" — true today, but it describes processing without stating a legal basis.

**Priority: High** (withdrawal right + jurisdiction + privacy policy) · **Effort: 2 days of implementation + external legal review**

---

## 7. Special categories (GDPR article 9)

**Field-by-field check in `src/db/schema/seccoes.ts`:** name, occupation, employer, date of birth, nationality(ies), address, phone, email, tax number, document, PEP, source of funds, billing, areas of interest. No field asks for health data, biometrics, religious beliefs, trade union membership or sex life. Nationality is not a special category.

**❌ Risks to confirm**
- The PEP declaration identifies public/political offices. PEP status derives from the function, but the combination (office + entity + country + period) may reveal political opinion within the meaning of article 9(1). Legal basis: article 9(2)(g) (substantial public interest, Lei 83/2017) — defensible, but it must be written into the ROPA and the privacy policy. Today it is nowhere.
- Free-form upload. `tipo_documento` includes `outro` (`enums.ts:45`) and the dropzone accepts any PDF/image within the permitted formats (`src/features/onboarding/formatos.ts`). A client can upload a medical certificate or a clinical report with nothing preventing or flagging it. A warning on the field and a triage rule are missing.

**Priority: Medium** · **Effort: 1–2 days**

---

## 8. Records and archiving

**✅ Present**
- `evento_auditoria` append-only with a per-organisation hash chain, immutable in Postgres (migration `0002`) and verifiable (`scripts/verificar-auditoria.ts`).
- Documents with `hash_sha256`, MIME, size and expiry — `documentos.ts:21`.
- Archiving on the firm's server over SFTP, with `summary.pdf` and `dados_cliente.pdf` per folder (`src/lib/storage/`), with an `armazenamento.sincronizado` event.
- `softDelete()` applied to the tables under legal retention.

**❌ Missing**
- Copy of the Citizen Card. `tipo_doc_id` includes `cartao_cidadao` (`enums.ts:34`) and `tipo_documento` includes `identificacao` — the system accepts and retains the Citizen Card image. Article 5(2) of Lei 7/2007 prohibits retaining and reproducing the Citizen Card except with the holder's express consent. That consent does not exist in the flow: there is no purpose in the enum, no checkbox at step 2, no row in `consentimento`. It is the easiest non-compliance to fix and the easiest to be caught in an inspection.
- 7-year retention with no execution: no counting from the end of the relationship, no purge, no anonymisation.
- Documents as base64 in the database, with a 4 MB limit (`documentos.ts:41`) — accepted as a POC compromise. It will not hold a 7-year archive and does not allow per-object encryption.
- No automatic periodic verification of the chain's integrity (the script exists, but nothing runs it).

**Priority: High** (Citizen Card consent, retention) · **Effort: 4–6 days**

---

# TOP 10 ACTIONS — by priority

| # | Action | Module | Prio. | Days |
|---|---|---|---|---|
| 1 | Express consent for retaining a copy of the Citizen Card (article 5(2) Lei 7/2007): new purpose in the enum, checkbox at step 2, row in `consentimento`; without it, do not accept a Citizen Card upload | `db/schema/enums.ts`, `onboarding/consentimentos.ts`, `onboarding/schemas.ts` (step 2), `Anexos.tsx` | High | 2 |
| 2 | Record the T&C and the proposal as real consents: add `termos_condicoes` and `proposta` to the `TEXTOS` map, seed `versao_texto_legal` with the full wording + `VERSAO_TERMOS`, and call `registarConsentimento` in case 7 | `onboarding/consentimentos.ts`, `onboarding/acoes.ts:400`, `lib/termos.ts` | High | 2 |
| 3 | Privacy policy + article 13 notice at the start of the flow (route `/politica-privacidade`, link at step 1, identification of the controller and the privacy contact) | new `app/politica-privacidade/`, `onboarding/componentes/Formulario.tsx`, `db/schema/organizacao.ts` | High | 2 |
| 4 | Encryption at rest for personal data and documents — extend the existing `cifra.ts` to `documento.dados` and to the identification columns; medium term, move files to a private bucket with a per-object key | `lib/storage/cifra.ts`, `db/schema/documentos.ts`, `onboarding/documentos.ts` | High | 4 |
| 5 | Beneficial owner and RCBE in the Company path — the table already exists, the step and the Zod schema are missing (legal duty, article 30 Lei 83/2017) | `onboarding/schemas.ts`, `onboarding/passos.ts`, `onboarding/componentes/` | High | 4 |
| 6 | Executable 7-year retention: end-of-business-relationship column, `pnpm retencao:expurgar` script (dry run + execution) and anonymisation, with an audit event per purged row | `db/migrations/`, new `scripts/expurgar.ts`, `features/auditoria/registar.ts` | High | 4 |
| 7 | Channel for exercising data subject rights: case file export in JSON+PDF (access and portability), rectification request and consent withdrawal from a permanent client link; every request audited | new `features/titular/`, `app/(cliente)/` | High | 4 |
| 8 | MFA (TOTP) + 8-hour session — Better Auth's `twoFactor` plugin plus a table; fix `expiresIn` to match D14 | `lib/auth.ts` | High | 2 |
| 9 | Legal review of the T&C with the firm's definitive wording, including the 14-day right of withdrawal (DL 24/2014), pre-contractual information and review of the jurisdiction clause against consumers. Bump `VERSAO_TERMOS` | `lib/termos.ts` (+ external) | High | 2 + external |
| 10 | ROPA and DPIA documented, `ppe.consultado` emitted on access to sensitive data, and suspicious transaction reporting recorded | `docs/RGPD-ROPA.md`, `docs/RGPD-DPIA.md`, `processos/[id]/page.tsx`, new `comunicacao_suspeita` table | Medium-High | 5 |

**Estimated total: ~31 development days**, plus external legal review of the T&C, the privacy policy and the DPIA.

---

## Reading notes

1. The architecture is well positioned — the immutable audit trail, the versioning of legal texts and the separation of consent purposes are exactly the expensive pieces to graft on later, and they are done. What is missing is mostly enforcement and surface, not foundation.
2. Items 1, 2 and 5 are concrete, verifiable legal breaches, not improvements — they block real use.
3. Item 4 is the one that matters most in a law firm: the risk is not regulatory but one of professional privilege — today, a copy of the database is the complete archive, in the clear.
