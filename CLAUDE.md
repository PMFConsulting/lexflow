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
| 0 — Análise | **concluída** — 7 screenshots lidos, campos inventariados, 7 divergências registadas |
| 1 — Fundações | **concluída** e em produção |
| 2 — Fluxo de onboarding | **concluída** — percorrida de ponta a ponta em produção |
| 3 — Back-office | por iniciar |
| 4 — Fecho (PDF, assinatura, emails) | fora do âmbito da POC |

### O que ficou feito na Fase 1

Next.js 16 + TypeScript strict + Tailwind 4 + shadcn/ui · tokens do §3 aplicados
(`src/app/globals.css`) com as três famílias tipográficas · layout do back-office com sidebar
em tinta · componentes do vocabulário visual (`Carimbo`, `Carimbos`, `Ref`, `EstadoBadge`,
`RiscoBadge`) · schema Drizzle completo, 27 tabelas · três migrações, incluindo pesquisa
full-text pt com `unaccent` e a imutabilidade da auditoria · Better Auth com email+password e
sessões em BD · validações PT (NIF mod-11, IBAN mod-97, código postal, telefone) com 21 testes ·
cadeia de hashes da auditoria com 8 testes e script de verificação · seeds com guard de ambiente.

`pnpm build` limpo, `pnpm typecheck` limpo, 29 testes verdes, sem scroll horizontal a 360px.

### O que ficou feito na Fase 2

Sete passos em rotas próprias (`/onboarding/[token]/passo/[n]`), com o estado na base de
dados e não em memória · schemas Zod partilhados entre cliente e servidor · Server Action que
revalida token e schema · lógica condicional (particular/empresa, representante, PPE) · PPE
declarada força risco elevado e escreve na auditoria · criação de processos com referência
sequencial atómica e link mágico mostrado uma única vez · lombada com carimbos.

**Percorrido em produção**, do painel à submissão: validação a rejeitar 13 campos vazios,
NIF com checksum errado recusado, documento expirado recusado, passo 3 saltado corretamente
num particular sem procuração, risco elevado gravado, 9 eventos de auditoria com a cadeia
íntegra, e o `UPDATE`/`DELETE` na auditoria a devolver zero linhas afetadas.

### Três defeitos que só apareceram a usar

1. **O React 19 faz reset ao formulário** depois de uma Server Action passada em `action={}`.
   Um dígito errado no NIF apagava os outros dezanove campos. Passou a `onSubmit` com
   `preventDefault`.
2. **O passo 7 não conseguia ser submetido**: chamava `submeter()` diretamente, mas essa
   função lê a declaração da base de dados e a caixa nunca era gravada antes.
3. **A pasta `public/` vazia** não ia no git, e o `COPY` do Dockerfile rebentava a partir de
   um clone limpo — passava na máquina de quem a tinha localmente.

### Por fazer no fluxo

- Uploads de documentos (o schema e a tabela `documento` já existem)
- E2E Playwright dos dois percursos
- Percurso Empresa por validar contra imagens (A18)

### Atualização — passo Representante removido, fluxo a 5 passos

Pedido do cliente (05/08/2026): o passo Representante legal sai do onboarding — o formulário
real não tinha essa figura, e o campo "Sou representado por procurador" ficava sem uso. O
fluxo passa a **Identificação → Fiscal → PPE → Faturação → Fecho**, 5 passos. Schema da BD
mantém-se intacto (`representante_legal` e `preferencias_contacto` ficam por usar, como já
tinha acontecido com as preferências). Cada passo mostra agora uma descrição curta junto ao
título, e o passo PPE explica em uma frase como o risco é calculado.

Ficava por fazer desde a Fase 2 e passou a existir nesta atualização: **fluxo de aprovação**
(`alterarEstadoProcesso`, botões no detalhe do processo). Removido na atualização seguinte —
ver D20.

### Atualização — aprovações e risco removidos da UI, página Clientes

Pedido do cliente (05/08/2026): simplificar a POC. Ver D20 e D21.

- **Aprovações fora**: `alterarEstadoProcesso` e `AcoesProcesso` (botões Aprovar / Rejeitar /
  Marcar em revisão) saíram por completo — apagados, não só escondidos. `podeAprovarRiscoElevado`
  também saiu de `src/lib/sessao.ts` por ter ficado sem utilização. O email de decisão ao
  cliente (`notificarDecisao`) foi com ele. Os estados `aprovado`/`rejeitado` continuam no enum
  e no schema — só deixam de ser alcançáveis a partir da UI.
- **Risco fora da UI**: `RiscoBadge`, a secção "Fatores de risco" e os filtros/facetas de risco
  desapareceram do detalhe do processo, da lista de processos, do painel e — porque também lá
  aparecia, ao próprio cliente — da revisão final do onboarding. O cálculo
  (`nivelRisco`/`fatoresRisco`, PPE força risco elevado) mantém-se intacto na base de dados,
  só não é mostrado a ninguém.
- **`/clientes`**: nova página no back-office (`src/app/(backoffice)/clientes/page.tsx`),
  entrada na sidebar entre Processos e — já sem "Risco elevado" a ocupar esse lugar. Um
  cliente é uma pessoa/empresa deduplicada por NIF/NIPC (`src/features/clientes/consultas.ts`,
  `listarClientes`): CTE com `row_number()` particionado por NIF para escolher o processo mais
  recente e `count(*)` para o total, com pesquisa por nome/NIF/email via `ilike` + `unaccent`,
  mesmo padrão do `/processos`. Um processo sem NIF (passo 2 por preencher) ainda não conta
  como cliente. Sem migração — usa `dados_fiscais`, `dados_identificacao` e `nacionalidade`
  já existentes.

### Atualização — Representante Legal de volta, fluxo a 7 passos

Pedido do cliente (06/08/2026): o passo Representante Legal volta ao fluxo, entre Fiscal e PPE.
Reverte a D19. **Sem migração** — a tabela `representante_legal` e o enum
`titular_nacionalidade` ('cliente' | 'representante') já existiam desde a Fase 1; o que faltava
era o passo que os escrevia. Mesmo padrão da reativação do passo RGPD.

Ordem final: **1 Identificação · 2 Fiscal · 3 Representante Legal · 4 PPE · 5 Faturação ·
6 RGPD · 7 Fecho**. Renumerados os schemas Zod, os `case` do `guardarPasso`, os blocos do
formulário e da revisão final, os blocos do detalhe do processo, os rótulos de auditoria
(`passo.N.gravado`) e o `total` dos `Carimbos`. A restrição `passo_valido` da base de dados já
aceitava `between 1 and 7`.

O passo pende de um interruptor — "É representante?", com "Não" como resposta de partida. Com
"Não", grava-se a linha com `e_representante = false` e mais nada é obrigatório; a linha em
branco é a prova de que a pergunta foi feita, coisa que a ausência de linha não distingue de
"ainda não chegou aqui". Com "Sim", exigem-se relação, nome, data de nascimento,
nacionalidade(s), profissão, telefone, email e as sete colunas de morada, com as mesmas
validações PT do passo 1.

Corrigido a caminho: o passo 1 apagava **todas** as nacionalidades do processo antes de
regravar as suas. Passou a apagar só as de `titular = 'cliente'` — sem isso, voltar atrás para
corrigir uma vírgula no nome levava com ele as nacionalidades do representante.

### Atualização — sem registo público

Pedido do cliente (06/08/2026). O ecrã `/registar` foi apagado e `disableSignUp` passou a
`true`, o que fecha também o endpoint da API — a rota continuava a aceitar quem a chamasse à
mão, mesmo sem página. As contas passam a criar-se no servidor com
`scripts/criar_utilizador.mjs`, que escreve as três linhas necessárias: `user` e `account`
(onde o Better Auth guarda a palavra-passe, com `provider_id = 'credential'`) e `utilizador`,
já com `auth_user_id` ligado — sem esse último passo o login passa e a sessão não resolve.

O hash vem do próprio pacote (`better-auth/crypto`), não de uma reimplementação: é a única
forma de garantir que os parâmetros do scrypt não divergem numa atualização. O
`scripts/verificar_hash.mjs` confirma-o sem base de dados, e o modo `--gerar-hash` prepara a
palavra-passe numa máquina sem acesso ao Postgres.

### Atualização — armazenamento por servidor (SFTP) a funcionar de ponta a ponta

Configurado e percorrido no contentor de produção (06/08/2026). Três coisas partiam, e nenhuma
delas aparecia em desenvolvimento:

1. **O URL do SFTP ia com os nomes em cru.** Uma pasta de cliente chama-se
   `Maria Silva (249886344)`, e o espaço não entra num URL: o curl truncava aí e o upload
   ia parar a `/Clientes/Maria`. Os segmentos passam a percent-encoded, como já iam no WebDAV.
2. **O `-Q mkdir` do curl parte a linha em palavras.** O caminho acabava no primeiro espaço,
   e a pasta criada tinha o nome errado. Vai entre aspas, com `\"` e `\\` escapados.
3. **O `curl` do Alpine não fala sftp://** — vem compilado sem libssh2, e a sincronização
   falhava com "Protocol sftp not supported" na primeira submissão. Ver D26.

Ao mesmo tempo, e por pedido do Diogo, cada pasta passa a ter também o `dados_cliente.pdf`
(D27), que era o que o auxiliar em Python deixava no OneDrive.

## Infraestrutura — ~65 €/ano para POCs ilimitadas

Guia completo em [`docs/DEPLOY.md`](docs/DEPLOY.md).

| Camada | Escolha | Custo |
|---|---|---|
| Domínio | `terlicalabs.com` na Cloudflare Registrar | ~10 €/ano |
| Servidor | Hostinger VPS KVM 1 (1 vCPU, 4 GB), Ubuntu 24.04 na UE | ~5–8 €/mês |
| PaaS | Coolify, auto-alojado | grátis |
| Postgres | no próprio servidor, via Coolify | grátis |
| Email | Resend | grátis (3.000/mês) |
| Assinatura | fora do âmbito da POC | ver `docs/DECISAO-ASSINATURA.md` |

**Endereço desta POC:** `poc.terlicalabs.com`. O apex `terlicalabs.com` é o site da Terlica
Labs, onde se pedem projetos, e vive noutro repositório — mesmo servidor, outro projeto no
Coolify.

**Porquê não a Vercel:** o plano Hobby proíbe uso comercial, e estes são projetos para
clientes. O Pro são 20 €/mês, por projeto de conta. O VPS é um custo fixo que não cresce com
o número de clientes.

**Porquê não o Supabase:** o plano gratuito suspende o projeto ao fim de 7 dias sem uso —
exatamente o padrão de uma POC mostrada de duas em duas semanas. Com Postgres no próprio
servidor, o problema desaparece e poupa-se uma conta.

## Corte de âmbito da POC — a validar

**Fica dentro:** os 5 passos com rascunho e link mágico · back-office com listagem filtrável e
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
| D11 | `env()` e `db()` são preguiçosos, não constantes de módulo — o `next build` não precisa de base de dados, e falhar o build por falta de um segredo de runtime é mau negócio | `src/env.ts` |
| D12 | `prepare: false` na ligação Postgres — o pooler do Supabase em modo transaction é pgBouncer e não suporta prepared statements | `src/db/index.ts` |
| D13 | Pesquisa full-text por trigger e não por coluna gerada: `unaccent` não é immutable e as fontes (nome, NIF) estão noutras tabelas | migração `0001` |
| D14 | Sessões de 8 horas — um dia de trabalho, não um mês | `src/lib/auth.ts` |
| D15 | Os `id` são gerados na aplicação (`uuidv7`), não pela base de dados — o Postgres só tem `uuidv7()` nativo na v18. Consequência prática: qualquer INSERT em SQL cru tem de indicar o `id` | `src/db/schema/_comum.ts` |
| D16 | Alojamento em VPS próprio com Coolify, em vez de Vercel — o plano Hobby proíbe uso comercial e o Pro são 20 €/mês. Custo fixo para POCs ilimitadas | `docs/DEPLOY.md` |
| D16b | Fornecedor: Hostinger (a Hetzner exigia VAT ID). Empresa da UE com datacenter na UE — para um sistema que guarda documentos de identificação e declarações de PPE, um fornecedor americano traria exposição ao Cloud Act mesmo com datacenter europeu | `docs/DEPLOY.md` |
| D17 | Postgres no próprio servidor em vez de Supabase — elimina a suspensão do plano gratuito ao fim de 7 dias sem uso, que é o padrão de uma POC mostrada de duas em duas semanas | `docs/DEPLOY.md` |
| D18 | `output: "standalone"` e imagem Docker em três estágios; as migrações correm no arranque do contentor e, se falharem, ele não sobe | `Dockerfile` |
| D19 | Passo Representante removido do onboarding (pedido do cliente); fluxo passa a 5 passos. Tabela `representante_legal` fica no schema, só deixa de ser escrita | este ficheiro |
| D20 | Fluxo de aprovação apagado (não só escondido): `alterarEstadoProcesso`, `AcoesProcesso`, `podeAprovarRiscoElevado`, email de decisão. Os estados `aprovado`/`rejeitado` ficam no schema como estados finais possíveis, só sem caminho na UI para lá chegar | este ficheiro |
| D21 | Risco (`nivelRisco`, `fatoresRisco`, PPE força risco elevado) deixa de aparecer em qualquer UI — backoffice ou onboarding do cliente — mas o cálculo e a gravação continuam; enxertar de volta um dia é mostrar campos que já existem, não reescrever lógica | este ficheiro |
| D22 | Passo Representante Legal de volta ao fluxo, entre Fiscal e PPE (reverte a D19). Fluxo a 7 passos, sem migração — a tabela e o enum já existiam | este ficheiro |
| D23 | Sem registo público: `disableSignUp: true` e `/registar` apagado. Contas criadas no servidor por `scripts/criar_utilizador.mjs`, com o hash vindo de `better-auth/crypto` e não de uma reimplementação | `scripts/criar_utilizador.mjs` |
| D24 | O `summary.pdf` grava-se sem fluxos de objetos e leva a referência do processo como entrada em texto simples no dicionário Info. Um resumo de arquivo tem de ser identificável sem uma biblioteca de PDF à mão — e o `setTitle` do pdf-lib escreve em UTF-16BE hexadecimal | `src/lib/storage/resumo.ts` |
| D25 | `nomeSeguro` preserva o ponto final de um nome de empresa ("Lda.", "S.A.") e só o corta quando o nome começa por ponto, que é a forma de um ficheiro oculto. Contraria a regra do SharePoint de propósito: uma pasta com a denominação errada é pior do que uma pasta com um nome que o SharePoint normaliza | `src/lib/storage/tipos.ts` |
| D26 | Imagem de produção em `node:22-bookworm-slim` e não em Alpine: o `curl` do Alpine é compilado sem libssh2 e não tem `sftp://`. A alternativa — `openssh-client` e reescrever o adaptador à volta do binário `sftp` — custava o `.netrc` (a palavra-passe passava a depender do `sshpass`) e o `--hostpubsha256` (o pinning da chave do host). Trocar a base custa megabytes de imagem e zero linhas de lógica. O `curl --version \| grep -qw sftp` no Dockerfile é o que impede a regressão silenciosa: sem sftp, a imagem não se constrói | `Dockerfile` |
| D27 | Cada pasta de cliente leva dois PDFs: o `summary.pdf` com o detalhe do processo e o `dados_cliente.pdf` — capa com data, referência, nome, NIF e o índice dos ficheiros. O nome do segundo não é escolha nossa, é o que o `scripts/gera_pasta_cliente.py` já deixava no OneDrive e por onde se procura o dossier. A capa gera-se em último, quando já se sabe o que indexar, e não se indexa a si própria | `src/lib/storage/capa.ts` |

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
- **Dependências fora do §1**: `uuidv7` (o Postgres só tem `uuidv7()` nativo na v18), `dotenv`,
  `tsx` e `server-only` (utilitários de build). `signature_pad` deixa de ser precisa na POC.
- **`REVOKE` da auditoria não morde no Supabase por omissão**: o utilizador da aplicação é
  também o owner da tabela, e o owner contorna o `REVOKE`. Só as `RULE` protegem. Criar um papel
  `app_user` separado do owner é o passo que fecha isto na passagem a produção — a migração
  `0002` já o aplica se o papel existir.
- **Componente `form` do shadcn**: não existe no preset `radix-nova` instalado. Na Fase 2
  escreve-se um wrapper fino sobre React Hook Form em vez de o importar.

## Comandos

```bash
pnpm dev                  # servidor de desenvolvimento
pnpm build                # tem de passar limpo no fim de cada fase
pnpm test                 # Vitest
pnpm test:e2e             # Playwright
pnpm db:generate          # drizzle-kit generate
pnpm db:migrate           # aplica migrações
pnpm db:seed              # só com NODE_ENV=development
pnpm db:validar           # aplica as migrações a um Postgres em WASM e verifica-as
pnpm auditoria:verificar  # revalida a cadeia de hashes de evento_auditoria
```

`pnpm db:validar` não precisa de servidor nenhum: corre as três migrações num PGlite efémero e
confirma que as 27 tabelas existem, que a auditoria recusa mesmo UPDATE e DELETE, e que a
pesquisa resolve acentos e maiúsculas. É o que garante que o primeiro `db:migrate` contra o
Supabase não rebenta.

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
