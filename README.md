# Plataforma de Processos Jurídicos — PMF Consulting

Plataforma interna para centralizar os processos de uma sociedade de advogados.
**Primeira entrega: módulo de Onboarding de clientes** (KYC/AML) com back-office de gestão.

## Estado

**Fase 1 — Fundações, concluída.** Scaffold, tokens de design, schema com 27 tabelas, migrações,
autenticação e validações portuguesas testadas. Falta ligar a uma base de dados real.

O projeto está enquadrado como **POC** — infraestrutura a €0/mês e âmbito cortado. Ver `CLAUDE.md`.

## Arrancar

```bash
pnpm install
cp .env.example .env    # preenche com o teu projeto Supabase
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Sem `.env` o `pnpm build`, o `pnpm test` e o `pnpm typecheck` correm à mesma — só as operações
que tocam a base de dados é que precisam dele.

## Documentação

| Ficheiro | O que é |
|---|---|
| [`docs/BRIEF.md`](docs/BRIEF.md) | O brief completo — âmbito, stack, design, modelo de dados, plano |
| [`docs/CAMPOS.md`](docs/CAMPOS.md) | Inventário campo a campo dos 7 passos + 15 ambiguidades por decidir |
| [`docs/SCHEMA.md`](docs/SCHEMA.md) | Proposta de schema Drizzle, auditoria encadeada, RLS, pesquisa |
| [`docs/DECISAO-ASSINATURA.md`](docs/DECISAO-ASSINATURA.md) | In-house vs. DocuSeal — recomendação e prós/contras |
| [`CLAUDE.md`](CLAUDE.md) | Decisões de arquitetura e comandos |

## Em falta

Os 7 screenshots do formulário atual, em `docs/onboarding-screens/`. Sem eles o inventário de
campos é uma derivação do texto do brief, não uma validação contra o formulário real.

## Stack prevista

Next.js 15 (App Router) · TypeScript strict · Tailwind + shadcn/ui · React Hook Form + Zod ·
PostgreSQL · Drizzle ORM · Better Auth com MFA · TanStack Table · nuqs · pdf-lib · Resend ·
Vitest + Playwright · next-intl (pt-PT default).

## Licença

Privado, todos os direitos reservados.
