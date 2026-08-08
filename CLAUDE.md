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

### Atualização — melhorias pedidas pela JMASSANO (análise de 07/08/2026)

Oito pontos, do documento de análise do cliente (João Massano Escritório de Advogado).

- **Logo no cabeçalho.** `public/logo_jm.png` substitui o texto "POC" no cabeçalho do
  onboarding — que vive no layout, por isso aparece nos sete passos de uma vez — e no
  cabeçalho do ecrã de entrada.
- **Passo 3 só para pessoas coletivas** (D28), com a semântica invertida (D29) e "Relação com
  o cliente final" a passar a **Cargo**.
- **Passo 4** com sugestões clicáveis por baixo de cada caixa, em vez da lista de exemplos
  numa linha de ajuda que ninguém lia. Clicar acrescenta; clicar outra vez tira.
- **RGPD**: "Outro" em *como chegou até nós* abre caixa de texto (a mesma coluna
  `origem_detalhe` do "quem?" da recomendação, e obrigatória pela mesma razão); áreas de
  interesse ganham "Outra área" com caixa livre, que entra na lista como mais um valor —
  sem migração, a tabela já era de texto livre; e o "sim" aos convites traz o nome e o email
  do passo 1 já preenchidos, editáveis.
- **Passo 7**: leitura obrigatória dos T&C (D30).
- **Três emails** com os assuntos **e os corpos** que o cliente escreveu (D31, D33).
- **Só SFTP** (D32): o OneDrive e o WebDAV saíram do código, do schema e dos scripts.
- **Página de entrada** sem o bloco "Como funciona".

Os **textos dos três emails** deixaram de estar por confirmar (07/08/2026): os corpos em
`src/lib/emails/jmassano.ts` são agora os do documento de análise, à letra — ver D33.

Fica por confirmar o articulado dos **T&C** em `src/lib/termos.ts`: é texto de demonstração
escrito a partir do que a lei obriga a constar. Ao substituí-lo, subir também `VERSAO_TERMOS` —
é essa versão que fica gravada junto do consentimento, e mudar o texto sem mudar a versão
apaga a diferença entre o que o cliente aceitou e o que passou a estar escrito.

### Atualização — diário de emails, logo no back-office

08/08/2026.

- **`email_log`** (D34): uma linha por tentativa de envio, escrita pelo próprio `enviarEmail` e
  não por quem o chama — é isso que garante que um caminho de envio novo não pode nascer sem
  entrar no diário. Sucesso e erro entram os dois, incluindo o caso da `RESEND_API_KEY` que
  falta: a pergunta que se faz é "o cliente recebeu alguma coisa?", e ela só tem resposta se as
  falhas ficarem gravadas com o motivo. Migração `0008`. Vinte-oito tabelas.
- **`/emails`** no back-office, entre Clientes e Configuração: data, destinatário, assunto,
  tipo, processo e estado, com o motivo da falha por baixo do assunto. Pesquisa por
  destinatário/assunto/referência e filtros facetados por estado e por tipo, com o estado no
  URL — mesmo padrão do `/processos`. **Só administração** (D35).
- **Logo no back-office**: `public/logo_jm.png` passa a estar também no cabeçalho da barra
  lateral, onde dizia "POC". Com os quatro sítios onde já estava — os sete passos do
  onboarding, a entrada, os T&C — o logo está agora em todo o lado onde há cabeçalho.
- **Verificado sem alterações**: os três emails a bater com o documento do cliente à letra,
  remetente `POC@jmassano.pt`; passo 3 só para pessoas coletivas; "Cargo" no lugar de
  "Relação"; nenhum bloco "Como funciona" na entrada; OneDrive/WebDAV sem vestígios no código
  (o que resta são comentários, a migração `0006`/`0007` que é história, e o teste que confirma
  que um `protocolo: "webdav"` é recusado à entrada).

### Atualização — auditoria completa da plataforma

08/08/2026. Varrimento de todas as páginas — painel, processos, clientes, configuração, emails,
os sete passos do onboarding nos dois percursos, entrada, T&C, 404 e erro.

**O modal "Novo processo" (D36).** Não era um modal: era um bloco que substituía o botão no
sítio onde o botão estivesse. No painel abria encostado à direita dentro do cabeçalho e
empurrava-o; no cartão vazio abria centrado e com outra largura. E, criado um processo, o
painel do link ficava no lugar do botão até alguém recarregar a página — **não havia como criar
um segundo processo**. Passou a janela a sério (`components/ui/dialog.tsx`, novo, sobre o
`radix-ui` que o `sheet` já usava), com o mesmo par de fichas do passo 1 do onboarding para o
tipo de cliente, `role="radiogroup"` em vez de dois `aria-pressed`, rodapé com os botões
alinhados, e o email validado antes de haver processo criado.

**Cinco defeitos funcionais:**

1. **Risco só subia.** Declarar PPE punha o processo em risco elevado; voltar atrás e corrigir
   para "Não" deixava-o elevado para sempre, com o fator "pessoa politicamente exposta
   declarada" por baixo de uma declaração que dizia o contrário. Agora repõe-se, com
   `risco.reposto` na auditoria.
2. **Cliente estrangeiro bloqueado no passo 5.** O passo 2 aceita um número fiscal de outro país
   (`nifPortugues = false`), mas a faturação impunha o mod-11 português a toda a gente: não
   havia número que passasse, nem o dele. Passa a aplicar o checksum só a nove dígitos — que é
   o que apanha o dígito trocado — e a aceitar qualquer outra forma. Testes em
   `schemas.test.ts`.
3. **Filtro de PPE aberto ao `assistente`.** O detalhe esconde-lhe o passo 4 e regista a
   tentativa, mas `?ppe=sim` na listagem dava-lhe a mesma informação em bloco. O filtro é
   ignorado no servidor e não aparece na barra.
4. **Endereço pessoal escrito no código.** O aviso de submissão caía num Gmail pessoal quando
   `EMAIL_NOTIFICACOES` faltava, com referência e link do dossier. Sem valor por omissão: não
   havendo destino, o aviso não sai (D37).
5. **Consentimento congelado.** `textoEmVigor` devolvia a linha mais recente da chave, por isso
   mudar o texto aqui nunca chegava a uma instalação a correr — o cliente consentia o
   articulado antigo. Passou a procurar por chave *e* versão (D38).

**Textos.** "POC Consulting" no ecrã de submissão e "PMF Consulting" nos consentimentos RGPD e
nos cabeçalhos dos dois PDFs passaram a JMASSANO. O passo 4 prometia "aprovação de um sócio ou
administrador" (apagada na D20) e explicava o cálculo do risco ao cliente (escondido na D21) —
passou a explicar o que é uma PPE e porque a pergunta é obrigatória. O 404 oferecia "Pedir novo
link" para `/entrar`, que é a entrada da equipa.

**Visual e acessibilidade.** Logo JM no 404 e no ecrã de erro, os dois últimos sítios onde
ainda dizia "POC" — com o título do separador, agora "· JMASSANO". Os `<select>` tinham `h-9`
contra os `h-8` do `Input` e ficavam desalinhados na mesma linha da grelha, sem anel de foco:
partilham agora a pele do input (`classeSelect`). Etiquetas de `CampoLista`, `Anexos` e
`Assinatura` alinhadas em `text-tinta-suave` com as do `Campo`. Os três grupos de pastilhas do
filtro de processos ganharam rótulo — liam-se como uma fila só. Um processo em rascunho abria
com seis cartões vazios no detalhe; dizem "passo ainda por preencher". O fim do exercício de
uma PPE era recolhido e nunca mostrado. O leitor de T&C, que liberta a aceitação de um
contrato, não tinha armadilha de foco: o `Tab` saía para o formulário por baixo. Assenta agora
no `Dialog`, com a medição da D30 intacta.

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
| D27 | Cada pasta de cliente leva dois PDFs: o `summary.pdf` com o detalhe do processo e o `dados_cliente.pdf` — capa com data, referência, nome, NIF e o índice dos ficheiros. O nome do segundo não é escolha nossa, é o que o auxiliar em Python já deixava em cada pasta de cliente e por onde se procura o dossier. A capa gera-se em último, quando já se sabe o que indexar, e não se indexa a si própria | `src/lib/storage/capa.ts` |
| D28 | Passo 3 (Representante Legal) só aparece a pessoas coletivas. Uma pessoa singular representa-se a si própria — a pergunta não tem resposta possível. A **numeração não se mexe**: o passo continua a ser o 3 e o Fecho o 7, porque renumerar partia os rótulos de auditoria (`passo.N.gravado`), a restrição `passo_valido` e os links de "Corrigir" já gravados. O que muda é o percurso: `passosDoProcesso`, `proximoPasso` e `passoAnterior` saltam-no, e a contagem do cabeçalho passa a "de 06" | `src/features/onboarding/passos.ts` |
| D29 | A pergunta do passo 3 inverte-se: "É o representante legal desta entidade?" — **Sim** avança (quem preenche já se identificou no passo 1), **Não** abre os campos do representante. Sem resposta de partida, ao contrário do que estava: pré-responder a uma declaração sobre quem age em nome de quem é dá-la por feita. Trocar para pessoa singular no passo 1 apaga a linha do representante — deixada lá, aparecia no PDF do arquivo a descrever um processo que já não é aquele | `src/features/onboarding/schemas.ts` |
| D30 | A caixa de aceitação dos T&C só se destranca depois de o documento ser aberto e percorrido até ao fim, estilo banca. O texto é renderizado dentro do leitor e não num `iframe`: assim o fim do documento é uma medição do próprio elemento, sem depender de o browser deixar ler o `scrollTop` de outro documento. Um documento que caiba todo no ecrã conta como lido — senão a caixa ficava trancada para sempre num monitor grande. O mesmo texto está em `/termos-condicoes` e vai em PDF no email de boas-vindas, os três da mesma fonte | `src/lib/termos.ts` |
| D31 | Três emails ao cliente, todos em `src/lib/emails/jmassano.ts`: **JMASSANO \| Registro** (com o link, no momento em que a sociedade cria o processo), **JMASSANO \| Confirmação de Receção dos seus Dados** e **Bem-vindo à JMASSANO Escritório de Advogado** (com resumo, T&C e proposta de honorários em anexo). Os dois últimos saem os dois na submissão porque a POC não tem passo de aprovação (D20) — não há um segundo momento em que dar as boas-vindas. O resumo anexado é o mesmo `summary.pdf` que vai para o arquivo, gerado do mesmo sítio, para o cliente e a sociedade não ficarem com versões diferentes do mesmo documento | `src/lib/emails/jmassano.ts` |
| D32 | Um só destino de armazenamento: o servidor da sociedade, por SFTP. O OneDrive e o WebDAV saíram do código, do schema (a coluna `tipo` e o enum `tipo_armazenamento` foram removidos na migração `0007`) e dos scripts (`gera_pasta_cliente.py` apagado). O `protocolo` fica no schema Zod fixo em `z.literal("sftp")`, e não desaparece: é o que faz uma configuração antiga noutro protocolo rebentar à entrada em vez de ser tratada como SFTP. A migração apaga as credenciais das linhas que estavam em `onedrive` — um segredo do Graph sem finalidade não fica gravado | `src/db/migrations/0007_armazenamento_so_sftp.sql` |
| D34 | `email_log` é escrita dentro de `enviarEmail` e não nos sítios que enviam, e o `template` é parâmetro obrigatório: um caminho de envio novo não compila sem responder "que email é este", o que fecha a porta a envios por registar. Não é auditoria e não a substitui — `evento_auditoria` continua append-only com cadeia de hashes e é o que a lei obriga a conservar; isto é o diário técnico do canal, que se trunca sem consequência. Guarda o **hash** do token e nunca o token em claro (senão bastava ler a tabela para entrar em qualquer dossier, contra a D4), e não guarda o corpo das mensagens — duplicar dados pessoais numa tabela de diagnóstico é multiplicar superfície RGPD sem nada ganhar. A gravação nunca lança: um email que não sai *porque* o registo falhou é pior do que um email por registar | `src/lib/email.ts` |
| D35 | `/emails` é só para o papel `admin`, com o guard na página (`exigirAdmin`) e não só na barra lateral — esconder a entrada da navegação não fecha o endereço a quem o escreva à mão. A lista mostra endereços de clientes lado a lado, é de diagnóstico e não de trabalho diário. Os valores de `?estado=` e `?template=` são filtrados contra o enum antes de chegarem ao `inArray`: sem isso, um parâmetro escrito à mão era um 500 a partir do URL | `src/app/(backoffice)/emails/page.tsx` |
| D36 | "Novo processo" é uma janela (`components/ui/dialog.tsx`, sobre o `radix-ui` que o `sheet` já usava) e não um bloco em linha. Aberto em linha, o formulário tinha a largura e o alinhamento do sítio onde calhasse estar, e o painel do link que se lhe seguia ficava no lugar do botão até alguém recarregar a página — o que impedia criar um segundo processo. O conteúdo só monta com a janela aberta: é isso que garante que ela reabre limpa | `src/features/processos/componentes/BotaoNovoProcesso.tsx` |
| D37 | `EMAIL_NOTIFICACOES` sem valor por omissão. O que lá estava era um endereço pessoal escrito no código, e numa instalação a que faltasse a variável eram referências e links de dossiers de clientes a sair para a caixa de correio de quem escreveu o código. Sem destino configurado, o aviso ao back-office não sai e fica um `console.warn` — os dois emails ao cliente e o arquivo em SFTP não dependem dele. O endereço do link também deixou de estar escrito à mão: sai dos cabeçalhos do pedido, como já saía o do email de registo (`lib/origem.ts`, agora partilhado) | `src/features/onboarding/acoes.ts` |
| D38 | `textoEmVigor` procura por **chave e versão**, e não pela linha mais recente da chave. Assim não estava: bastava existir uma linha para ela ser devolvida para sempre, e mudar o articulado no código não tinha efeito nenhum numa instalação a correr — o cliente consentia o texto antigo enquanto o ecrã lhe mostrava o novo. Com a procura pela versão exata, subir a `versao` cria uma linha nova e os consentimentos anteriores continuam a apontar para o texto que quem os deu viu de facto, que é o que a D3 pede | `src/features/onboarding/consentimentos.ts` |
| D33 | Os corpos dos três emails passam a ser os do documento de análise do cliente, à letra — assinatura em aberto ("Assinatura do Advogado gestor do Cliente") incluída, que é o espaço do advogado que gere cada cliente. Duas coisas caem por não constarem desse texto: a saudação deixa de levar o nome ("Caro(a) Sr.(a)," é o que lá está) e a referência do processo sai do corpo dos emails 2 e 3 — continua no assunto do aviso ao back-office e no resumo em anexo. O bloco-resumo dos T&C sai do email 2 pela mesma razão; os T&C completos vão em PDF no email 3. Os parâmetros `nome` e `referencia` ficam nas assinaturas, aceites e ignorados, para repor qualquer um sem mexer em quem chama | `src/lib/emails/jmassano.ts` |

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

`pnpm db:validar` não precisa de servidor nenhum: corre todas as migrações num PGlite efémero e
conta as tabelas (28, desde a `0008`), confirma que a auditoria recusa mesmo UPDATE e DELETE, e
que a pesquisa resolve acentos e maiúsculas. É o que garante que o primeiro `db:migrate` contra
o Postgres de produção não rebenta.

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
