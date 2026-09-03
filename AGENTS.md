# AGENTS.md — Plataforma de Processos Jurídicos (PMF Consulting)

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

### Atualização — passo 2 no percurso Empresa: o anexo era uma pista falsa

08/08/2026. Relatado como "o campo de ficheiro do passo 2 é obrigatório e nunca fica preenchido —
`set_input_files` e `DOM.setFileInputFiles` devolvem OK, mas `input.files.length` fica a 0".

**O anexo não é campo do formulário.** O `Anexos` não vive dentro da carga do passo: o input não
tem `name`, não entra no `new FormData(form)`, e o `passo2` não pede documento nenhum. O upload é
uma Server Action à parte (`carregarDocumento`), disparada no `onChange`, e o campo é **limpo de
propósito** no `finally` — é isso que permite voltar a escolher o mesmo ficheiro depois de um erro.
`files.length === 0` a seguir ao upload é o estado esperado, não a falha. Quem travava o passo era
o único campo que o schema recusava, e o "Falta corrigir um campo" não dizia qual.

Corrigido à volta disto:

- **A mensagem do NIF diz agora qual teria de ser o dígito de controlo** e o resumo de erros passa
  a nomear o campo (`alvoDoErro`/`rotuloVisivel`, tirados do DOM e não de um mapa de rótulos que
  envelhecia à parte). Os sim/não, as listas e as caixas levam o `name` num input escondido, que
  não tem caixa: o `scrollIntoView` e o `focus` do resumo não saíam do sítio precisamente nos
  campos onde o vermelho é mais difícil de encontrar a olho.
- **Formatos aceites num sítio só** (D39): o `accept` do campo anunciava `.heic` e o servidor
  recusava por MIME, com o Chrome a declarar `""` para HEIC e a automação a declarar
  `application/octet-stream`. Ficheiros da própria lista dos aceites eram recusados — e, com o
  campo a limpar-se a seguir, ficava a parecer que anexar não fazia nada. Um upload recusado
  passa também a dizer **o nome do ficheiro** que recusou.
- **`naturezaJuridica` obrigatória para pessoa coletiva** (D40), com a data de constituição a
  recusar o futuro. `docTipo` já estava certo — o `z.enum` recusa a opção vazia com mensagem
  própria; ficou um teste a fixá-la.

### Atualização — o anexo do passo 2, segunda passagem

08/08/2026. Relatado outra vez, agora com mais detalhe: `set_input_files` e
`DOM.setFileInputFiles` devolvem OK sobre `#ficheiro-Documentação`, e a seguir `input.files.length`
é 0 e `input.value` está vazio; o passo 2 não avança com "Falta corrigir um campo".

**A conclusão da passagem anterior mantém-se, e agora está fixada em teste.** O anexo não é campo
do passo: o input não tem `name`, não entra no `new FormData(form)` do `enviar`, o `carga(2, fd)`
constrói nove campos e nenhum é ficheiro, e o `passo2` não pede documento nenhum. Nenhum anexo pode
travar o passo 2 — em nenhum dos dois percursos.

**`files.length === 0` é o estado final desejado, não a falha.** O `finally` do `escolher` limpa o
campo de propósito, e limpar `value` esvazia o `FileList`. É isso que permite voltar a escolher o
*mesmo* ficheiro depois de um erro — sem isso o `change` não volta a disparar, porque o valor não
muda. Ler `files.length` a seguir a um upload mede o campo depois de ele ter feito o seu trabalho:
quem quiser saber se o anexo entrou olha para a lista, ou para o `data-anexos` novo.

Três coisas corrigidas à volta disto, nenhuma delas a causa do relato mas todas do mesmo tipo —
o componente não dava sinal nenhum de si:

- **Ids a partir de `useId()`** (D41), no lugar de `ficheiro-${titulo}` / `tipo-${titulo}`.
- **`data-anexos` (contagem) e `data-estado`** (`pronto` / `a-carregar` / `erro`) na secção: o
  sinal que faltava para confirmar um upload sem interrogar um campo que se limpa sozinho.
- **O campo deixa de ser `disabled` durante a subida.** Uma segunda escolha a meio da primeira
  desaparecia sem dizer nada; passa a dizer que há um ficheiro a carregar. Um campo que ora
  aceita ora não aceita, sem explicação, é o mesmo defeito de silêncio com outra roupa.

Fica também fixado em teste que **um `regimeIva` em branco não é o mesmo que ausente**: é o
`|| undefined` do `carga()` que segura isto, e sem ele o `z.enum().optional()` recebe `""` e trava
o passo num campo opcional que o cliente nunca abriu — que é exatamente a forma de "Falta corrigir
um campo" mais difícil de reconhecer.

**Por confirmar:** não foi possível correr `pnpm test` nem `pnpm typecheck` nesta sessão (as
execuções ficaram bloqueadas por permissões). Correr antes de commit.

**`pnpm test:e2e` não existe.** Está listado nos Comandos em baixo, mas não há script no
`package.json` nem Playwright nas dependências — o percurso continua a ser conduzido por fora.

### Atualização — o email de registo que não sai, e o silêncio à volta dele

09/08/2026. Relatado: cinco processos criados em produção com endereços temporários, link gerado
em todos, `/emails` a dizer «0 mensagens» e nenhuma caixa a receber nada. `RESEND_API_KEY`
confirmada no contentor.

**A leitura do código não fecha o caso, e é isso que é o defeito.** O caminho — janela →
`criarProcesso` → `enviarEmail` → `email_log` — está correto de ponta a ponta: a janela manda o
email, a ação chama o envio quando ele existe, e o envio grava sempre a linha. Duas hipóteses
sobram, e a plataforma **não deixava distingui-las**:

1. o `enviarEmail` nunca foi chamado — o endereço não chegou ao servidor (o
   `Failed to find Server Action` dos logs aponta para um separador aberto de antes de um deploy,
   que manda um identificador de ação que o servidor já não conhece);
2. foi chamado, falhou, e a gravação em `email_log` **também** falhou — o `catch` do `registar`
   engolia-a com um `console.error` sem destinatário nem template.

As duas dão exatamente o mesmo ecrã: «0 mensagens». Foi por isso que a investigação não
convergiu, e é o que fica corrigido — o diagnóstico é o produto, não o remendo.

- **`enviarEmail` deixa de poder rebentar** (D42). O `tentarEnviar` lê o ambiente *antes* do seu
  próprio `try`, e o `env()` lança quando falta uma variável: essa exceção saltava por cima da
  gravação **e** propagava-se, transformando um email falhado em criação de processo falhada.
- **Tempo limite de 15s no `fetch` ao Resend** (D42). Sem ele, uma saída para a Internet fechada
  no servidor não dava erro nenhum — o pedido ficava pendurado, e com ele a Server Action.
- **Uma linha na consola por tentativa**, com template e destinatário, e a falha da gravação a
  ser gritada com os mesmos campos. É o que separa "nem se tentou" de "tentou e não gravou" sem
  base de dados à mão.
- **O motivo viaja até à janela.** «Não foi possível enviar o email» sozinho manda quem o lê aos
  logs do contentor; um 403 do Resend com o remetente à frente resolve-se no segundo em que se lê.
  O 403 é a causa mais provável e a menos visível: `POC@jmassano.pt` é um valor **por omissão** que
  ninguém escreveu, e o Resend recusa qualquer domínio que não esteja verificado na conta.
- **`pnpm email:testar <destino>`** (D43), também dentro da imagem: envia a sério pela mesma API e
  grava a linha em `email_log` com a mesma forma. Separa as três causas — chave que não chega ao
  ambiente, domínio por verificar, saída fechada — em segundos, sem criar processos a sério.
- **A janela apanha a rejeição da Server Action.** Sem `catch`, uma ação que rebenta deixava o
  botão a sair de "A criar…" e mais nada — nem link, nem aviso. É este o silêncio que faz uma
  falha de servidor parecer um clique perdido.

**Fechado a caminho:** a janela "Novo processo" estava a meio da alteração dos dados de abertura —
pedia NIPC no schema e no servidor e **não tinha campo nenhum para o escrever**, e ainda lia um
`erroEmail` que já não existia. Ficaram o campo, os erros por baixo da caixa que os causou e o
`trocarTipo` a limpar os erros do percurso anterior sem apagar os valores.

**Por confirmar:** `pnpm test` e `pnpm typecheck` voltaram a ficar bloqueados por permissões nesta
sessão. Correr antes de commit — há testes novos em `src/lib/email.test.ts` e
`src/features/processos/schemas.test.ts`, e o `vitest.config.ts` passou a desviar o `server-only`
para um módulo vazio (o verdadeiro lança de propósito, e sem o desvio nenhum módulo de servidor é
testável).

### Atualização — o email de registo, terceira passagem: a hipótese que sobrou

09/08/2026, mais tarde. Prova nova: o `scripts/testar_email.mjs` enviou de facto para
`teste1@emalupe.com`, a mensagem chegou à caixa, e a linha entrou em `email_log`. **Isso mata a
hipótese 2 inteira** — o Resend aceita o remetente, a chave chega ao ambiente, o servidor tem
saída para a `api.resend.com`, e a gravação do diário funciona. Nada disto é o problema.

**Sobra a hipótese 1, e o código diz que ela é a única possível.** Com o `emailCliente`
preenchido, `criarProcesso` chama `enviarEmail`, e o `enviarEmail` grava em `email_log` em
**todos** os caminhos de saída, incluindo o da exceção (D42). Não há caminho por onde um envio
tentado deixe o `/emails` a zero. Logo: **o `if (emailCliente)` nunca abriu** — o endereço não
estava no servidor no momento da decisão.

O que estava por corrigir era isto: **esse ramo não deixava rasto nenhum.** Nem em `email_log`,
que só regista tentativas de envio e não pode inventar uma que ninguém pediu, nem em
`evento_auditoria`. E a janela, que só sabia do endereço que ela própria escreveu, mostrava
«Não foi possível enviar o email para X» — a acusar o envio de uma falha que era do pedido, com
o `erroEmail` vazio, porque não houve envio nenhum a produzir um motivo. Três avarias com um
ecrã só, outra vez.

- **`link.sem_email`** em `evento_auditoria` (D44) quando um processo nasce sem endereço, com um
  `console.warn` a acompanhar. O dossier passa a responder "foi dado endereço?" por escrito.
- **`paraServidor` na resposta da Server Action** (D44): o endereço que o servidor recebeu, e não
  o que a janela julga ter mandado. É a comparação entre os dois que separa "o envio falhou" de
  "o endereço não chegou cá" — e a janela passa a dizer qual dos dois, com a saída certa para
  cada um (recarregar a página num, ir ao Resend no outro).
- **`console.info` à entrada da ação**, com o tipo e o endereço recebidos, antes de haver
  processo. Um `grep` aos logs do contentor fecha a questão sem base de dados à mão.
- **Testes com a carga exata que a janela constrói**, chave a chave — incluindo
  `{ nome: undefined, email: "…" }`, que não é o mesmo objeto que `{ email: "…" }` para um
  `z.preprocess`. É a única forma de o email se perder entre a caixa e o `if` sem ninguém dar
  por ela, e agora está fixada em teste.

**Nota de deploy, e é capaz de ser a resposta toda:** nada do trabalho de 09/08 — nem os arranjos
da D42/D43, nem a migração `0009`, nem estes — está commitado, e por isso **nunca foi construído
nem foi para produção**. O que lá corre é `7dc7dc7` ou anterior, onde o `enviarEmail` não tinha
`try` à volta do `tentarEnviar`, o `criarProcesso` não tinha `try` à volta do bloco de email e a
janela não tinha `catch` — a combinação que cria o processo, perde o link e não diz nada. Antes de
voltar a testar em produção: correr `pnpm test` e `pnpm typecheck`, commitar, aplicar a `0009` e
fazer deploy. Testar a POC contra uma imagem que não tem as correções mede o defeito antigo.

**Por confirmar (outra vez):** `pnpm test` e `pnpm typecheck` continuaram bloqueados por
permissões nesta sessão. Nenhuma das alterações acima foi executada.

### Atualização — quarta passagem: o envio não falhava, nunca era alcançado

09/08/2026, mais tarde. Confirmado em produção com browser: cinco processos criados pelo modal
com endereço preenchido, `/emails` a mostrar **uma** mensagem — a do `scripts/testar_email.mjs` —
e nenhum email em caixa nenhuma.

**As três passagens anteriores leram sempre o mesmo troço de código, e o troço estava certo.**
`enviarEmail` grava em `email_log` em todos os caminhos (D42), `criarProcesso` chama-o quando há
endereço, o schema preserva o email com a carga exata que a janela constrói (D44, fixado em
teste). Nada disso é o defeito, e é por isso que corrigi-lo não mudou nada.

**O defeito está antes.** O envio vive atrás de um `if`, e entre o `INSERT` do processo e esse
`if` havia três `await` sem rede por baixo — `headers()`, o `registarEvento` do `processo.criado`
e o `origemPublica()`. **Nenhum dos três tem nada a ver com email**, e qualquer um deles a lançar
produzia, ponto por ponto, o ecrã relatado: o processo gravado e visível em `/processos`, o
`/emails` a zero (porque quem escreve a linha é o `enviarEmail`, e ele nunca foi chamado), nem
`link.enviado` nem `link.envio_falhou` nem `link.sem_email`, e a janela a dizer «o servidor não
respondeu» — uma frase que se lê como falha de rede e não como *este email nunca vai sair*. Uma
avaria em código de auditoria a apresentar-se como avaria de email, e a apagar o próprio rasto
pelo caminho.

- **Tudo o que corre depois do processo gravado passa a correr dentro do seu próprio `try`**
  (D46): os cabeçalhos, cada evento de auditoria (`auditar`), o `origemPublica`, o envio e o
  `revalidatePath`. A partir do INSERT, `criarProcesso` só tem uma saída, e leva sempre consigo
  o token em claro — que só existe nessa chamada.
- **O `console.info` de entrada passa a ser a primeira instrução da ação** e regista a **forma**
  da carga, não só os valores. Estava depois do `safeParse`, e por isso uma carga recusada pelo
  schema não deixava linha nenhuma. Se algum dia aparecer `carga=string:particular` em vez de
  `carga={tipoCliente,nome,email}`, está respondida sem investigação a única hipótese que
  sobrava: um separador aberto de antes de um deploy a chamar a assinatura antiga, de três
  argumentos posicionais, contra um servidor que já espera um objeto.
- **A mesma classe de defeito no `submeter`**: o `notificarSubmissao` promete no comentário não
  lançar e lançava — o `env()` que lê o destino do aviso interno valida o ambiente inteiro e
  rebentava **três linhas antes** de os dois emails ao cliente entrarem na fila. Guardado, e o
  `origemPublica` do aviso interno com ele.
- **`src/features/processos/acoes.test.ts`**, novo: mocka a base, a auditoria e o canal de email
  e fixa a regra em seis casos — auditoria a rebentar, `headers()` a rebentar, `origemPublica` a
  rebentar, `revalidatePath` a rebentar, `link.enviado` a rebentar, `enviarEmail` a rebentar. Em
  todos, **o email foi tentado à mesma** e a ação devolveu o link.

**Como confirmar em produção, sem base de dados à mão:** abrir `/processos/<id>` de um dos cinco
e olhar para a auditoria. Se **não** houver `processo.criado`, a ação morria no `registarEvento`
e é isto. Se houver `processo.criado` e nenhum `link.*`, o `if (emailCliente)` não abriu e a
imagem em execução é anterior à `6c12b47`. Nos logs do contentor, um `grep` a
`[processo] pedido de criação recebido` dá a mesma resposta em uma linha.

**Por confirmar (terceira vez):** `pnpm test` e `pnpm typecheck` voltaram a ficar bloqueados por
permissões. Correr antes de commit — há um ficheiro de testes novo.

### Atualização — o 404 no link de onboarding

10/08/2026. Relatado: um link de onboarding a dar 404. Varrimento do caminho inteiro do token,
da geração à página do cliente. Cinco maneiras de um link **válido** não abrir, e as cinco a
apresentarem-se com o mesmo ecrã — "esta página não existe" —, que é a razão de o relato não
se conseguir reproduzir a olho: o URL, a olho, parece bem.

1. **O token apanha sujidade a caminho** (D47). Um token são 43 caracteres de `base64url`, e o
   que chega ao servidor passou por um cliente de email e por uma colagem: traz o ponto final
   da frase, os `<>` do Outlook, um espaço duro, um `` do webmail, a barra que o browser
   acrescenta. Nenhum pode existir num token, e qualquer um muda o SHA-256 por inteiro.
2. **O token e o hash eram duas linhas** (D47). `gerarToken()` em cima, `hashToken(token)` lá em
   baixo dentro do `values` — o dia em que uma delas hashe outra coisa dá um processo real com
   um link que a consulta nunca encontra. Passam a sair do mesmo `novoTokenAcesso()`.
3. **Uma colisão no `processo_token` deixava um processo órfão** (D48). O `catch` do 23505
   tratava as duas restrições únicas como uma: repetia o INSERT com o **mesmo** token mais
   quatro vezes e desistia — enquanto a linha existia do outro lado, e o único token que a abre
   ia ser deitado fora com a chamada. Passa a distinguir a restrição e a recuperar a linha.
4. **Ninguém experimentava o link antes de o entregar** (D48). Faz-se agora uma consulta, pela
   mesma função que serve a página do cliente; a falhar, repõe-se o hash e a validade; a falhar
   outra vez, a janela diz **no ecrã** que o link não abre e fica `link.nao_resolve` na
   auditoria. Um link que não resolve deixa de ser descoberto pela reclamação.
5. **Havia dois links** (D48). O do email saía do `origemPublica()` e o da janela era montado no
   browser com `window.location.origin`. Coincidem quase sempre — até alguém abrir o
   back-office por `localhost`, por um túnel, por um IP ou por um segundo domínio. O servidor
   passa a devolver o link, e é esse que a janela mostra.

E o 404 em si (D49): `processoPorToken` devolvia `null` para tudo e as quatro rotas
respondiam-lhe com `notFound()`. Passa a `acessoPorToken`, com quatro estados — `ok`,
`expirado`, `arquivado`, `desconhecido` —, e o cliente vê o que aconteceu e o que fazer a
seguir. As Server Actions dizem o mesmo texto, da mesma fonte.

**Por confirmar (quarta vez):** `pnpm test` e `pnpm typecheck` voltaram a ficar bloqueados por
permissões. Nenhuma destas alterações foi executada. Há dois ficheiros de testes novos
(`src/lib/token.test.ts`, `src/features/onboarding/dados.test.ts`) e
`src/features/processos/acoes.test.ts` mudou de mocks.

### Atualização — «enviado» não queria dizer «entregue»

10/08/2026. Relatado: num teste de vinte empresas, **um** dos emails de registo ficou em
`enviado` no `email_log` e nunca chegou à caixa do destinatário (mail.tm). Sem erro no
servidor, sem nada na consola, e — o que interessa — **indistinguível na listagem das dezanove
que chegaram**. O processo ficou sem link e ninguém tinha como saber qual dos vinte era.

A linha do diário era escrita no momento em que o fornecedor respondia 200. Isso é uma
afirmação sobre a **aceitação**, não sobre a entrega, e o rótulo "Enviado" dizia a segunda
coisa. Entre o 200 e a caixa de correio há um servidor de destino que ainda pode recusar
(caixa cheia, endereço que não existe, greylisting que expira, filtro que devolve) — e nada
disso voltava a esta plataforma.

- **`estado_email` ganha três valores** — `entregue`, `devolvido`, `queixa` — e `enviado`
  passa a querer dizer, à letra, "o fornecedor aceitou; a entrega está por confirmar". O
  rótulo no `/emails` é agora **Aceite**, e não **Enviado** (ver D50).
- **`canal` e `mensagem_id`** em `email_log`: quem aceitou, e com que identificador. Sem o
  par não há a quem perguntar pelo desfecho — o id do Brevo não existe no Resend, e a consulta
  de cada um tem endereço, header e formato próprios. `verificado_em` diz quando é que se
  perguntou.
- **Sondagem diferida, e não webhook** (D51): `confirmarEntrega` corre solta a seguir ao
  envio, pergunta ao fornecedor aos 15s, 45s e 2m30, e fecha a linha ao primeiro desfecho.
  Resend por `GET /emails/{id}` (`last_event`), Brevo por
  `GET /v3/smtp/statistics/events?messageId=…` (lista de eventos, fica o mais grave).
- **Um bounce escreve o motivo no campo `erro`** e grita-o na consola com o destinatário e o
  template à frente. Um devolvido conta agora, no cabeçalho da página, para as mensagens que
  "não chegaram" — a par do erro de envio, porque é o mesmo problema visto de dois sítios.
- **`pnpm email:conferir`** (D51), também dentro da imagem: confere as linhas que ficaram em
  `enviado` e fecha-as. É o que tapa os dois buracos da sondagem — um reinício do contentor a
  meio, e o desfecho que chega horas depois da última tentativa.

**Por confirmar:** `pnpm test` e `pnpm typecheck` voltaram a ficar bloqueados por permissões.
Correr antes de commit — `src/lib/email.test.ts` cresceu com dois blocos novos, e há uma
migração `0010` por aplicar.

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
| D14 | Sessões de 30 dias para a POC (decisão deliberada do cliente para conveniência: "não tenho que ir a cada vez"; rever para 8h em produção) | `src/lib/auth.ts` |
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
| D39 | Extensões e MIME dos anexos numa fonte só (`formatos.ts`), com o `accept` do campo derivado dela. O MIME declarado manda quando é conhecido; só quando o browser não se compromete (`""`, `application/octet-stream`) é que a extensão decide — um ficheiro que se diz `text/html` e se chama `x.pdf` continua recusado. Estavam escritos em dois sítios e divergiram: o campo anunciava `.heic`, o servidor não o deixava entrar | `src/features/onboarding/formatos.ts` |
| D40 | `naturezaJuridica` obrigatória para pessoa coletiva, no mesmo `superRefine` onde a pessoa singular já dá profissão, entidade patronal e data de nascimento. É forma jurídica, não campo acessório — decide quem pode obrigar a entidade, que é o que o passo 3 pergunta a seguir. Sem migração: a coluna existe e continua nullable, porque os rascunhos anteriores não podem ficar inválidos na base de dados; a exigência é do schema Zod, à entrada | `src/features/onboarding/schemas.ts` |
| D41 | Os ids do `Anexos` saem do `useId()`, como já saíam os de todos os outros campos (`Campo.tsx`), e não de `ficheiro-${titulo}`. De um título português saía `id="ficheiro-Documentação"` — válido, mas frágil de endereçar: o `ç` e o `ã` têm duas representações Unicode (NFC e NFD) que se lêem iguais e não são a mesma sequência de code points, e o `querySelector` compara code points e não formas canónicas. Um seletor que passe por uma ferramenta que normalize para NFD não encontra um campo que está lá. O que dá ao campo um nome estável passa a ser o `data-campo`, que é ASCII e não muda com o texto do ecrã | `src/features/onboarding/componentes/Anexos.tsx` |
| D42 | `enviarEmail` não propaga nunca e não espera para sempre: o `tentarEnviar` corre dentro de um `try` (o `env()` lança *antes* do `try` interno, e essa exceção saltava por cima da gravação e rebentava a criação do processo) e o `fetch` leva `AbortSignal.timeout(15s)` (sem ele, uma saída para a Internet fechada pendurava a Server Action sem erro nenhum). Cada tentativa deixa uma linha na consola com template e destinatário, e a falha da gravação é gritada com os mesmos campos — sem isso, «0 mensagens» no `/emails` significa ao mesmo tempo "nem se tentou" e "tentou e não gravou", que é a diferença que uma investigação precisa de ver | `src/lib/email.ts` |
| D43 | O motivo da falha sai do servidor e chega à janela, e há um `pnpm email:testar <destino>` dentro da imagem de produção. As três causas de "o cliente não recebeu nada" — chave que não chega ao ambiente do contentor, domínio do `EMAIL_REMETENTE` por verificar no Resend (403, e `POC@jmassano.pt` é um valor por omissão de que ninguém desconfia), saída para a Internet fechada — dizem-se todas «não foi possível enviar» e resolvem-se de três maneiras diferentes. O script grava em `email_log` com a mesma forma de linha: se ele aparece no `/emails` e um processo criado não aparece, o problema está a montante do envio | `scripts/testar_email.mjs` |
| D44 | Um processo criado **sem** endereço escreve `link.sem_email` em `evento_auditoria`, e a Server Action devolve `paraServidor` — o endereço que o servidor recebeu, ao lado do que a janela mandou. Os dois fecham o último sítio onde a plataforma podia ficar calada: `email_log` regista tentativas de envio e não pode registar um envio que nunca foi pedido, por isso «0 mensagens» no `/emails` dizia ao mesmo tempo "não havia endereço" e "havia endereço e perdeu-se a caminho" — que se resolvem em sítios diferentes (recarregar a página contra ir ao painel do Resend). A janela deixa de acusar o envio de uma falha do pedido | `src/features/processos/acoes.ts` |
| D33 | Os corpos dos três emails passam a ser os do documento de análise do cliente, à letra — assinatura em aberto ("Assinatura do Advogado gestor do Cliente") incluída, que é o espaço do advogado que gere cada cliente. Duas coisas caem por não constarem desse texto: a saudação deixa de levar o nome ("Caro(a) Sr.(a)," é o que lá está) e a referência do processo sai do corpo dos emails 2 e 3 — continua no assunto do aviso ao back-office e no resumo em anexo. O bloco-resumo dos T&C sai do email 2 pela mesma razão; os T&C completos vão em PDF no email 3. Os parâmetros `nome` e `referencia` ficam nas assinaturas, aceites e ignorados, para repor qualquer um sem mexer em quem chama | `src/lib/emails/jmassano.ts` |
| D46 | A partir do `INSERT` do processo, **cada passo de `criarProcesso` corre dentro do seu próprio `try`** e a ação tem uma saída só. O envio do email está atrás de um `if`, e chegar lá dependia de três `await` sem rede — `headers()`, o `registarEvento` do `processo.criado` e o `origemPublica()`. Nenhum tem que ver com email, e qualquer um a lançar dava o mesmo ecrã: processo em `/processos`, `/emails` a zero (quem grava a linha é o `enviarEmail`, e ele não era chamado), nenhum `link.*` em auditoria, e «o servidor não respondeu» na janela. Foi por isso que três passagens a ler o caminho do envio não fecharam o caso — o caminho do envio estava certo e não era percorrido. A auditoria continua a ser escrita pelo mesmo `registarEvento`, com a mesma cadeia; o que deixa de poder é interromper o resto. Mesmo arranjo no `submeter`, onde o `env()` do aviso interno rebentava antes de os dois emails ao cliente entrarem na fila | `src/features/processos/acoes.ts` |
| D47 | O token em claro e o hash saem do mesmo `novoTokenAcesso()`, e todo o token vindo de fora passa por `normalizarToken` antes de ser procurado. As duas metades do mesmo defeito: um hash que não é o daquele token, e um token que não é o que saiu daqui. A limpeza é **só nas pontas** — cortar o meio faria de um token corrompido um token possivelmente válido, que é esconder a avaria; nas pontas não há esse risco, porque o comprimento é fixo e nenhum token é prefixo de outro. O `hashToken` normaliza antes de calcular, o que torna a procura idempotente: o link com o ponto final colado da frase do email encontra a mesma linha que o link limpo | `src/lib/token.ts` |
| D48 | `criarProcesso` **experimenta o link antes de o entregar**, pela mesma `acessoPorToken` que serve a página do cliente — não por uma segunda consulta escrita à parte, que divergiria e divergiria justamente do lado que não está no caminho do cliente. Falhando, repõe o hash e a validade uma vez; falhando outra vez, devolve `linkVerificado: false`, a janela avisa em vermelho e fica `link.nao_resolve` na auditoria. Na mesma passagem: o 23505 passa a distinguir `processo_referencia_org` (repetir com outro número) de `processo_token` (a linha já existe — recuperá-la, porque repetir com o mesmo token nunca podia funcionar e desistir deixava um processo a que ninguém voltava a chegar), e o link passa a ser montado **uma vez só, no servidor**, e devolvido à janela em vez de reconstruído no browser | `src/features/processos/acoes.ts` |
| D49 | `acessoPorToken` devolve quatro estados — `ok`, `expirado`, `arquivado`, `desconhecido` — no lugar do `Processo \| null`, e as quatro rotas do onboarding mostram o `LinkIndisponivel` em vez de `notFound()`. Um `null` obriga quem o recebe a inventar a razão, e o que cada rota inventava era um 404: a mesma frase para "o link expirou", "o dossier foi arquivado" e "escreveu mal o domínio", que se resolvem em três sítios diferentes. Os filtros de apagado e de validade saíram do `where` — lá dentro, um processo arquivado e um token inventado devolviam os dois zero linhas e nenhum ecrã os conseguia distinguir. **Não se revela nada de novo:** quem anda a adivinhar tokens continua a receber `desconhecido`; os outros três só são alcançáveis por quem já traz um token que bate certo | `src/features/onboarding/dados.ts` |
| D50 | `estado_email` deixa de ter dois valores e passa a ter cinco: `enviado` e `erro` são sobre a **aceitação** pelo fornecedor, `entregue`/`devolvido`/`queixa` são o desfecho. O rótulo de `enviado` passa a **Aceite** — o que a coluna sempre disse foi "o fornecedor ficou com a mensagem", mas o rótulo dizia "chegou", e foi assim que uma mensagem que nunca chegou apareceu no `/emails` indistinguível de dezanove que chegaram. Os valores novos vão para o fim do enum, que é onde o `ALTER TYPE ADD VALUE` os põe: o array em `enums.ts` tem de ficar pela mesma ordem, senão o `db:generate` seguinte propõe uma migração a corrigir o que não está errado | `src/db/schema/enums.ts` |
| D51 | A entrega confirma-se por **sondagem diferida no próprio processo** e não por webhook. O webhook é a via oficial e seria a certa num sistema a sério, mas custa um endereço público fora do `middleware` de autenticação, a verificação da assinatura (`svix`) — sem a qual é um botão para qualquer um marcar emails como entregues — e configuração no painel de *cada* um dos dois fornecedores, que fica por fazer no dia em que se muda de conta e ninguém percebe porque é que os estados pararam. A sondagem não precisa de nada disso: corre no contentor de vida longa do Coolify (não numa função serverless que morre com a resposta), usa a chave que já existe e funciona igual nos dois canais, ao preço de três pedidos HTTP por email. O que não cobre — um reinício a meio, um desfecho que chega tarde — fica para o `pnpm email:conferir`, e a linha entretanto fica em `enviado`, que não é mentira nenhuma: é o que se sabe | `src/lib/email.ts` |
| D45 | `--marca` (terracota `#d9694b`, `#e07a5f` em modo escuro) é a única cor da paleta que **não** codifica estado — marca escolha do utilizador, e por agora só na janela "Novo processo": a ficha selecionada e o emblema do cabeçalho. O que lá estava era `border-tinta`, a cor do texto à volta, e um contorno da cor do texto lê-se como moldura e não como "escolhido". Fica em token e não escrita à mão nos componentes por duas razões: o modo escuro precisa de um valor diferente (o mesmo hex sobre tinta cai para 4,8:1 e o ícone dentro da ficha deixa de se ler), e o logo JMASSANO é **verde-arquivo e latão** — trocar isto por `var(--latao)`, que é literalmente o dourado do logo, é uma linha. A terracota fica em contorno, emblema e visto, nunca em texto corrido: 3,46:1 sobre branco chega para elemento de interface, não para corpo de texto | `src/app/globals.css` |

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
pnpm email:testar <destino>  # envia um email de teste e grava-o em email_log
pnpm email:conferir       # confirma a entrega das mensagens que ficaram em «Aceite»
```

`pnpm email:testar` corre também dentro do contentor (`node scripts/testar_email.mjs`), que é onde
interessa: mostra se a `RESEND_API_KEY` chega ao ambiente do Node, se o Resend aceita o remetente
e se o servidor tem saída para a `api.resend.com` — as três causas de "o cliente não recebeu nada",
que de fora se dizem todas da mesma maneira. `--sem-bd` faz o teste sem tocar no Postgres.

`pnpm email:conferir` corre também dentro do contentor (`node scripts/conferir_entregas.mjs`).
Pergunta ao fornecedor o desfecho das mensagens que ficaram em «Aceite» e fecha-lhes o estado.
Existe para os dois casos que a sondagem automática (D51) não apanha: o contentor reiniciou a
meio, e o desfecho chegou horas depois. `--dias N` alarga a janela (7 por omissão) e
`--simular` mostra o que faria sem escrever nada.

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
