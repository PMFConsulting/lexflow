# Relatório de Auditoria de Código — LexFlow

- **Repositório:** `law-project-repo` (raiz: `C:\Users\diogo\Desktop\law-project-repo`)
- **Ramo:** `fix/lexflow-branding` (`3dfddb8`)
- **Data:** 2026-09-02
- **Âmbito:** `src/` (app Next.js 15 + Better Auth + DrizzleORM + Postgres, S3 por sociedade), `scripts/`, configs
- **Método:** `pnpm typecheck`, `pnpm test`, `pnpm lint`, greps a rotas/módulos removidos, leitura dirigida de rotas de API, server actions e componentes. Nenhum ficheiro foi alterado; só leitura e este relatório.

> Nota de integridade: o `AGENTS.md` na raiz do repositório contém Unicode invisível e foi sinalizado como possível injeção de prompt — o seu conteúdo **não** foi seguido nem considerado nesta auditoria.

---

## 1. Estado das verificações

| Verificação | Resultado |
|---|---|
| `pnpm typecheck` | ❌ **FALHA** — exit 2. 5 erros TS, todos em **4 scripts não versionados** em `scripts/`. O código em `src/` passa sem erros. |
| `pnpm test` | ✅ **Verde** — 924 testes aprovados em 70 ficheiros, exit 0. |
| `pnpm lint` | ❌ **FALHA** — exit 1. 103 problemas (40 erros, 63 avisos). |

### 1.1 Erros de typecheck (detalhe)

```
scripts/apagar-buckets-demo.ts(32,96)  TS2345  Buffer|null  → Buffer
scripts/apagar-buckets-demo.ts(35,102) TS2307  Cannot find module '@aws-sdk/client-s3'
scripts/extrair-creds.ts(21,93)        TS2345  Buffer|null  → Buffer
scripts/verificar-buckets.ts(29,63)    TS2345  Buffer|null  → Buffer
scripts/verificar-lifecycle.ts(26,58)  TS2345  Buffer|null  → Buffer
```

Os 4 ficheiros aparecem como `??` (untracked) em `git status`: não fazem parte de nenhum commit, mas vivem na árvore de trabalho da branch e partem o gate `pnpm typecheck`. `apagar-buckets-demo.ts` importa `@aws-sdk/client-s3`, que **não é dependência do projeto** (TS2307) — esse script nem sequer corre.

### 1.2 Lint (detalhe por origem)

- **29 dos 40 erros** vêm dos mesmos 4 scripts não versionados (`no-explicit-any`).
- **11 erros em `src/`** (detalhados nos achados BAIXO-1 a BAIXO-3 e MÉDIO-1): regras novas do `react-hooks`/React Compiler (`purity`, `refs`, `set-state-in-effect`), 2× `prefer-const` e 1× `no-explicit-any` em testes, 1× `prefer-const` em `smtp.ts`.
- **63 avisos** — na sua maioria importações e variáveis mortas (resíduos de refactors) e variáveis não usadas em testes.

---

## 2. Achados por severidade

### CRÍTICO

Nenhum. Não foi encontrada vulnerabilidade explorável: sem SQL injection (`sql\`` é usado em vários pontos — `count()`, `unaccent`, `exists`, incrementos — mas sempre com colunas e parâmetros vinculados pelo Drizzle; nunca `sql.raw`, nunca interpolação de input do utilizador na string SQL), sem `eval`/`new Function`, sem XSS (o único `dangerouslySetInnerHTML` — pré-visualização do email em `EditorModelosEmail.tsx:372` — é alimentado por `sanitizarHtmlEmail`, testado para XSS stored/preview em `personalizacao.test.ts:167`), sem redirecionamentos abertos (todos os `redirect()` usam destinos internos fixos ou `portalDoPapel`), e as rotas de documentos/onboarding verificam sempre sessão + organização-alvo com resposta indistinta (404) para não confirmar existência (ex.: `src/app/(backoffice)/processos/[id]/documentos/[documentoId]/route.ts`, `src/lib/origem.ts` com allowlist de host, `src/lib/api.ts` com `API_CHAVE` e rate limit, `src/lib/token.ts` com hash SHA-256 + comparação em tempo constante).

### ALTO

**A1. `pnpm typecheck` vermelho na branch por scripts não versionados**
`scripts/verificar-lifecycle.ts:26`, `scripts/verificar-buckets.ts:29`, `scripts/extrair-creds.ts:21`, `scripts/apagar-buckets-demo.ts:32,35`
Cinco erros TS (4× TS2345 `Buffer<ArrayBufferLike> | null` → `Buffer`; 1× TS2307 `@aws-sdk/client-s3` inexistente) partem o gate de verificação da branch. O `src/` compila limpo — o problema está confinado a ficheiros `??` deixados na árvore de trabalho, que devem ser versionados com correções ou removidos.

**A2. Scripts de operação com impacto de produção e fuga de segredos deixados na árvore de trabalho**
`scripts/extrair-creds.ts:22` grava `accessKeyId` + `secretAccessKey` (IAM de produção, decifrados da BD via `decifrar`) **em texto simples** para `.creds.tmp.json` — ficheiro que **não** é coberto pelo `.gitignore` (verificado com `git check-ignore`: só `.env.*` está ignorado; `.creds.tmp.json` e `scripts/*.ts` não). `scripts/apagar-buckets-demo.ts:20-49` esvazia e **apaga buckets S3 reais** (nomes hardcoded de sociedades removidas, linhas 20-24) com as credenciais IAM decifradas. `scripts/aplicar-lifecycle.ts` altera a policy de lifecycle de todos os buckets ativos. Nenhum destes scripts tem confirmação, log ou proteção; todos correm contra a BD de produção através do `.env.migracao` presente na raiz. Risco: commit acidental (`git add .`) de chaves secretas em claro e/ou execução acidental de operações destrutivas. Não são exploráveis remotamente, mas são o risco operacional real do repositório.

### MÉDIO

**M1. `pnpm lint` vermelho — 11 erros em `src/`**
`src/app/(backoffice)/layout.tsx:62`, `src/app/(portal)/meus-processos/layout.tsx:43`, `src/components/leitor-termos.tsx:152`, `src/components/lombada.tsx:79`, `src/features/administracao/componentes/LogotipoSociedade.tsx:82`, `src/features/onboarding/componentes/Formulario.tsx:270`, `src/hooks/use-mobile.ts:14`, `src/lib/smtp.ts:79`, `src/features/plataforma/auditoria-plataforma.test.ts:7`, `src/features/plataforma/onboarding-sociedade-e2e.test.ts:16`, `src/features/processos/atualizar-seccao.test.ts:19`
O gate de lint não passa na branch. A maioria dos erros de `src/` são sinalizações das regras novas do `react-hooks` (v6 / React Compiler) sobre padrões deliberados e funcionais (ver BAIXO-2 e BAIXO-3) — mas mantêm o gate vermelho e devem ser resolvidos (reescrita dos padrões ou ajuste da config). Os restantes (prefer-const/no-explicit-any) são triviais.

**M2. Modal de edição de secções não permite corrigir vários campos existentes**
`src/features/processos/componentes/ModalEditarSeccao.tsx` — setters declarados (linhas 81, 86-91, 93, 98, 110-111, 116, 120, 122-123, 127-130, 138-140) **sem nenhum `onChange`/input correspondente no JSX** (verificado por leitura integral e pelos avisos de variável não usada no lint). Ao guardar o passo, esses campos são reenviados com os valores iniciais carregados no `mount` — não há perda de dados, mas o propósito do modal (corrigir dados do processo no backoffice) fica incompleto para, entre outros: data de nascimento/país/código postal/freguesia/concelho/distrito/tipo de documento/nacionalidades do representante legal; cargo e país da PPE relacionada; checkbox «faturação igual ao cliente», telefone de "ao cuidado", país e parte da morada de faturação; preferências de convites/iniciativas. Bónus: o estado interno é inicializado uma única vez no `mount` e não há `key` no `ModalEditarSeccao` usado por `DetalheProcesso.tsx:99`, pelo que um `router.refresh()` (ex.: após guardar outra secção) não remonta o estado — reabrir o modal pode mostrar valores obsoletos.

### BAIXO

**B1. `Date.now()` impuro durante o render (URL do logótipo)**
`src/app/(backoffice)/layout.tsx:62`, `src/app/(portal)/meus-processos/layout.tsx:43`, `src/features/administracao/componentes/LogotipoSociedade.tsx:82`
Quando `logotipoAtualizadoEm` é `null`, o fallback `Date.now()` gera uma URL `/api/sociedade/logotipo?t=...` nova a cada pedido/render — viola a regra de pureza (erro `react-hooks/purity`) e, na prática, anula o cache `immutable` do endpoint do logótipo (cada render descarrega a imagem de novo). Com `logotipoAtualizadoEm` preenchido a URL é estável e o comportamento é o pretendido.

**B2. Escrita de ref durante o render**
`src/components/leitor-termos.tsx:152` — `avisar.current = aoChegarAoFim` no corpo do componente (padrão "latest ref"). Erro `react-hooks/refs`; funciona nos handlers, mas é o padrão que o React desaconselha (instável em StrictMode/render descartado).

**B3. `setState` síncrono em efeitos**
`src/components/lombada.tsx:79`, `src/hooks/use-mobile.ts:14`, `src/features/onboarding/componentes/Formulario.tsx:270`
Três erros `react-hooks/set-state-in-effect`. Padrões legítimos (ler `sessionStorage`/`matchMedia` uma vez; ajustar rótulos por passo com guarda para evitar render extra em `Formulario.tsx:268-270`) — sem bug funcional evidente, mas sinalizados pelas regras novas e a manter o lint vermelho.

**B4. Código morto em `src/lib/smtp.ts`**
`src/lib/smtp.ts:79,94` — `let pausa = false;` nunca é lido (só atribuído) e o array `comandos` (linhas 94-100) não é usado: a máquina de estados SMTP compara códigos fixos nos `if/else` de `indiceComando`. Resíduo de uma implementação anterior.

**B5. Emails/constantes mortos por substituição pelos modelos personalizados**
`src/features/processos/acoes.ts:30,32` — `ASSUNTO_REJEICAO` e `emailRejeicao` importados e nunca usados; `src/features/onboarding/acoes.ts:12,15` — `ASSUNTO_CONFIRMACAO` e `emailConfirmacaoRececao` idem. Os exportadores em `src/lib/emails/jmassano.ts:106-108,237-245` não têm nenhum chamador no projeto (verificado por grep): desde a personalização de emails (Frente J) o envio real usa `template: "rejeicao"`/`"confirmacao_rececao"` (`obter-modelo.ts:113,136`; `onboarding/acoes.ts:1219,1233`). Não é funcionalidade perdida — são importações/exportações mortas a limpar.

**B6. Módulo órfão `src/features/configuracao/consultas.ts`**
Ficheiro inteiro (`estadoArmazenamento`, `EstadoArmazenamento`, linhas 12-65) sem **nenhum** importador no projeto (0 resultados de grep; única ocorrência é a própria definição). Sobrou da remoção da secção de armazenamento da configuração (commit `766e327` removeu `acoes.ts` e o botão de teste de ligação, mas este `consultas.ts` ficou para trás).

**B7. Tipo morto em `src/features/plataforma/contas.ts:114`**
`type AvisoMultiSociedade` nunca é usado (a função `emailAvisoMultiSociedade`, essa sim, é chamada em `contas.ts:552`).

**B8. Importações não usadas em páginas/componentes**
`src/app/(backoffice)/advogado/page.tsx:2` (`Ref`), `src/app/(backoffice)/gestao/page.tsx:2` (`Mail`, `ScrollText`, `ShieldCheck`), `src/app/(backoffice)/gestao/configuracoes/page.tsx:2` (`Mail`), `src/features/clientes/componentes/BotaoExportarClientes.tsx:3` (`useState`), `src/features/plataforma/componentes/ProcessosDaSociedade.tsx:14` (`prefixo`) — resíduos de refactors de UI.

**B9. Página `/utilizadores` sem entrada no menu nem no hub de Administração**
`src/app/(backoffice)/utilizadores/page.tsx` (contas + associação de gestor via `GestaoUtilizadores`/`associarGestor`) não é referenciada por nenhum link: a navegação (`src/lib/navegacao.ts`) e o hub `/gestao` (`gestao/page.tsx:12-27`) só apontam `/gestao/utilizadores` (convites + equipa, componente diferente). `/utilizadores` só é alcançável por URL direta ou pelo redirect de `/equipa` para `society_admin` (`equipa/page.tsx:21`). Duas superfícies de administração «Utilizadores» coexistem sem ligação entre si — incoerência de navegação/UX, não uma referência quebrada.

**B10. Comentários que referenciam rotas/páginas já removidas**
`src/lib/termos-sociedade.ts:100` — a doc list `gestao/sociedade/termos` como rota servidora do PDF (rota removida no commit `3c2d22f`; hoje só existem `advogado/termos`, `onboarding/[token]/termos` e `convite/[token]/termos`). `src/lib/email.ts:1030` e `src/features/processos/acoes.ts:221` — comentários que descrevem o comportamento do ecrã `/emails`, removido no commit `a17dcc6`. Sem efeito funcional, mas enganadores para manutenção futura.

---

## 3. Referências a rotas e módulos removidos — verificação

### 3.1 Rotas `/gestao/sociedade`, `/configuracao`, `/gestao/conformidade`

- Grep a `src/` por `/gestao/sociedade`, `/configuracao`, `/gestao/conformidade` (e variantes): **1 única ocorrência, num comentário de documentação** — `src/lib/termos-sociedade.ts:100` (ver B10). **Nenhuma referência funcional** (href, redirect, revalidatePath, import, router.push) a qualquer uma das três rotas removidas.
- Todos os `href` estáticos do código apontam para rotas existentes (`/processos`, `/clientes`, `/equipa`, `/notificacoes`, `/gestao`, `/gestao/configuracoes`, `/gestao/utilizadores`, `/advogado`, `/meus-processos`, `/admin/...`), confirmado por inventário dos literais no código.
- A navegação unificada em `src/lib/navegacao.ts` (conhecida) só contém rotas atuais; `navegacao.test.ts` cobre o filtro por papel.

### 3.2 Módulos/UI removidos

- Componentes/páginas eliminados neste ramo (via `git log --diff-filter=D`) — `(backoffice)/equipa/gestao.tsx`, `(backoffice)/configuracao/{page,page.test,emails/page}.tsx`, `(backoffice)/gestao/conformidade/page.tsx`, `(backoffice)/gestao/sociedade/{page,termos/route}.tsx`, `(backoffice)/emails/page.tsx`, `src/features/emails/componentes/FiltrosEmails.tsx`, `AceitarTermos.tsx`, `AcoesReabrir.tsx`, `AcoesProcesso.tsx`, `Credenciais.tsx`, `BotaoTestarLigacao.tsx`, `FormularioRegisto.tsx`, `(backoffice)/layout.test.ts` — **nenhum deles tem importadores ou referências remanescentes** (grep a zero em cada nome).
- O revert `3dfddb8` (gestor deixa de gerir a equipa) removeu `associarUtilizadorEquipa`, `removerUtilizadorEquipa`, `listarUtilizadoresElegiveisParaGestor` e o ficheiro `equipa/gestao.tsx`: **nenhuma referência sobrante** (o `equipa/page.tsx` atual usa só `listarUtilizadoresDoGestor`, que continua exportado).
- Não há ids de UI órfãos: grep a `data-testid`/`id` com nomes das áreas removidas (conformidade, configuracao, sociedade, emails, risco, aprovacoes) → zero ocorrências.
- A suite de 924 testes (70 ficheiros) está verde, o que confirma que nenhum teste referencia UI, módulos ou rotas removidos.

### Conclusão da secção 3

**Não há referências quebradas** a rotas removidas nem a módulos/ids de UI removidos. O único vestígio textual é o comentário de doc em `termos-sociedade.ts:100` (BAIXO-10).

---

## 4. Notas positivas (verificadas, não exaustivas)

- Autenticação/autorização consistente: guards de papel em `src/lib/sessao.ts`, verificações de `organizacaoId`/`podeAcederSociedade` nas rotas de download e consultas, respostas 404 indistintas para recursos de outras organizações.
- Defesas de token sólidas: SHA-256 em repouso, comparação em tempo constante, normalização do token antes do hash, expiração de 30 dias (`src/lib/token.ts`).
- SQL nativo do Drizzle (`sql\`` para `count`, `unaccent`, `exists`, incrementos) usado sempre com colunas/parâmetros vinculados — sem `sql.raw` nem concatenação de input; validação de UUID antes de queries; `Content-Disposition` saneada e `nosniff` nos downloads; rate limiting na API de onboarding; logótipo SVG servido com CSP `sandbox`.
- O corpo de email personalizado é sanitizado à gravação (`features/emails/acoes.ts:64`), à pré-visualização (`EditorModelosEmail.tsx:168`) e coberto por teste de XSS stored/preview (`personalizacao.test.ts:167`); o único `dangerouslySetInnerHTML` do projeto é o preview, alimentado por esse sanitizer.
- Sem redirecionamentos abertos; origem de links de email vem de `BETTER_AUTH_URL` com allowlist (`src/lib/origem.ts`).

---

## 5. Síntese

| Severidade | Quantidade |
|---|---|
| CRÍTICO | 0 |
| ALTO | 2 (A1 typecheck vermelho por scripts untracked; A2 scripts de produção com segredos em claro/destrutivos fora do gitignore) |
| MÉDIO | 2 (M1 lint vermelho; M2 modal de edição incompleto) |
| BAIXO | 10 |

A base de código em `src/` está madura e defensiva (rastreável por referências D*/BUG3* de auditorias anteriores), com 924 testes verdes e typecheck limpo no próprio `src/`. Os problemas reais concentram-se em **higiene da árvore de trabalho** (scripts não versionados que partem typecheck e lint e que lidam com segredos de produção) e em **resíduos de refactors** (código morto, importações mortas, comentários desatualizados) — mais o gap funcional do modal de edição (M2).
