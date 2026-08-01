# Arquitetura — Plataforma de Processos Jurídicos

Documento de referência de todas as fases: o que existe, o que falta, e
**porquê** cada peça é como é. As decisões pontuais estão em `CLAUDE.md`; aqui
está o desenho completo.

Última revisão: 1 de agosto de 2026.

---

## 1. O que isto é

Plataforma interna da **PMF Consulting**, sociedade de advogados, para o
onboarding de clientes segundo os deveres de identificação e diligência da
**Lei 83/2017** (branqueamento de capitais e financiamento do terrorismo), do
**Regulamento 2/2020 da Ordem dos Advogados** e do **RGPD**.

Duas metades, com públicos e regras opostas:

| | Cliente | Escritório |
|---|---|---|
| Quem entra | qualquer pessoa com o link | utilizador autenticado |
| Como se autentica | token de uso único no URL | email + password, sessão em BD |
| O que pode | preencher o seu processo | consultar, filtrar, rever, aprovar |
| Onde vive | `src/app/(cliente)/` | `src/app/(backoffice)/` |

A separação em grupos de rotas não é organização de ficheiros: são superfícies
de segurança diferentes, e misturá-las é como se fazem fugas de dados.

---

## 2. Estado por fase

| Fase | Âmbito | Estado |
|---|---|---|
| 0 | Análise: inventário de campos, ambiguidades, modelo de dados | **concluída** |
| 1 | Fundações: schema, migrações, auth, tokens de design, painel | **concluída, em produção** |
| 2 | Fluxo de onboarding: 7 passos, condicionais, assinatura | **concluída, em produção** |
| 3 | Back-office: listagem, detalhe, revisão, motor de risco, RLS | por iniciar |
| 4 | Fecho: PDF do dossier, emails, exportações | fora do âmbito atual |

Endereço de produção: **https://poc.terlicalabs.com**

---

## 3. Como está montado

```
┌─ Cloudflare ────────── DNS, wildcard *.terlicalabs.com, proxy desligado
│
└─→ VPS Hostinger KVM 1 (Ubuntu 24.04, UE)
    │
    ├─ Coolify ─────────── deploy a cada git push, TLS automático
    │
    ├─ Traefik ─────────── encaminha por domínio, Let's Encrypt
    │
    ├─ law-project ─────── Next.js 16, imagem Docker de 3 fases
    │                      migra no arranque; se falhar, não sobe
    │
    ├─ PostgreSQL ──────── sem porta publicada, só rede interna do Docker
    │
    └─ terlicalabs ─────── site de apresentação (repositório à parte)
```

**Porquê VPS e não Vercel:** o plano Hobby proíbe uso comercial e o Pro são
20 €/mês por projeto. Um custo fixo pequeno que não cresce com o número de
clientes é melhor negócio para POCs.

**Porquê Postgres no próprio servidor e não Supabase:** o plano gratuito suspende
ao fim de 7 dias sem uso, que é exatamente o padrão de uma POC mostrada de duas
em duas semanas.

**Porquê fornecedor da UE:** isto guarda documentos de identificação e
declarações de PPE. Um fornecedor americano traz exposição ao Cloud Act mesmo
com datacenter europeu.

Guia passo a passo em [`DEPLOY.md`](DEPLOY.md).

---

## 4. Camadas da aplicação

```
src/
  app/
    (cliente)/onboarding/[token]/     fluxo público, autenticado por token
    (backoffice)/                     painel, autenticado por sessão
    api/auth/[...all]/                Better Auth
  features/                           organizado por domínio, não por tipo
    onboarding/  schemas · passos · dados · acoes · componentes
    processos/   criação e link mágico
    auditoria/   hash encadeado e escrita
  components/    vocabulário visual partilhado
  db/            schema · migrations
  lib/           validacao-pt · token · auth
```

**Porquê `features/` por domínio:** quando se mexe no onboarding, mexe-se num
sítio. A alternativa — pastas por tipo de ficheiro — obriga a saltar entre
quatro diretórios para uma mudança só.

### O caminho de um passo gravado

```
Formulário (cliente)
  └─ Zod valida ................. conforto: erros imediatos
       └─ Server Action
            ├─ revalida o token .. é um endpoint público como outro qualquer
            ├─ Zod outra vez ..... segurança: o cliente nunca é fonte de verdade
            ├─ upsert da secção
            ├─ regras de negócio . PPE → risco elevado
            └─ evento de auditoria
```

A validação corre duas vezes de propósito, com **o mesmo ficheiro de schemas**
nos dois lados. É o que impede o erro clássico de apertar o formulário e deixar
a acção aberta.

---

## 5. Modelo de dados

27 tabelas. As de secção são 1:1 com o processo, uma por passo.

```
organizacao ──┬── utilizador
              ├── contador_referencia      sequencial atómico por ano
              └── processo_onboarding ─────┬── dados_identificacao ── nacionalidade (1:N)
                                           ├── dados_fiscais ─────── residencia_fiscal_adicional
                                           ├── representante_legal ─ beneficiario_efetivo
                                           ├── declaracao_ppe
                                           ├── relacao_negocio
                                           ├── preferencias_contacto ┬ email_newsletter
                                           │                         └ area_interesse
                                           ├── dados_faturacao
                                           ├── fecho_proposta
                                           ├── documento
                                           ├── assinatura
                                           ├── consentimento ──────── versao_texto_legal
                                           └── nota

evento_auditoria    append-only, encadeado por hash, fora da árvore
```

**Porquê uma tabela por secção e não um JSONB gigante:** é preciso pesquisar por
NIF, filtrar por PPE e indexar nome. O que se pesquisa é coluna; só o que é
genuinamente variável vai para o `extra JSONB` de cada tabela.

**Porquê listas em tabelas 1:N:** a pesquisa global tem de encontrar pelo NIF de
um beneficiário efetivo, e isso não se faz dentro de um array JSON.

**IDs UUID v7 gerados na aplicação:** ordenáveis por tempo, o que dá localidade
de índice e paginação por cursor estável. Gerados em código porque o Postgres só
tem `uuidv7()` nativo na versão 18. Consequência prática: qualquer `INSERT` em
SQL cru tem de indicar o `id`.

---

## 6. Segurança e conformidade

Esta secção é a razão de ser do projeto, não um apêndice.

### Auditoria imutável

`evento_auditoria` é append-only e cada linha inclui o hash da anterior. A cadeia
é **por organização** — uma cadeia global serializaria todas as escritas do
sistema num único ponto de contenção.

A imutabilidade está na base de dados, não numa convenção de código:

```sql
CREATE RULE evento_auditoria_sem_update AS ON UPDATE TO evento_auditoria DO INSTEAD NOTHING;
CREATE RULE evento_auditoria_sem_delete AS ON DELETE TO evento_auditoria DO INSTEAD NOTHING;
REVOKE UPDATE, DELETE, TRUNCATE ON evento_auditoria FROM app_user;
```

Verificado em produção: `UPDATE` e `DELETE` devolvem **zero linhas afetadas**.

> **Buraco conhecido.** O `REVOKE` não morde enquanto o utilizador da aplicação
> for também o owner da tabela — e o owner contorna sempre. Só as `RULE`
> protegem. Criar um papel `app_user` distinto fecha isto. Registado como
> pendente, não resolvido.

A serialização é **canónica**: chaves ordenadas em qualquer profundidade. Sem
isso, o mesmo objeto serializado por dois caminhos dá hashes diferentes e a
cadeia parece adulterada sem estar.

### Token do link mágico

Guardado só em SHA-256. O valor em claro existe uma vez, no ecrã de criação.
Quem tiver leitura da base de dados não fica com a chave de todos os dossiers.
A comparação é em tempo constante, para o tempo de resposta não deixar adivinhar
o token byte a byte.

Falhas — token errado, processo apagado, link expirado — devolvem sempre a mesma
resposta. Distinguir "não existe" de "expirou" diria a quem tenta adivinhar que
acertou num.

### Assinatura

Assinatura eletrónica **simples**. O que vale como prova não é o desenho: é o
conjunto de quem assinou, de que endereço, a que horas do **relógio do servidor**
— nunca o do cliente — e sobre que conteúdo exato. O `hash_documento` é o SHA-256
do dossier inteiro em serialização canónica no momento da assinatura. Alterar um
campo depois disso faz o hash deixar de bater.

Nem esta abordagem nem integrar DocuSeal dariam assinatura **qualificada**: para
isso é preciso um QTSP (Chave Móvel Digital, Cartão de Cidadão). O raciocínio
completo está em [`DECISAO-ASSINATURA.md`](DECISAO-ASSINATURA.md).

> **Compromisso da POC.** A rubrica é guardada em base64 na coluna
> `assinatura.imagem_dados`. O certo é um bucket privado com a chave na base de
> dados. Aguenta uma POC, não aguenta escala.

### Dados sensíveis

O passo 4 — PPE e origem de fundos — é a informação mais sensível do sistema.
`assistente` não o pode ver, nem por URL direto nem por chamada à API. A regra
existe no desenho; **os guards por papel entram na Fase 3**.

PPE declarada força `nivel_risco = elevado` e bloqueia a aprovação automática.
Não é configurável: é o que a lei exige.

### Retenção

O direito ao apagamento não pode apagar o que a Lei 83/2017 obriga a conservar
sete anos. O desenho: `apagado_em` esconde da aplicação, uma rotina de expurgo só
remove de facto passados os sete anos, e `evento_auditoria` nunca é tocado —
regista quem pediu o apagamento, não os dados apagados.

**Precisa de validação jurídica.** Não é decisão técnica.

---

## 7. O fluxo de onboarding

Sete passos, cada um numa rota própria (`/onboarding/[token]/passo/[n]`). O
estado vive na base de dados, não em memória: um refresh não perde nada e o
cliente volta ao passo onde ficou.

| # | Passo | Condicional |
|---|---|---|
| 1 | Identificação | ramifica particular/empresa — decide tudo o resto |
| 2 | Fiscal + documento de identificação | campos de empresa só para empresa |
| 3 | Representante legal | **só empresa ou procuração** |
| 4 | PPE + relação de negócio | detalhes de PPE só ao responder Sim |
| 5 | Preferências de contacto | campos dependentes de newsletter e convites |
| 6 | Faturação | — |
| 7 | Declaração final + assinatura | revisão de tudo antes de submeter |

Um passo que não se aplica é **saltado**, não dá erro — quem escreve o URL à mão
ou usa o botão de voltar segue em frente. Na lombada aparece riscado em vez de
desaparecer, para se perceber que foi saltado e não perdido.

### Divergências face ao formulário atual

O formulário existente da PMF diverge do brief em pontos de âmbito, todos
registados em [`CAMPOS.md`](CAMPOS.md) §D. Os três que mais pesam:

1. O passo 7 real **não tinha** T&C, aceitação de proposta nem assinatura.
2. O passo 5 real **não é RGPD** — é captação de marketing. Os consentimentos
   granulares com prova continuam por construir.
3. O documento de identificação vive no **passo 2**, não no 1.

---

## 8. Interface

Vocabulário do **dossier de processo**: lombada, capilhas numeradas, carimbos,
identificadores em mono. Não é decoração — cada elemento codifica estado real.

| Token | Uso |
|---|---|
| `--tinta` `#101A24` | texto e sidebar |
| `--papel` `#EDEFEA` | fundo, papel de arquivo |
| `--selo` `#8C2F39` | carimbo, destrutivo, crítico |
| `--arquivo` `#2F5D50` | validado, aprovado |
| `--latao` `#A9884F` | pendente, atenção, foco |

Três famílias: `Instrument Serif` só em H1/H2, `Inter Tight` no corpo,
`IBM Plex Mono` em **qualquer identificador** — referência, NIF, IBAN, hash,
timestamp. Regra, não sugestão.

O **carimbo** é o único momento de animação com peso: 180 ms, rotação de 2,5°,
aplicado ao passo que acabou de ser gravado. Com `prefers-reduced-motion` não
acontece.

### Telemóvel

Advogados abrem isto no telemóvel, e clientes preenchem-no lá.

- Lombada deita-se em fita horizontal com barra de progresso
- Barra de ações colada ao fundo, com `env(safe-area-inset-bottom)`
- Campos a **16px**: abaixo disso o Safari do iOS faz zoom sozinho e desalinha a
  página — sozinho, isso estraga um formulário de sete passos
- Assinatura a dedo, com o canvas redimensionado pelo rácio de píxeis do ecrã
- Zero scroll horizontal a 360px

---

## 9. Testes

| Camada | O quê |
|---|---|
| Unitários | validações PT (NIF mod-11, IBAN mod-97, código postal, telefone) — 21 |
| Unitários | cadeia de hashes: determinismo, ordenação canónica, deteção de adulteração — 8 |
| Migrações | `pnpm db:validar` aplica tudo num Postgres em WASM e prova que a auditoria recusa `UPDATE`/`DELETE` e que a pesquisa resolve acentos |
| Produção | percurso completo dos dois caminhos, feito à mão contra a base de dados real |

**Em falta:** E2E Playwright dos dois percursos. É o que falta para isto deixar
de depender de alguém se lembrar de testar.

---

## 10. O que falta, por ordem de importância

1. **Fase 3 — back-office.** Listagem com filtros e o detalhe do processo. Sem
   isto os processos entram e ninguém os gere.
2. **Guards por papel + RLS.** A regra de o `assistente` não ver PPE existe no
   desenho e não no código.
3. **Papel `app_user`** separado do owner, para o `REVOKE` da auditoria morder.
4. **Consentimentos RGPD com prova** — versão do texto, data/hora, IP.
5. **Uploads de documentos.** A tabela existe, a interface não.
6. **E2E Playwright.**
7. **Beneficiários efetivos e RCBE.** Obrigação legal, schema pronto, sem UI.
8. **Validação jurídica** da retenção aos 7 anos.
9. **Object storage** para a rubrica e os documentos.
10. **Screenshots do percurso Empresa** — foi construído a partir do texto do
    brief, sem imagem para validar. Risco de retrabalho assumido.

---

## 11. Comandos

```bash
pnpm dev                  # desenvolvimento
pnpm build                # tem de passar limpo
pnpm typecheck            # strict, zero any
pnpm test                 # Vitest
pnpm db:generate          # nova migração a partir do schema
pnpm db:migrate           # aplica
pnpm db:validar           # aplica tudo num Postgres em WASM e verifica
pnpm db:seed              # só em desenvolvimento
pnpm auditoria:verificar  # revalida a cadeia de hashes
```
