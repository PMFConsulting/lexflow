# CLAUDE.md — Plataforma de Processos Jurídicos (PMF Consulting)

Contexto completo em `docs/BRIEF.md`. Este ficheiro guarda decisões e comandos, e é
atualizado à medida que as fases avançam.

## Enquadramento: isto é uma POC

Decidido em 31/07/2026. **Objetivo é provar o conceito ao menor custo possível**, não entregar
o sistema final. Consequências concretas em baixo. O brief continua a ser o destino; a POC é
o primeiro troço.

## Estado

| Fase | Estado |
|---|---|
| 0 — Análise | **concluída** — 7 screenshots lidos, campos inventariados, 7 divergências e 7 ambiguidades por fechar |
| 1 — Fundações | por iniciar, à espera de aprovação |
| 2 — Fluxo de onboarding | por iniciar |
| 3 — Back-office | por iniciar |
| 4 — Fecho (PDF, assinatura, emails) | fora do âmbito da POC |

**Não escrever código antes da Fase 0 estar aprovada.** Ainda não há `src/`, `package.json`
nem migrações — é intencional.

## Infraestrutura da POC — €0/mês

| Camada | Escolha | Plano | Limite relevante |
|---|---|---|---|
| Postgres + Storage | **Supabase** | free | 500 MB BD, 1 GB ficheiros; pausa após 7 dias sem uso |
| Alojamento | **Vercel** | Hobby | ⚠ Hobby proíbe uso comercial — ver nota |
| Email | **Resend** | free | 3.000/mês, 100/dia |
| Assinatura | não aplicável na POC | — | ver `docs/DECISAO-ASSINATURA.md` |

**Porquê Supabase e não Neon:** ambos têm free tier de Postgres, mas o Neon não tem storage —
obrigaria a uma segunda conta (R2 ou UploadThing) para os documentos de identificação. Um
serviço em vez de dois, ao mesmo preço: zero. Usamos o Supabase só como Postgres + Storage;
o auth continua a ser Better Auth, como o §1 do brief manda.

**Nota sobre o Vercel Hobby:** o plano gratuito exclui uso comercial. Enquanto for POC interna
sem faturação é defensável; no dia em que a sociedade a usar a sério, são 20 €/mês de Pro.
Sinalizo agora para não ser surpresa depois.

## Corte de âmbito da POC — a validar

**Fica dentro:** os 7 passos com rascunho e link mágico · back-office com listagem filtrável e
detalhe do processo · `evento_auditoria` append-only com cadeia de hashes · motor de risco ·
papéis aplicados na aplicação · design tokens do §3.

**Fica de fora (com o schema já preparado):** RLS no Postgres — só guards na aplicação · MFA por
TOTP · locale EN · geração do PDF do dossier · assinatura digital · exportações CSV/PDF · emails
transacionais além do link mágico · o percurso Empresa, enquanto não houver screenshots.

**A auditoria fica dentro de propósito.** É o coração do valor num sistema de KYC e custa pouco
a fazer bem de início; enxertá-la depois obriga a reescrever todas as escritas.

## Regra de ouro do domínio

Isto é KYC/AML sujeito à Lei 83/2017, ao Regulamento 2/2020 da OA e ao RGPD. Auditoria
imutável, retenção de 7 anos, consentimentos com prova, e apagamento que não pode apagar o
que a lei obriga a conservar. Requisito funcional, não disclaimer. **Ser POC não altera isto** —
altera o que se constrói à volta.

## Decisões tomadas

| # | Decisão | Onde |
|---|---|---|
| D1 | Assinatura in-house (`signature_pad` + `pdf-lib`) quando chegar a altura; fora da POC, porque o formulário atual não tem assinatura nenhuma | `docs/DECISAO-ASSINATURA.md` |
| D2 | `utilizador` (domínio) separado das tabelas do Better Auth, ligadas por `auth_user_id` | `docs/SCHEMA.md` |
| D3 | `versao_texto_legal` como tabela própria; consentimentos referenciam-na por FK | `docs/SCHEMA.md` |
| D4 | Token do link mágico guardado só em SHA-256 | `docs/SCHEMA.md` |
| D5 | Imutabilidade de `evento_auditoria` por `REVOKE` + `RULE ... DO INSTEAD NOTHING` no Postgres | `docs/SCHEMA.md` |
| D6 | Cadeia de hashes da auditoria por organização, não global | `docs/SCHEMA.md` |
| D7 | Listas dinâmicas em tabelas 1:N, não JSONB | `docs/SCHEMA.md` |
| D8 | Morada como conjunto de colunas reutilizável (7 campos: morada, país, localidade, CP, freguesia, concelho, distrito), repetido em cliente/representante/faturação | `docs/SCHEMA.md` |
| D9 | Nacionalidade em tabela 1:N — o formulário aceita várias por titular | `docs/SCHEMA.md` |
| D10 | Supabase free como Postgres + Storage; Better Auth mantém-se como auth | este ficheiro |

## Decisões em aberto

- **A16–A21 e A15** — em `docs/CAMPOS.md`. A mais bloqueante é **A18**: não há screenshots do
  percurso Empresa, e metade do que o brief descreve (CAE, certidão permanente, regime de IVA,
  RCBE, beneficiários efetivos) deve viver lá.
- **D0/A17** — campos duplicados em todos os screenshots. Assumido como bug do formulário atual.
- **A19** — beneficiários efetivos e RCBE não existem no formulário. É obrigação legal, não
  funcionalidade opcional. Decisão jurídica antes de técnica.
- **D4 do inventário** — sem IBAN nem condições de pagamento no passo 6. Confirmar se é para
  acrescentar.
- **Retenção e expurgo aos 7 anos** — desenho em `docs/SCHEMA.md`, precisa de validação jurídica.
- **Dependências fora do §1**: `uuidv7`. `signature_pad` deixa de ser precisa na POC.

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
