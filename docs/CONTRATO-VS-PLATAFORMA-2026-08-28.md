# CONTRATO vs PLATAFORMA — Verificação cláusula a cláusula

**Contrato:** Prestação de serviços Milba (VEILOA LTD, UK) ↔ Diogo (PRESTADOR) — execução da LexFlow para uma sociedade de advogados (CLIENTE).
**Data da auditoria:** 28/08/2026 · **Método:** código em `C:/Users/diogo/Desktop/law-project-repo` (HEAD `128633f`), testes executados (796/796 green), verificação de rede ao POC (`poc.terlicalabs.com`). A BD de produção (SSH 2.24.141.179) estava inacessível nesta sessão (timeout SSH) — os pontos que dependem da BD real estão assinalados.
**Nota legal:** minuta com campos por preencher (nº registo, NIF, NIPC, IBAN, valores indemnizatórios, data do R6). Não constitui aconselhamento jurídico.

**Legenda:** CUMPRE / PARCIAL / NAO CUMPRE / RISCO

---

## Resumo executivo — bloqueadores da 1.ª tranche

| # | Bloqueador | Estado | Cláusula |
|---|---|---|---|
| B1 | **Servidor de produção no Reino Unido** (IP 2.24.141.179 = srv1870501.hstgr.cloud, Manchester, GB) — o contrato EXIGE tratamento exclusivamente no UE | NAO CUMPRE | 16.5, Anexo III.5 |
| B2 | **Sem backups** — nada no repositório; PLANO_IMPLEMENTACAO.md 1.6: "no backups today". Anexo III.7 exige "cópias de segurança diárias com restauro testado" | NAO CUMPRE | Anexo III.7 |
| B3 | **Documentos em base64 na BD** (schema/documentos.ts, coluna `dados`; assinatura idem `imagemDados`; logotipo idem) | PARCIAL (SFTP existe; base64 é o caminho principal) | 12.1.a (R1) |
| B4 | **Isolamento entre sociedades**: o bug crítico apontado no plano (`listarProcessos()` sem filtro por org) está CORRIGIDO no código atual + RLS ainda não implementado + teste E2E 2-sociedades ainda não existe | PARCIAL | 12.1.b (R6) |
| B5 | **Subcontratantes ulteriores**: Resend (envio email), Twilio SendGrid (planeado), SFTP/Hetzner, futura IA — o Anexo III.8 diz "Nenhum" e o contrato exige autorização escrita prévia (art. 28.º, n.º 2 e 4 RGPD) e autorização do CLIENTE ao recurso ao PRESTADOR | RISCO CRÍTICO | 16.2/16.5, Anexo III.8 |
| B6 | **Telemetria/tickets/customer service não existem** (zero código) — mas são condição de pagamento da Fase 1 (2.ª tranche de trabalho) | NAO CUMPRE | 9.6, Anexo I |
| B7 | **Retenção 7 anos**: modelo de dados está alinhado (soft delete, auditoria imutável, "dura sete anos" em todo o código), mas SEM backup não há retenção demonstrável | PARCIAL | 16.7, Anexo III.6 |

---

## Cláusula 12 — Pré-requisitos técnicos (R1 e R6)

**Cláusula 12.2/12.3:** executar R1 e R6 "até [data / antes da implementação da primeira tranche]". **Nenhum cenário com mais de uma sociedade antes de concluídos e verificados.**

| Exigência | Estado | Evidência | Ação necessária | Prazo realista |
|---|---|---|---|---|
| **R1** — documentos fora da BD, em object storage | **PARCIAL** | `src/db/schema/documentos.ts:34-42` — coluna `dados` (base64, limite 4 MB) com comentário "It holds up for a POC; it does not hold up for an archive". `assinatura.imagemDados` (documentos.ts:81) e `organizacao.logotipoDados` (organizacao.ts:164) idem. Existe arquitetura de destino: `src/lib/storage/tipos.ts` (interface `Destino`, SFTP fixo) + `src/lib/storage/cifra.ts` (AES-256-GCM para credenciais). O plano (PLANO_IMPLEMENTACAO.md 0.1) aponta para AWS S3 `eu-central-1` | Script de migração: extrair base64 → upload bucket privado UE → backfill `chaveStorage` + limpar `dados`; levantar limite 4 MB; testes de upload/download (caminho pré-assinado com expiração) | 3–5 dias úteis |
| **R6** — isolamento entre sociedades | **PARCIAL** (corrigido no código, falta verificar + endurecer) | **Corrigido:** `src/features/processos/consultas.ts:34-38` — `daOrganizacao()` é a 1.ª condição de todas as 4 consultas; chamada real em `src/app/(backoffice)/processos/page.tsx:74` passa `eu.organizacaoId`. Testes com isolamento: aprovacao.test.ts:270 ("um utilizador de outra organização não encontra o processo"), exportar-pdf.test.ts:236 ("recusa processos de outra organização"), idor.test.ts, logotipo-onboarding.test.ts:238, gestor-processos.test.ts:69, super-admin-restricoes.test.ts. Suite completa: **796/796 green (executado 28/08)**. **Falta:** RLS no Postgres (o papel da app é owner das tabelas — PLANO 0.2) e o teste E2E "2 sociedades não vêem os dados uma da outra" | (1) Confirmar em produção que `listarProcessosPlataforma` (admin/processos/page.tsx:30) é de facto restrito a `super_admin`; (2) RLS por `organizacao_id` com papel da BD não-owner; (3) teste E2E de isolamento real (duas sociedades semeadas, um login em cada, verificar zero fuga — incluindo download de documentos e pesquisa full-text) | 2–4 dias úteis (1.º) |

**Veredicto C12:** os dois pré-requisitos estão em ~70–80% no código, mas a cláusula exige **concluídos e verificados antes da 1.ª tranche**. Hoje, não se pode assinalar "concluído". R6 é prioridade máxima (dados de processos confidenciais).

---

## Cláusula 16 + Anexo III — Proteção de dados (art. 28.º RGPD)

| Exigência (Anexo III.7) | Estado | Evidência | Ação necessária | Prazo |
|---|---|---|---|---|
| "autenticação sem palavra-passe com tokens de expiração" | **DIVERGE — PARCIAL** | `src/lib/auth.ts`: **email + palavra-passe** (Better Auth, `disableSignUp`, min 12 chars), sessões DB de **30 dias** (comentário: "deliberado para a POC... deve ser revista para 8h, D14"). Para o CLIENTE existe sim "sem palavra-passe": link mágico de uso único com token hasheado (`src/lib/api.ts:21`, `src/db/schema/email.ts` tokenHash) | Decisão necessária: (a) renegociar o texto do Anexo III, ou (b) encurtar sessão interna p/ 8h + MFA/TOTP (auth.ts:9 diz que é plugin e não refactor). **Assinalar antes de assinar** — divergência entre anexo e realidade é a porta de entrada de um incumprimento | Antes da assinatura |
| "OTP de validação de assinatura" | **CUMPRE** | `src/db/schema/otp.ts` — código 6 dígitos, SHA-256 + sal, expiração, limite 5 tentativas, histórico; template `emailCodigoOtp` (jmassano.ts:225). Nota: OTP email, não SMS — confirmar que satisfaz o Anexo | — | — |
| "controlo de acessos por perfis" | **CUMPRE** | RBAC: papéis `super_admin` / `society_admin` / `gestor` / `utilizador` (schema/organizacao.ts:237, check constraints 327-335); `podeVerPpe`/`podeAprovarProcesso` negados a super_admin (super-admin-restricoes.test.ts:79-81); exportação só `society_admin` (exportar.test.ts:182) | — | — |
| "isolamento entre sociedades" | **PARCIAL** | ver Cláusula 12/R6 | RLS + E2E | ver C12 |
| "cifragem em trânsito e em repouso" | **PARCIAL** | Em trânsito: HTTPS com Let's Encrypt (verificado: emissor R2, válido até 29/10/2026); SFTP para arquivo. Em repouso: só as **credenciais** de armazenamento são cifradas (AES-256-GCM, lib/storage/cifra.ts); a BD em si não tem cifragem at-rest declarada nem os ficheiros no bucket | Ativar cifragem at-rest do Postgres/disco (volume cifrado no VPS) + SSE no bucket S3; escrever no Anexo III o que é de facto | 1–2 dias |
| "registo de acessos e decisões com identificação e momento" | **CUMPRE** | `evento_auditoria` (schema/auditoria.ts): ator, ação, entidade, IP, user-agent, timestamp tz, hash chain; imutabilidade garantida em SQL (migração 0002: REVOKE + RULE DO INSTEAD NOTHING; 0024 bloqueia TRUNCATE). Download de documentos audita (schema/documentos.ts:18-20). Verificador: `scripts/verificar-auditoria.ts` | Na BD de produção, verificar que a chain passa e que os downloads de documentos estão a ser registados (SSH estava inacessível) | verificação, 1h |
| "cópias de segurança diárias com restauro testado" | **NAO CUMPRE** | Zero referências a pg_dump/cron/restore no repositório; PLANO_IMPLEMENTACAO.md 1.6: "no backups today". **Este é o bloqueador mais grave**: sem backup, a retenção de 7 anos e a resiliência do art. 32.º RGPD não existem | pg_dump diário cifrado → bucket S3 UE com versionamento + teste de restauro documentado e datado (prova!) | 1–2 dias + 1 teste |
| "retenção: 7 anos (Lei 83/2017)" | **PARCIAL** | Modelo de dados alinhado: soft delete (comum.ts:24-28 "Lei 83/2017 requires 7 years"), auditoria imutável "dura sete anos" (enums.ts:172, acoes.ts:687), documentos nunca removidos fisicamente (logotipo-onboarding.test.ts:299). Falta: política de expurgo *após* 7 anos + backup que comprove a retenção | Documentar política de retenção/expurgo; backup diário (B2) | 1 dia |
| "tratamento exclusivamente em território da UE" (Anexo III.5; 16.5) | **NAO CUMPRE** | Verificado por rede: `ipinfo.io/2.24.141.179` → **srv1870501.hstgr.cloud, Manchester, England, GB** (Hostinger). O PLANO_IMPLEMENTACAO 1.1 já prevê migração para Lituânia (Hostinger, mesmo preço) mas **não foi feita**. Resend: infra em região US (dados em trânsito pela API) — verificar DPA/região; Twilio SendGrid igualmente US | **Migrar servidor para Vilnius (LT)** + rever canais de email (DPA com SCCs) ou renegociar o Anexo III.5 | 3–7 dias (migração em si ~1 dia) |
| "subcontratantes ulteriores: Nenhum" (Anexo III.8) + autorização escrita prévia (16.5, art. 28.º n.º 2 e 4 RGPD) | **RISCO CRÍTICO** | A plataforma **não pode operar sem Resend/SendGrid** (envio transacional), sem SFTP/servidor (Hetzner/Hostinger) e o plano prevê IA no customer service. Três conflitos: (1) Anexo III diz "Nenhum" mas há pelo menos 2 subcontratantes na prática; (2) o Considerando D diz que a **infraestrutura é titulada pelo CLIENTE** — se é o CLIENTE que contrata Resend/Hostinger, o fluxo de autorização é outro e o Anexo III.8 pode nem aplicar-se, mas tem de ficar escrito assim; (3) art. 28.º n.º 2: a eficácia da cláusula 16 depende de **autorização escrita do CLIENTE ao recurso ao PRESTADOR** — nada indica que exista | **NÃO ASSINAR sem resolver:** ou o Anexo III lista os subcontratantes (Resend/SendGrid, Hostinger/Hetzner LT, fornecedor IA, Cloudflare R2 se aplicável) com a sua base de transferências, ou o Considerando D é reforçado para dizer que TODA a infra é contratada a nome do CLIENTE. Confirmar por escrito a autorização do art. 28.º n.º 2 | Antes da assinatura |
| 16.4 — notificação de violação em 24h à MILBA | **RISCO** | Não existe procedimento interno de resposta a violações (runbook de incidentes). A plataforma regista o suficiente para detetar (auditoria, email_log), mas não há quem vigie nem processo de escalonamento | Runbook: deteção → avaliação → notificação à MILBA em 24h (que notifica o responsável para a CNPD em 72h, art. 33.º RGPD) | 1 dia |
| 16.6 — dados anonimizados/pseudonimizados em dev/teste | **CUMPRE** | Seed dev (seed.dev.ts) com dados fictícios; testes usam mocks/factories, nunca dados reais (796 testes verificados) | — | — |

---

## Cláusula 9 — Telemetria de incidentes e bolsa de horas

| Exigência | Estado | Evidência | Ação | Prazo |
|---|---|---|---|---|
| Sistema de telemetria que registe, por ocorrência: **executante, nível, duração da interação ativa e valor descontado, com fator 1.2× no nível 3; extrato mensal assinado digitalmente** (9.6) | **NAO CUMPRE** | Zero código: sem motor de tickets, sem chatbot, sem base de conhecimento, sem bolsa de horas (PLANO_IMPLEMENTACAO.md Fase 2: "still to be built (zero code)"; `grep -ri telemetria|ticket|bolsa` → 0 resultados funcionais). Esta é a condição de pagamento da 2.ª metade da Fase 1 | Construir customer service (chatbot L1, tickets L2/L3, medição de tempo, extrato mensal assinado). **Atenção:** o fator 1.2× e a repartição 75/25 têm de estar no motor, senão a faturação entre as Partes não é auditável | 4 semanas (é a Fase 1, 2.ª parte) |

---

## Cláusula 10 — SLA

| Exigência | Estado | Evidência | Ação | Prazo |
|---|---|---|---|---|
| Credenciais de novo utilizador em 48h laborais | **PARCIAL** | Gestão de utilizadores é **só CLI** (`scripts/criar_utilizador.mjs`) — a plataforma não tem UI de gestão nem registo de "pedido de credenciais" vs "entrega" que permita **provar** o cumprimento do prazo | UI de gestão de utilizadores com timestamps de pedido/entrega, ou registo manual datado em documento de operação | Fase 3.2 |
| Correção de incidente bloqueante em 1 dia útil; intervenção L2/L3 após classificação | **NAO CUMPRE (não mensurável)** | Sem motor de tickets (C9) não há como medir "classificação" nem "início de intervenção" — a plataforma não suporta provar o SLA. Nota: 10.5 protege o PRESTADOR por falha de infraestrutura do CLIENTE, mas a **prova** de quem causou o quê precisa da telemetria | Incluído no motor de tickets (C9) | Fase 1 |
| Passagem a produção / customer service em 2 semanas (cada) | **EM RISCO** | ver Cláusula 5 | ver Cláusula 5 | — |

---

## Cláusula 14 — Propriedade intelectual (só assinalar, não alterar)

- **RISCO ALTO — cessão total e perpétua (14.1-14.3):** cede-se "a totalidade dos direitos patrimoniais... sem limitação territorial ou temporal", incluindo sublicenciamento a terceiros, com remuneração restrita aos valores do contrato (326,25 €/bloco de 2 semanas + 2,25 €/utilizador). O software LexFlow deixa de ser do Diogo. A cessão "opera com a criação de cada elemento" — ou seja, desde o 1.º commit.
- **RISCO — 14.6/Anexo II:** a obrigação é identificar componentes de terceiros com licença que permita sublicenciar. **O Anexo II está vazio ("Nenhum" se não existirem)**, mas o produto usa Next.js, Drizzle, Better Auth, React, Tailwind, Resend SDK, etc. — todas permissivas (MIT/Apache), mas o Anexo II **tem de as listar** antes da assinatura, senão há incumprimento do n.º 6 no dia 1. (MIT permite sublicenciamento; cumprido, mas tem de estar escrito.)
- **RISCO — 14.7 (material preexistente):** se o Diogo quiser conservar ferramentas suas (ex.: estrutura de agents), tem de as identificar no Anexo II agora; depois de assinado, tudo que nascer é da MILBA.
- **Positivo:** 14.8 permite portefólio genérico (com autorização prévia).

## Cláusula 17 — Não angariação (só assinalar)

- **RISCO ALTO — 24 meses** pós-cessação, sobre "o CLIENTE ou qualquer sociedade de advogados apresentada pela MILBA". Como a MILBA apresenta sociedades continuamente, o círculo alarga-se com o tempo — a compensação é o n.º 2 (livre atividade com "quaisquer outros clientes").
- **RISCO — 17.3:** indemnização **por preencher [___] €** — NÃO ASSINAR com o campo em branco: um número em branco num contrato assinado é litígio garantido sobre o valor.

## Cláusula 15 — Confidencialidade e sigilo (referência cruzada)

- 15.2 invoca o art. 92.º EOA e obriga o PRESTADOR a "não aceder a conteúdos de processos salvo na estrita medida do indispensável... **mediante registo da ocorrência**". **LACUNA operacional:** o acesso do Diogo (super_admin) a processos reais tem de ser registado — a plataforma regista acessos da organização, mas o acesso transversal do super_admin em produção deve ter trilho próprio (`evento_auditoria.acao` tipo `admin.acedeuProcesso`) e o Diogo deve restringir-se a acessos técnicos (não ler conteúdos). Isto alinha com as regras da equipa (sigilo OA, art. 92.º EOA + art. 84.º a quem colabora).

---

## Cláusulas 5/6 — Fase de arranque e prazos

| Trabalho | Prazo contratual | Estado real | Falta | Realista |
|---|---|---|---|---|
| Passagem a produção (migração UK→LT, DNS, email, TLS, verificação E2E) | 2 semanas | **NÃO INICIADO** — servidor ainda em Manchester (GB, verificado hoje); DNS/TLS funcionam no POC (TLS Let's Encrypt válido) | 1. Migração VPS Hostinger LT (snapshot → nova VPS → sync BD) 2. DNS do domínio final 3. TLS automático (Coolify/Traefik já suportado) 4. Verificação E2E 5. **backups + fechar porta 8000** (1.6) 6. R1 (storage) e R6 (RLS+E2E) ANTES de qualquer 2.ª sociedade | 1 semana de trabalho efetivo; condicionado a acessos ao domínio/VPS |
| Customer service (IA, tickets, correio, KB, escalonamento, telemetria) | 2 semanas | **NÃO INICIADO** — zero código | Todo (chatbot, tickets, KB, bolsa de horas, extrato assinado) | 2–3 semanas de desenvolvimento; **2 semanas é agressivo** |
| Pré-requisitos R1+R6 | antes da 1.ª tranche | PARCIAL (ver C12) | R1 migração storage; R6 RLS + E2E | 3–5 dias |

**Cronograma crítico:** R1+R6 (semana 1) → migração LT+DNS+TLS+backups (semana 1-2) → customer service (semanas 2-4). Factível nas 4 semanas da Fase 1 **se** os pré-requisitos forem tratados primeiro e os acessos (domínio, DNS, conta Hostinger LT) existirem.

---

## Recomendações antes de assinar (não alterar código — decisões)

1. **Anexo III.8 ("Nenhum")** é falso no estado atual da plataforma — reescrever com a lista real de subcontratantes OU ancorar tudo no Considerando D (infra titulada pelo CLIENTE). **Este é o risco jurídico n.º 1** (art. 28.º, n.º 2 e 4 RGPD: subcontratação sem autorização escrita é violação RGPD imputável).
2. **Anexo III.7 vs realidade:** "autenticação sem palavra-passe" só existe para o cliente final; o backoffice é password+sessão 30 dias. Ou se ajusta o anexo, ou se encurta sessão/MFA antes da produção.
3. **Anexo II vazio** — listar os componentes open source (14.6) e material preexistente (14.7).
4. **Campos em branco:** indemnização da 17.3, nº de registo VEILOA, foro (Leiria?) — preencher antes de assinar.
5. **Obter por escrito** a autorização do CLIENTE ao recurso ao PRESTADOR (16.2 / art. 28.º n.º 2) — sem ela a cláusula 16 nem sequer é eficaz.
6. **Cláusula 12.2 com data aberta** ("até [data / antes da implementação da primeira tranche]") — fixar data concreta, senão o gate da 12.3 é discutível.

## Sequência de execução para a 1.ª tranche (bloqueadores primeiro)

1. **Semana 1:** R6 — RLS + teste E2E 2-sociedades · R1 — migração para bucket privado UE · backups diários com restauro testado
2. **Semana 1-2:** migração UK→Lituânia · DNS · TLS · fechar porta 8000 · verificação E2E
3. **Antes de implementar qualquer 2.ª sociedade:** checklist de aceitação do PLANO_IMPLEMENTACAO §5 (inclui "2 isolated firms cannot see each other's data") assinado como prova de que a 12.3 está satisfeita
4. **Semanas 2-4:** customer service + telemetria (condição de pagamento da 2.ª parte da Fase 1)

---

*Fontes: RGPD arts. 28.º, 32.º-36.º; Lei 83/2017 (retention 7 anos); art. 92.º EOA (sigilo, estendido a colaboradores). Evidência de código citada com ficheiro:linha. BD de produção não verificada nesta sessão (SSH timeout) — pendente confirmação de: contagem de evento_auditoria, documentos ainda em base64 na BD real, estado de backups no servidor.*
