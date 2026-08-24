# Legal Matter Platform — PMF Consulting

Internal platform to centralise the matters of a law firm.
**First delivery: client Onboarding module** (KYC/AML) with a management back-office.

## Status

**Phase 1 — Foundations, complete.** Scaffold, design tokens, schema with 27 tables, migrations,
authentication and Portuguese validations tested. Still to be wired to a real database.

The project is framed as a **POC** — infrastructure at €0/month and reduced scope. See `CLAUDE.md`.

## Getting started

```bash
pnpm install
cp .env.example .env    # fill in with your Supabase project
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Without `.env`, `pnpm build`, `pnpm test` and `pnpm typecheck` still run — only the operations
that touch the database actually need it.

## Documentation

| File | What it is |
|---|---|
| [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) | **Start here.** The architecture of every phase, and the reasoning behind each piece |
| [`docs/BRIEF.md`](docs/BRIEF.md) | The full brief — scope, stack, design, data model, plan |
| [`docs/CAMPOS.md`](docs/CAMPOS.md) | Field-by-field inventory of the 7 steps + 15 ambiguities to be decided |
| [`docs/SCHEMA.md`](docs/SCHEMA.md) | Proposed Drizzle schema, chained audit trail, RLS, search |
| [`docs/DECISAO-ASSINATURA.md`](docs/DECISAO-ASSINATURA.md) | In-house vs. DocuSeal — recommendation and pros/cons |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | From zero to `poc.terlicalabs.com` live — domain, server, Coolify, DNS |
| [`CLAUDE.md`](CLAUDE.md) | Architecture decisions and commands |

## Missing

The 7 screenshots of the current form, in `docs/onboarding-screens/`. Without them the field
inventory is a derivation from the brief text, not a validation against the real form.

## Planned stack

Next.js 15 (App Router) · TypeScript strict · Tailwind + shadcn/ui · React Hook Form + Zod ·
PostgreSQL · Drizzle ORM · Better Auth with MFA · TanStack Table · nuqs · pdf-lib · Resend ·
Vitest + Playwright · next-intl (pt-PT default).

## Licence

Private, all rights reserved.
