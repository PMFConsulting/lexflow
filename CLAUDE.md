# CLAUDE.md — Plataforma de Processos Jurídicos (PMF Consulting)

Contexto completo em `docs/BRIEF.md`. Este ficheiro guarda decisões e comandos, e é
atualizado à medida que as fases avançam.

## Estado

| Fase | Estado |
|---|---|
| 0 — Análise | **em curso** — bloqueada pelos screenshots e por 15 ambiguidades |
| 1 — Fundações | por iniciar |
| 2 — Fluxo de onboarding | por iniciar |
| 3 — Back-office | por iniciar |
| 4 — Fecho (PDF, assinatura, emails) | por iniciar |

**Não escrever código antes da Fase 0 estar aprovada.** Ainda não há `src/`, `package.json`
nem migrações — é intencional.

## Regra de ouro do domínio

Isto é KYC/AML sujeito à Lei 83/2017, ao Regulamento 2/2020 da OA e ao RGPD. Auditoria
imutável, retenção de 7 anos, consentimentos com prova, e apagamento que não pode apagar o
que a lei obriga a conservar. Requisito funcional, não disclaimer.

## Decisões tomadas

| # | Decisão | Onde |
|---|---|---|
| D1 | Assinatura in-house (`signature_pad` + `pdf-lib`) na v1, com o modelo de dados a seguir o vocabulário do Documenso para permitir trocar depois | `docs/DECISAO-ASSINATURA.md` |
| D2 | `utilizador` (domínio) separado das tabelas do Better Auth, ligadas por `auth_user_id` — atualizar a biblioteca não pode obrigar a migrar dados de negócio | `docs/SCHEMA.md` |
| D3 | `versao_texto_legal` como tabela própria; consentimentos referenciam-na por FK — prova o conteúdo exato sem duplicar texto em cada linha | `docs/SCHEMA.md` |
| D4 | Token do link mágico guardado só em SHA-256; o valor em claro existe uma vez, no email | `docs/SCHEMA.md` |
| D5 | Imutabilidade de `evento_auditoria` garantida por `REVOKE` + `RULE ... DO INSTEAD NOTHING` no Postgres, não por convenção na aplicação | `docs/SCHEMA.md` |
| D6 | Cadeia de hashes da auditoria é por organização, não global, para não serializar todas as escritas | `docs/SCHEMA.md` |
| D7 | Listas dinâmicas (residências fiscais, beneficiários efetivos) são tabelas 1:N, não JSONB — pesquisa-se por NIF de beneficiário efetivo | `docs/SCHEMA.md` |

## Decisões em aberto

- **A1–A15** — ambiguidades de campos, em `docs/CAMPOS.md`. A1 e A2 bloqueiam a Fase 1.
- **Neon vs. Supabase** — se o storage for Supabase há sobreposição com Better Auth e
  UploadThing; com R2/S3 o Neon é mais simples.
- **Retenção e expurgo aos 7 anos** — o desenho está em `docs/SCHEMA.md` e precisa de
  validação jurídica, não técnica.
- **Dependências fora do §1**: `uuidv7`, `signature_pad`. Justificação em `docs/SCHEMA.md`.

## Comandos

Ainda não há scaffold. Previstos para a Fase 1:

```bash
pnpm dev                  # servidor de desenvolvimento
pnpm build                # tem de passar limpo no fim de cada fase
pnpm test                 # Vitest
pnpm test:e2e             # Playwright
pnpm db:generate          # drizzle-kit generate
pnpm db:migrate           # aplica migrações
pnpm db:seed              # só com NODE_ENV=development
pnpm auditoria:verificar  # revalida a cadeia de hashes de evento_auditoria
```

## Convenções

- Código, comentários, commits e UI em **português europeu**. Identificadores de domínio em
  português (`processo_onboarding`, `nivel_risco`), termos técnicos em inglês onde é idiomático.
- TypeScript `strict: true`, zero `any`. `pnpm build` limpo é critério de aceitação.
- Server Actions revalidam sempre com Zod no servidor. A validação do cliente é UX.
- Organização por domínio em `src/features/`, não por tipo de ficheiro.
- Qualquer identificador na UI (referência, NIF, IBAN, hash, timestamp de auditoria) é
  renderizado em `IBM Plex Mono`. Regra, não sugestão.
- Commits pequenos, um por unidade lógica.
- Segredos só em `.env`; `.env.example` documentado e commitado.
