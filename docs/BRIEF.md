# PROMPT — Plataforma de Processos Jurídicos · Módulo 1: Onboarding de Clientes

> Antes de começares, coloca os 7 screenshots em `docs/onboarding-screens/` — o Claude Code deve lê-los e validar cada campo contra a imagem correspondente.

---

## 0. Contexto

Estou a construir uma plataforma interna para centralizar os processos de uma sociedade de advogados / consultoria jurídica (PMF Consulting). Hoje o onboarding de clientes vive num formulário disperso e a informação não fica acessível de forma estruturada.

**Âmbito desta primeira entrega: só o módulo de Onboarding.** Nada de faturação, gestão processual, timesheets ou agenda. Mas a arquitetura tem de assumir que esses módulos vão chegar — é uma plataforma modular, não uma app de um formulário.

**Requisito não negociável:** tem de existir um back-office onde eu consulto, filtro, abro e giro todos os records submetidos. Um formulário que só envia um email não serve.

**Natureza do domínio:** isto é KYC/AML. Está sujeito à Lei 83/2017 (prevenção do branqueamento de capitais e financiamento do terrorismo), ao Regulamento 2/2020 da Ordem dos Advogados e ao RGPD. Implicações técnicas concretas: trilho de auditoria imutável, retenção mínima de 7 anos, dados especialmente sensíveis (PPE, origem de fundos), consentimentos com prova de data/hora, e direito ao apagamento que **não** pode apagar o que a lei obriga a conservar. Trata isto como requisito funcional, não como disclaimer no rodapé.

---

## 1. Stack

Usa exatamente isto, salvo se encontrares um bloqueio real (nesse caso pergunta antes de trocar):

| Camada | Escolha | Porquê |
|---|---|---|
| Framework | **Next.js 15+ (App Router) + TypeScript strict** | Server Actions evitam metade da camada de API; RSC dá-nos tabelas server-side sem esforço |
| UI | **Tailwind CSS + shadcn/ui** | Componentes que possuímos no repo, não uma dependência que não conseguimos alterar |
| Formulários | **React Hook Form + Zod** | Um único schema Zod por passo, partilhado entre cliente e servidor |
| Base de dados | **PostgreSQL** (Neon ou Supabase) | Precisamos de JSONB, RLS e full-text search em português |
| ORM | **Drizzle ORM** + drizzle-kit migrations | Migrações versionadas em SQL legível — importante para auditoria |
| Auth | **Better Auth** (ou Auth.js se preferires) com email+password, MFA por TOTP e sessões em BD | Advogados com MFA obrigatório |
| Tabelas | **TanStack Table v8** com paginação/ordenação/filtros server-side | Volume vai crescer; nunca carregar tudo no cliente |
| Estado de URL | **nuqs** | Filtros do back-office partilháveis por link |
| Ficheiros | **UploadThing** ou S3/R2 com URLs assinados de curta duração | Documentos de identificação nunca em bucket público |
| PDF | **pdf-lib** (montagem) + **@react-pdf/renderer** (geração) | Dossier final assinado |
| Email | **Resend** + React Email | Convites, lembretes, confirmações |
| Validação PT | Implementa tu (NIF/NIPC mod-11, IBAN mod-97, código postal) | As libs que existem são de 1 estrela; o algoritmo são 15 linhas |
| Testes | Vitest (unit) + Playwright (E2E do fluxo completo) | O fluxo de 7 passos tem de ter um E2E que o percorre de ponta a ponta |
| i18n | `next-intl` — **pt-PT como default**, EN como segundo locale | Clientes internacionais aparecem sempre |

Monorepo não é preciso. App única, `pnpm`.

---

## 2. Repositórios GitHub de referência

Não clones nenhum como base do projeto. Faz scaffold limpo e vai buscar padrões específicos a cada um:

**Base do back-office**

- `Kiranism/next-shadcn-dashboard-starter` (6.7k ⭐) — **a referência principal.** Next.js + shadcn + TanStack. Copia a estrutura de layout (sidebar, breadcrumbs, command palette) e o padrão de parallel routes.
- `satnaing/shadcn-admin` (12.7k ⭐) — melhor sistema de navegação e organização de features por pasta. Rouba a arquitetura de `features/`.
- `arhamkhnz/next-shadcn-admin-dashboard` (2.8k ⭐) — bom exemplo de theming multi-preset.

**Tabelas de records (o requisito crítico)**

- `sadmann7/tablecn` (6.2k ⭐) — **estuda este a sério.** Data table com filtros avançados, ordenação e paginação server-side com estado na URL. É exatamente o que preciso na listagem de processos.
- `openstatusHQ/data-table-filters` (2.1k ⭐) — filtros facetados + infinite scroll. Rouba o padrão de filtros facetados com contagens.

**Assinatura digital**

- `documenso/documenso` (14.2k ⭐) — **a referência de conformidade.** PAdES, certificados, trilho de auditoria. Ou integramos via API self-hosted, ou copiamos o modelo de dados de `Document`/`Recipient`/`Field`/`AuditLog`.
- `docusealco/docuseal` (18.1k ⭐) — melhor UX de colocação de campos no PDF. Tem API REST e imagem Docker — a via mais rápida se quisermos integrar em vez de construir.
- `OpenSignLabs/OpenSign` (6.7k ⭐) — alternativa com foco explícito em legaltech.
- `szimek/signature_pad` (12k ⭐) — canvas de assinatura manuscrita. Para a assinatura simples do passo 7 na v1.

**Formulários multi-passo / recolha de dados**

- `formbricks/formbricks` (12.7k ⭐) — estuda como modelam `Survey → Question → Response` com respostas em JSONB e lógica condicional. O nosso onboarding vai precisar de lógica condicional (particular vs. empresa, PPE sim/não).

**Decisão de arquitetura que quero que tomes na Fase 0 e me apresentes:** construir a assinatura in-house com `signature_pad` + `pdf-lib`, ou integrar DocuSeal self-hosted via API. Dá-me prós/contras em 10 linhas antes de escreveres código.

---

## 3. Direção de design

Não quero um dashboard genérico. Quero que pareça uma peça de software jurídico sério — sóbrio, denso, preciso, com a autoridade de um documento oficial.

**Referência mental:** um dossier de processo. Lombada, capilhas numeradas, carimbos, referências tipografadas em mono. Não é decoração — cada elemento codifica estado real.

### Tokens

```css
--tinta:        #101A24;  /* texto principal, sidebar */
--tinta-suave:  #5C6672;  /* secundário, labels */
--papel:        #EDEFEA;  /* fundo — papel de arquivo, não creme */
--papel-alto:   #FFFFFF;  /* superfícies elevadas, cards */
--selo:         #8C2F39;  /* carmim de carimbo — ações destrutivas, estado crítico */
--arquivo:      #2F5D50;  /* verde-arquivo — validado, aprovado */
--latao:        #A9884F;  /* latão — pendente, atenção, detalhes finos */
--linha:        #D6DAD2;  /* réguas e divisórias, 1px, sempre */
```

Proibido: creme #F4F1EA com serifa alto-contraste e acento terracota. É o default de qualquer dashboard gerado por IA em 2026 e lê-se como tal.

### Tipografia

- **Display:** `Instrument Serif` ou `Newsreader` — títulos de secção e números de processo. Com contenção: só H1/H2.
- **Corpo:** `Inter Tight` — formulários, tabelas, tudo o resto.
- **Mono:** `IBM Plex Mono` — referências de processo, NIF, IBAN, hashes, timestamps de auditoria. Qualquer identificador é mono. Isto é uma regra, não uma sugestão.

Escala de tipo definida em `globals.css` com `clamp()`. Densidade de informação alta: `text-sm` como base nas tabelas, não `text-base`.

### Elemento-assinatura: a lombada do processo

Uma coluna vertical fixa à esquerda do formulário de onboarding que representa o dossier: os 7 passos numerados (aqui a numeração justifica-se — é uma sequência real e obrigatória), cada um com o seu estado. Quando um passo é validado e gravado, recebe um **carimbo** — um selo circular em `--selo` a 8% de opacidade, com a data/hora em mono lá dentro, aplicado com uma micro-animação de 180ms (rotação de 2–3°, como um carimbo real a bater no papel). É o único momento de animação com peso na aplicação. Tudo o resto é imediato e silencioso.

Na listagem de records, o mesmo vocabulário: cada processo mostra a referência em mono (`PMF-2026-0142`) e quantos dos 7 carimbos já tem.

### Piso de qualidade

Responsivo até mobile (advogados abrem isto no telemóvel). Foco de teclado visível em todos os interativos. `prefers-reduced-motion` respeitado — sem o carimbo animado. Contraste AA mínimo. O formulário do cliente tem de funcionar em ecrãs de 360px.

### Escrita da interface

Português europeu, registo profissional mas humano. Botões dizem o que fazem: "Guardar e continuar", não "Submeter". Erros explicam o que falhou e como corrigir: "O NIF tem de ter 9 dígitos e começar por 1, 2, 3, 5, 6, 8 ou 9", não "Valor inválido". Estados vazios convidam à ação.

---

## 4. Modelo de dados

Desenha o schema Drizzle a partir disto. Tudo com `id` UUID v7, `created_at`, `updated_at`, e soft delete onde a lei obriga a reter.

```
organizacao          — multi-tenant desde o dia 1 (a sociedade; mais tarde outras)
utilizador           — advogados, assistentes, admin
processo_onboarding  — a entidade central
  ├─ referencia (PMF-{ano}-{sequencial}, único por organização)
  ├─ tipo_cliente (particular | empresa)
  ├─ estado (rascunho | submetido | em_revisao | pendente_cliente | aprovado | rejeitado | arquivado)
  ├─ passo_atual (1..7)
  ├─ responsavel_id → utilizador
  ├─ nivel_risco (baixo | medio | elevado)  ← calculado, ver §6
  ├─ token_acesso_cliente (para link mágico de preenchimento)
  ├─ expira_em
  └─ submetido_em, aprovado_em, aprovado_por

dados_identificacao   } uma tabela por secção, 1:1 com processo.
dados_fiscais         } Não metas tudo num JSONB gigante — precisamos de
representante_legal   } pesquisar por NIF, filtrar por PPE, indexar nome.
declaracao_ppe        } Campos verdadeiramente variáveis vão para uma
consentimento_rgpd    } coluna `extra JSONB` dentro de cada tabela.
dados_faturacao       }
fecho_proposta        }

documento             — ficheiros carregados (tipo, mime, tamanho, hash SHA-256, chave storage, validade)
assinatura            — assinatura do passo 7 (imagem/certificado, IP, user-agent, hash do doc assinado)
consentimento         — cada consentimento é uma linha própria (finalidade, versão do texto, data, IP, revogado_em)
nota                  — notas internas por processo, com autor e timestamp
evento_auditoria      — append-only, NUNCA update nem delete
```

**`evento_auditoria` é sagrado.** Toda a leitura de dados sensíveis, alteração de estado, download de documento e consentimento gera uma linha: `{processo_id, ator_id, acao, entidade, valor_anterior, valor_novo, ip, user_agent, criado_em}`. Sem update, sem delete — revoga essas permissões ao nível do Postgres se conseguires. Encadeia por hash (cada linha inclui o hash da anterior) para o registo ser verificavelmente íntegro.

---

## 5. O fluxo de onboarding — 7 passos

**Lê cada screenshot em `docs/onboarding-screens/` antes de implementar o passo correspondente e valida os campos contra a imagem.** O que se segue é o esqueleto e as regras; a imagem manda nos detalhes.

Regras transversais:

- Guardar automaticamente como rascunho a cada passo concluído. O cliente tem de poder sair e voltar pelo link mágico.
- Validação Zod por passo, no cliente e revalidada no servidor. Nunca confiar no cliente.
- Cada passo é uma rota própria (`/onboarding/[token]/passo/[n]`), não um estado em memória. Refresh não pode perder dados.
- Campos condicionais aparecem/desaparecem com base em respostas anteriores — sem saltos de layout bruscos.

### Passo 1 — Identificação do cliente

Tipo de cliente (particular/empresa) — **esta escolha ramifica todo o resto do fluxo**. Nome completo ou denominação social, data de nascimento, nacionalidade, naturalidade, estado civil, profissão. Documento de identificação: tipo (CC / Passaporte / Título de residência), número, validade, país emissor. Morada completa com código postal validado no formato `NNNN-NNN`. Email e telemóvel com indicativo internacional.

*Upload:* documento de identificação, frente e verso. Aviso automático se a validade for inferior a 3 meses.

### Passo 2 — Identificação fiscal

NIF/NIPC com validação de checksum mod-11. País de residência fiscal. Residências fiscais adicionais (CRS/FATCA) com TIN por jurisdição — array dinâmico. Para empresas: CAE, código de acesso à certidão permanente, regime de IVA.

*Upload:* comprovativo de NIF / certidão permanente.

### Passo 3 — Representante legal

Só relevante para empresas ou representação por procuração — **condicional ao passo 1**. Nome, qualidade/cargo, documento de identificação, NIF, contactos, âmbito dos poderes de representação. Código de acesso ao RCBE e identificação dos beneficiários efetivos (lista dinâmica: nome, NIF, % de participação, natureza do controlo).

*Upload:* procuração, ata de designação, comprovativo RCBE.

### Passo 4 — PPE (Pessoa Politicamente Exposta)

O passo mais sensível. É PPE? Se sim: cargo, país, entidade, período de exercício. É familiar próximo ou pessoa com relações próximas de PPE? Se sim: relação e identificação da PPE. Origem dos fundos e origem do património (campos obrigatórios se PPE = sim). Declaração formal com aceitação explícita.

**Regra de negócio:** PPE = sim força `nivel_risco = elevado`, exige aprovação por utilizador com papel de sócio/admin, e bloqueia a aprovação automática. Isto não é opcional — é o que a lei exige.

### Passo 5 — RGPD

Consentimentos **granulares e independentes**, um checkbox por finalidade — nunca um único "aceito tudo". Finalidades separadas: prestação do serviço jurídico, cumprimento de obrigações legais, faturação, comunicações de marketing (opt-in isolado, nunca pré-marcado). Informação sobre prazos de conservação, direitos do titular e contacto do EPD. Cada consentimento grava a versão exata do texto apresentado, data/hora, IP — porque daqui a 4 anos temos de conseguir provar o que a pessoa viu.

### Passo 6 — Dados para faturação

Denominação e NIF de faturação (com opção "igual aos dados fiscais" que copia), morada de faturação, email para envio de faturas, condições e periodicidade de pagamento, IBAN validado por mod-97 com apresentação em mono e espaçamento por grupos de 4, referência/PO interna do cliente.

### Passo 7 — Fecho, T&C e assinatura digital

Resumo da proposta (serviços contratados, modelo de honorários, valores). Aceitação dos Termos e Condições com scroll obrigatório até ao fim antes de o checkbox ativar. Aceitação da proposta. Assinatura digital.

Ao submeter: gerar o PDF do dossier completo (todos os passos + documentos anexados + página de assinatura), calcular SHA-256, gravar em `assinatura` com IP, user-agent e timestamp do servidor (nunca do cliente), enviar cópia por email ao cliente e notificar o responsável interno.

---

## 6. Back-office — os records

Esta é a metade da aplicação que não está nos screenshots e é a que mais me importa.

**`/processos` — listagem**

TanStack Table server-side. Colunas: referência (mono), cliente, tipo, estado (badge), nível de risco, responsável, progresso (7 carimbos), submetido em, última atividade. Filtros facetados com contagens: estado, tipo de cliente, nível de risco, responsável, intervalo de datas, PPE sim/não. Pesquisa global por nome, NIF e referência (full-text português com `unaccent`). Estado dos filtros na URL via nuqs. Ações em massa: atribuir responsável, exportar, arquivar. Exportação CSV e PDF — **cada exportação escreve no registo de auditoria**.

**`/processos/[id]` — detalhe**

Cabeçalho com referência, cliente, estado, nível de risco e ações. Tabs: Dados (as 7 secções, cada uma expansível e editável por quem tem permissão, com histórico de alterações campo a campo), Documentos (pré-visualização inline, download com URL assinado e registo de auditoria, alertas de validade), Auditoria (timeline completa, imutável, filtrável), Notas (internas, nunca visíveis ao cliente).

Fluxo de revisão: aprovar, rejeitar com motivo obrigatório, devolver ao cliente com indicação dos campos a corrigir (gera novo link mágico e email automático).

**`/` — painel**

Contagens por estado, processos parados há mais de X dias, documentos de identificação a expirar nos próximos 60 dias, processos de risco elevado por aprovar, atividade recente. Sem gráficos decorativos — só o que me faz agir.

**Motor de risco** (`lib/risco.ts`, função pura e testada): PPE, jurisdição de risco, estrutura societária opaca, documento próximo da validade, dados em falta. Devolve nível + fatores que o justificam. Mostra sempre o *porquê* ao lado do nível, nunca só o badge.

**Papéis:** `admin` (tudo, incluindo gestão de utilizadores), `socio` (tudo nos processos, único que aprova risco elevado), `advogado` (processos atribuídos + criar), `assistente` (criar e editar, não aprova, não vê PPE nem origem de fundos). Aplica com Row Level Security no Postgres **e** guards na aplicação. Duas camadas.

---

## 7. Estrutura de pastas

```
src/
  app/
    (auth)/                    login, mfa, recuperação
    (backoffice)/              layout com sidebar
      page.tsx                 painel
      processos/
      processos/[id]/
      definicoes/
    (cliente)/
      onboarding/[token]/      fluxo público autenticado por token
    api/
  features/                    ← organiza por domínio, não por tipo de ficheiro
    onboarding/                schemas/, componentes/, actions/, queries/
    processos/
    documentos/
    auditoria/
    risco/
  components/ui/               shadcn
  components/                  partilhados da app (Carimbo, RefProcesso, EstadoBadge…)
  db/                          schema/, migrations/, index.ts
  lib/                         validacao-pt.ts, auth.ts, storage.ts, pdf.ts, email.ts
docs/
  onboarding-screens/          os 7 screenshots
  BRIEF.md                     este ficheiro
CLAUDE.md
```

---

## 8. Plano de execução

Não escrevas código antes da Fase 0 estar validada comigo.

**Fase 0 — Análise.** Lê os 7 screenshots. Produz `docs/CAMPOS.md` com o inventário completo campo a campo: nome, tipo, obrigatoriedade, validação, condicionalidade, e a que tabela pertence. Marca claramente o que é ambíguo na imagem. Propõe o schema Drizzle. Dá-me a recomendação sobre assinatura digital (§2). **Pára e espera aprovação.**

**Fase 1 — Fundações.** Scaffold, Tailwind + shadcn, design tokens do §3, layout do back-office, auth com MFA, schema + migrações, seeds de desenvolvimento.

**Fase 2 — Fluxo de onboarding.** Os 7 passos, schemas Zod, rascunho automático, lógica condicional, uploads, a lombada com carimbos. E2E Playwright do percurso completo particular e empresa.

**Fase 3 — Back-office.** Listagem com filtros, detalhe com tabs, fluxo de revisão, motor de risco, auditoria, permissões e RLS.

**Fase 4 — Fecho.** Geração do PDF do dossier, assinatura, emails transacionais, exportações, painel.

Ao fim de cada fase: `pnpm build` limpo, `pnpm test` verde, e um resumo do que ficou feito e do que ficou por decidir.

---

## 9. Critérios de aceitação

- [ ] Um cliente completa os 7 passos num telemóvel de 360px, sai a meio, volta pelo link e não perde nada.
- [ ] O caminho "empresa + PPE" pede representante legal, beneficiários efetivos e origem de fundos, e marca risco elevado.
- [ ] O caminho "particular + não PPE" salta o passo 3 sem o deixar num limbo confuso.
- [ ] NIF, IBAN e código postal inválidos são rejeitados com mensagem que diz como corrigir.
- [ ] Nenhum documento é acessível por URL público. Todo o download fica registado.
- [ ] `evento_auditoria` não aceita UPDATE nem DELETE, e a cadeia de hashes é verificável por um script.
- [ ] Um `assistente` não consegue ver o passo 4 nem por URL direto nem por chamada à API.
- [ ] Consigo filtrar a listagem por "risco elevado + por aprovar", partilhar esse URL, e o colega vê o mesmo.
- [ ] O PDF final contém as 7 secções, os anexos e a página de assinatura com hash e timestamp.
- [ ] `pnpm build` sem erros de TypeScript. `strict: true`, zero `any`.

---

## 10. Regras para ti, Claude Code

1. **Pergunta antes de assumir.** Se um campo do screenshot é ambíguo, lista a ambiguidade em vez de inventar.
2. **Nada de dados fictícios em produção.** Seeds só em `db/seed.dev.ts`, com guard de `NODE_ENV`.
3. **Server Actions com validação Zod no servidor sempre.** A validação do cliente é UX; a do servidor é segurança.
4. **Segredos só em `.env`,** `.env.example` documentado, nunca commitados.
5. **Commits pequenos e descritivos em português,** um por unidade lógica.
6. **Mantém `CLAUDE.md` atualizado** com decisões de arquitetura e comandos, à medida que avanças.
7. **Não instales dependências que não estejam no §1** sem me explicares porquê.
8. **Quando fizeres uma escolha de design não coberta pelo §3, diz qual foi e porquê** numa linha.
