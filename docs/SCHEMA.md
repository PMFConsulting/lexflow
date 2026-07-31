# Proposta de schema Drizzle

> **Estado: proposta, à espera de aprovação.** Nada disto está em `src/db/` — a Fase 0 não
> escreve código. Os nomes de coluna dependem das respostas às ambiguidades de
> `docs/CAMPOS.md` e da validação contra os screenshots.

Ficheiros previstos: `src/db/schema/` com um módulo por domínio (`organizacao.ts`,
`processo.ts`, `seccoes.ts`, `documentos.ts`, `auditoria.ts`, `legal.ts`) reexportados por
`src/db/schema/index.ts`.

---

## Convenções

- **ids UUID v7** — ordenáveis por tempo, o que dá índices B-tree com boa localidade e
  paginação por cursor estável. Ver "Dependências a aprovar" no fim.
- **`criado_em` / `atualizado_em`** em todas as tabelas, `timestamptz`, default no servidor.
- **Soft delete** (`apagado_em timestamptz`) nas tabelas com retenção legal. `evento_auditoria`
  não tem nem soft delete — não se apaga de forma nenhuma.
- **`extra jsonb`** em cada tabela de secção, para o que for genuinamente variável. Não é
  desculpa para lá meter o que devia ser coluna: se se pesquisa, filtra ou indexa, é coluna.
- Nomes em português, `snake_case`, como o resto do brief.

```ts
// src/db/schema/_comum.ts
import { sql } from 'drizzle-orm'
import { pgTable, timestamp, uuid, jsonb } from 'drizzle-orm/pg-core'
import { uuidv7 } from 'uuidv7'

export const id = () => uuid('id').primaryKey().$defaultFn(() => uuidv7())

export const timestamps = {
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true })
    .notNull().defaultNow().$onUpdate(() => new Date()),
}

export const softDelete = {
  apagadoEm: timestamp('apagado_em', { withTimezone: true }),
}

export const extra = jsonb('extra').$type<Record<string, unknown>>().default({})
```

---

## Enums

```ts
export const tipoCliente     = pgEnum('tipo_cliente', ['particular', 'empresa'])
export const estadoProcesso  = pgEnum('estado_processo', [
  'rascunho', 'submetido', 'em_revisao', 'pendente_cliente',
  'aprovado', 'rejeitado', 'arquivado',
])
export const nivelRisco      = pgEnum('nivel_risco', ['baixo', 'medio', 'elevado'])
export const papelUtilizador = pgEnum('papel_utilizador', ['admin', 'socio', 'advogado', 'assistente'])
export const tipoDocId       = pgEnum('tipo_doc_id', ['cc', 'passaporte', 'titulo_residencia'])
export const estadoCivil     = pgEnum('estado_civil', [
  'solteiro', 'casado', 'uniao_facto', 'divorciado', 'viuvo', 'separado_judicialmente',
]) // ← ambiguidade A4
export const regimeIva       = pgEnum('regime_iva', [
  'normal', 'isento_art53', 'isento_art9', 'misto',
]) // ← ambiguidade A8
export const tipoDocumento   = pgEnum('tipo_documento', [
  'id_frente', 'id_verso', 'comprovativo_nif', 'certidao_permanente',
  'procuracao', 'ata_designacao', 'comprovativo_rcbe', 'outro',
])
export const finalidade      = pgEnum('finalidade_consentimento', [
  'servico_juridico', 'obrigacoes_legais', 'faturacao', 'marketing',
  'termos_condicoes', 'proposta',
]) // ← ambiguidade A11 pode reduzir isto
export const tipoAssinatura  = pgEnum('tipo_assinatura', ['simples', 'avancada', 'qualificada'])
```

---

## Núcleo

```ts
export const organizacao = pgTable('organizacao', {
  id: id(),
  nome: text('nome').notNull(),
  nif: char('nif', { length: 9 }).notNull(),
  prefixoReferencia: text('prefixo_referencia').notNull(),   // 'PMF'
  ...timestamps, ...softDelete,
})

export const utilizador = pgTable('utilizador', {
  id: id(),
  organizacaoId: uuid('organizacao_id').notNull().references(() => organizacao.id),
  nome: text('nome').notNull(),
  email: text('email').notNull(),
  papel: papelUtilizador('papel').notNull().default('assistente'),
  mfaAtivo: boolean('mfa_ativo').notNull().default(false),
  ativoEm: timestamp('ativo_em', { withTimezone: true }),
  ...timestamps, ...softDelete,
}, (t) => [uniqueIndex('utilizador_email_org').on(t.organizacaoId, t.email)])
```

> **Nota:** o Better Auth gera as suas próprias tabelas (`user`, `session`, `account`,
> `verification`, `twoFactor`). `utilizador` é a tabela de **domínio** — papel, organização,
> atribuições — ligada 1:1 ao `user` do Better Auth por `auth_user_id`. Misturar as duas
> transforma qualquer atualização da biblioteca numa migração de dados. Decisão de design
> não coberta pelo §3, registada aqui como manda a regra 8.

```ts
export const processoOnboarding = pgTable('processo_onboarding', {
  id: id(),
  organizacaoId: uuid('organizacao_id').notNull().references(() => organizacao.id),
  referencia: text('referencia').notNull(),                  // PMF-2026-0142
  tipoCliente: tipoCliente('tipo_cliente').notNull(),
  estado: estadoProcesso('estado').notNull().default('rascunho'),
  passoAtual: smallint('passo_atual').notNull().default(1),
  responsavelId: uuid('responsavel_id').references(() => utilizador.id),
  nivelRisco: nivelRisco('nivel_risco').notNull().default('baixo'),
  fatoresRisco: jsonb('fatores_risco').$type<FatorRisco[]>().notNull().default([]),
  tokenAcessoHash: text('token_acesso_hash').notNull(),       // ver nota abaixo
  expiraEm: timestamp('expira_em', { withTimezone: true }),
  submetidoEm: timestamp('submetido_em', { withTimezone: true }),
  aprovadoEm: timestamp('aprovado_em', { withTimezone: true }),
  aprovadoPor: uuid('aprovado_por').references(() => utilizador.id),
  motivoRejeicao: text('motivo_rejeicao'),
  pesquisa: tsvector('pesquisa'),                             // gerada, ver "Pesquisa"
  ...timestamps, ...softDelete,
}, (t) => [
  uniqueIndex('processo_referencia_org').on(t.organizacaoId, t.referencia),
  index('processo_estado').on(t.organizacaoId, t.estado),
  index('processo_risco').on(t.organizacaoId, t.nivelRisco),
  index('processo_responsavel').on(t.responsavelId),
  index('processo_pesquisa').using('gin', t.pesquisa),
  check('passo_valido', sql`${t.passoAtual} between 1 and 7`),
])
```

**Duas decisões a assinalar:**

1. **`token_acesso_hash`, não `token_acesso`.** O token do link mágico é guardado em SHA-256,
   nunca em claro. Quem tiver acesso de leitura à BD não fica com a capacidade de abrir o
   dossier de qualquer cliente. O token em claro existe uma vez, no email.
2. **Geração da `referencia`.** Sequencial por organização e ano tem de ser à prova de
   concorrência — sequence do Postgres por `(organizacao, ano)` ou `INSERT ... RETURNING`
   com `advisory lock`. Um `SELECT max()+1` dá referências duplicadas no primeiro dia com
   dois utilizadores. Proponho uma tabela `contador_referencia` com `UPDATE ... RETURNING`.

---

## Secções (1:1 com o processo)

Todas seguem o mesmo padrão — `processoId` único, `extra jsonb`, timestamps:

```ts
export const dadosIdentificacao = pgTable('dados_identificacao', {
  id: id(),
  processoId: uuid('processo_id').notNull().unique().references(() => processoOnboarding.id),
  nome: text('nome').notNull(),
  dataNascimento: date('data_nascimento'),
  nacionalidade: char('nacionalidade', { length: 2 }),
  naturalidade: text('naturalidade'),
  estadoCivil: estadoCivil('estado_civil'),
  profissao: text('profissao'),
  docTipo: tipoDocId('doc_tipo').notNull(),
  docNumero: text('doc_numero').notNull(),
  docValidade: date('doc_validade').notNull(),
  docPaisEmissor: char('doc_pais_emissor', { length: 2 }).notNull(),
  moradaVia: text('morada_via').notNull(),
  moradaNumero: text('morada_numero'),
  codigoPostal: text('codigo_postal').notNull(),
  localidade: text('localidade').notNull(),
  pais: char('pais', { length: 2 }).notNull(),
  email: text('email').notNull(),
  telemovel: text('telemovel').notNull(),
  representadoPorProcurador: boolean('representado_por_procurador').notNull().default(false), // ← A1
  extra, ...timestamps,
}, (t) => [index('identificacao_nome').on(t.nome), index('identificacao_doc').on(t.docNumero)])
```

As restantes com a mesma forma: `dados_fiscais`, `representante_legal`, `declaracao_ppe`,
`consentimento_rgpd`, `dados_faturacao`, `fecho_proposta` — colunas conforme `docs/CAMPOS.md`.

**Filhas 1:N:** `residencia_fiscal_adicional` (jurisdição + TIN) e `beneficiario_efetivo`
(nome, NIF, percentagem, natureza do controlo). São listas dinâmicas, não JSONB — porque o
brief pede filtrar por PPE e pesquisar por NIF, e isso inclui o NIF de um beneficiário efetivo.

**`dados_fiscais.nif`** leva índice próprio: é um dos três campos da pesquisa global.

---

## Documentos, assinatura, consentimentos

```ts
export const documento = pgTable('documento', {
  id: id(),
  processoId: uuid('processo_id').notNull().references(() => processoOnboarding.id),
  tipo: tipoDocumento('tipo').notNull(),
  nomeOriginal: text('nome_original').notNull(),
  mime: text('mime').notNull(),
  tamanhoBytes: integer('tamanho_bytes').notNull(),
  hashSha256: char('hash_sha256', { length: 64 }).notNull(),
  chaveStorage: text('chave_storage').notNull(),   // bucket privado, sempre
  validade: date('validade'),                      // alertas dos 60 dias
  carregadoPor: uuid('carregado_por').references(() => utilizador.id), // null = cliente
  extra, ...timestamps, ...softDelete,
}, (t) => [index('documento_processo').on(t.processoId), index('documento_validade').on(t.validade)])

export const assinatura = pgTable('assinatura', {
  id: id(),
  processoId: uuid('processo_id').notNull().unique().references(() => processoOnboarding.id),
  tipo: tipoAssinatura('tipo').notNull().default('simples'),
  imagemChave: text('imagem_chave'),               // rubrica em storage privado
  hashDocumento: char('hash_documento', { length: 64 }).notNull(),  // SHA-256 do PDF
  documentoId: uuid('documento_id').references(() => documento.id), // o dossier gerado
  ip: inet('ip').notNull(),
  userAgent: text('user_agent').notNull(),
  assinadoEm: timestamp('assinado_em', { withTimezone: true }).notNull(), // relógio do SERVIDOR
  metadados: jsonb('metadados').default({}),       // espaço para um QTSP futuro
  ...timestamps,
})

export const consentimento = pgTable('consentimento', {
  id: id(),
  processoId: uuid('processo_id').notNull().references(() => processoOnboarding.id),
  finalidade: finalidade('finalidade').notNull(),
  textoLegalId: uuid('texto_legal_id').notNull().references(() => versaoTextoLegal.id),
  aceite: boolean('aceite').notNull(),
  aceiteEm: timestamp('aceite_em', { withTimezone: true }).notNull(),
  ip: inet('ip').notNull(),
  userAgent: text('user_agent').notNull(),
  revogadoEm: timestamp('revogado_em', { withTimezone: true }),
  ...timestamps,
}, (t) => [uniqueIndex('consentimento_unico').on(t.processoId, t.finalidade, t.textoLegalId)])

export const versaoTextoLegal = pgTable('versao_texto_legal', {
  id: id(),
  chave: text('chave').notNull(),        // 'rgpd.marketing', 'termos_condicoes'
  versao: text('versao').notNull(),      // '2026-07-31.1'
  conteudo: text('conteudo').notNull(),  // o texto exato apresentado
  hash: char('hash', { length: 64 }).notNull(),
  vigenteDesde: timestamp('vigente_desde', { withTimezone: true }).notNull(),
  ...timestamps,
}, (t) => [uniqueIndex('texto_chave_versao').on(t.chave, t.versao)])
```

**`versao_texto_legal` é um acrescento meu ao §4.** O brief diz "cada consentimento grava a
versão exata do texto apresentado […] porque daqui a 4 anos temos de conseguir provar o que
a pessoa viu". Guardar uma string de versão só prova o rótulo; guardar o texto inteiro em cada
linha de consentimento duplica megabytes. Uma tabela de versões imutável, referenciada por FK,
prova o conteúdo e não duplica nada. Registado aqui como manda a regra 8.

`nota` é trivial: `processo_id`, `autor_id`, `conteudo`, timestamps. Nunca visível ao cliente
— e isso garante-se na query, não no componente.

---

## `evento_auditoria` — a peça sagrada

```ts
export const eventoAuditoria = pgTable('evento_auditoria', {
  id: id(),
  organizacaoId: uuid('organizacao_id').notNull(),
  processoId: uuid('processo_id'),
  atorId: uuid('ator_id'),                  // null = cliente pelo link mágico
  acao: text('acao').notNull(),             // 'processo.aprovado', 'documento.descarregado'
  entidade: text('entidade').notNull(),
  entidadeId: uuid('entidade_id'),
  valorAnterior: jsonb('valor_anterior'),
  valorNovo: jsonb('valor_novo'),
  ip: inet('ip'),
  userAgent: text('user_agent'),
  hashAnterior: char('hash_anterior', { length: 64 }),
  hash: char('hash', { length: 64 }).notNull(),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('auditoria_processo').on(t.processoId, t.criadoEm),
  index('auditoria_ator').on(t.atorId, t.criadoEm),
])
```

**Encadeamento:** `hash = sha256(hash_anterior || id || acao || entidade || entidade_id ||
valor_anterior || valor_novo || ator_id || criado_em)`, com serialização canónica (JSON com
chaves ordenadas). A cadeia é **por organização** — uma cadeia global serializaria todas as
escritas do sistema num único ponto de contenção.

**Imutabilidade real, em SQL, não em código de aplicação** — migração dedicada:

```sql
REVOKE UPDATE, DELETE, TRUNCATE ON evento_auditoria FROM app_user;

CREATE RULE evento_auditoria_sem_update AS ON UPDATE TO evento_auditoria DO INSTEAD NOTHING;
CREATE RULE evento_auditoria_sem_delete AS ON DELETE TO evento_auditoria DO INSTEAD NOTHING;
```

O `REVOKE` é a defesa a sério; as `RULE` apanham o caso de alguém correr com um papel
privilegiado por engano. O script de verificação da cadeia (`pnpm auditoria:verificar`)
relê tudo por ordem e recalcula — é um critério de aceitação do §9.

**Retenção vs. apagamento (§0).** O direito ao apagamento não pode apagar o que a Lei 83/2017
manda conservar 7 anos. O desenho: `apagado_em` nas tabelas de secção esconde da aplicação;
uma rotina de expurgo só remove de facto passados 7 anos da conclusão da relação de negócio;
`evento_auditoria` nunca é tocado — regista quem pediu o apagamento, não os dados apagados.
**Isto precisa de validação jurídica tua antes da Fase 1**, não é uma decisão técnica.

---

## Pesquisa e RLS

**Full-text português com `unaccent`** — `unaccent` não é imutável, por isso não entra
diretamente numa coluna gerada. O caminho é uma configuração de texto própria:

```sql
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE TEXT SEARCH CONFIGURATION pt_unaccent (COPY = portuguese);
ALTER TEXT SEARCH CONFIGURATION pt_unaccent
  ALTER MAPPING FOR hword, hword_part, word WITH unaccent, portuguese_stem;
```

E `processo_onboarding.pesquisa` mantida por trigger sobre nome + NIF + referência (coluna
gerada não serve porque as fontes estão noutras tabelas).

**RLS** — ativa em todas as tabelas com dados de cliente, com `current_setting('app.utilizador_id')`
definido por transação. As políticas seguem os papéis do §6, com a de `assistente` a negar
explicitamente `declaracao_ppe` e as colunas de origem de fundos. Guards na aplicação **também**,
como o brief exige: duas camadas.

> Nota de bloqueio possível: **Neon vs. Supabase.** RLS por `SET LOCAL` funciona nos dois, mas o
> Supabase traz auth+storage integrados que colidem em parte com Better Auth + UploadThing. Se
> o storage for Supabase, vale a pena discutir; se for R2/S3, tanto faz e o Neon é mais simples.
> Precisa de decisão antes da Fase 1.

---

## Dependências a aprovar (regra 7)

| Pacote | Porquê | Alternativa se recusares |
|---|---|---|
| `uuidv7` (~2 kB) | O §4 exige UUID v7. O Postgres só tem `uuidv7()` nativo na v18; Neon e Supabase estão em versões anteriores. | `gen_random_uuid()` (v4) — perde-se a ordenação temporal e a localidade de índice |
| `signature_pad` | Canvas de rubrica do passo 7. Está no §2 como referência mas não no §1 como stack. | — |

Mais nenhuma fora do §1.
