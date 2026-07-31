# Inventário de campos — fluxo de onboarding

> **⚠️ Estado: PROVISÓRIO.** Este inventário foi derivado do texto de `docs/BRIEF.md` §5,
> **não** dos screenshots — a pasta `docs/onboarding-screens/` está vazia. O brief diz
> explicitamente "a imagem manda nos detalhes". Cada linha aqui é uma proposta a validar
> contra a imagem correspondente antes de virar schema.
>
> Coluna **V?**: `—` = por validar contra o screenshot · `✓` = confirmado na imagem.

Legenda de obrigatoriedade: **O** obrigatório · **Op** opcional · **C** condicional (a condição
está na coluna própria).

---

## Passo 1 — Identificação do cliente

Tabela: `dados_identificacao` (1:1 com `processo_onboarding`), exceto onde indicado.

| Campo | Tipo | Obr. | Validação | Condicional | Coluna | V? |
|---|---|---|---|---|---|---|
| Tipo de cliente | enum `particular \| empresa` | O | — | **ramifica todo o fluxo** | `processo_onboarding.tipo_cliente` | — |
| Nome completo / Denominação social | text | O | 2–200 car. | label muda com o tipo | `nome` | — |
| Data de nascimento | date | C | passado; ver ambiguidade A3 | só `particular` | `data_nascimento` | — |
| Nacionalidade | char(2) ISO 3166-1 | O | país existente | — | `nacionalidade` | — |
| Naturalidade | text | C | — | só `particular` | `naturalidade` | — |
| Estado civil | enum | C | ver ambiguidade A4 | só `particular` | `estado_civil` | — |
| Profissão | text | C | — | só `particular` | `profissao` | — |
| Tipo de documento de ID | enum `cc \| passaporte \| titulo_residencia` | O | — | — | `doc_tipo` | — |
| Número do documento | text | O | ver ambiguidade A5 | — | `doc_numero` | — |
| Validade do documento | date | O | futuro; **aviso se < 3 meses** | — | `doc_validade` | — |
| País emissor | char(2) ISO | O | país existente | — | `doc_pais_emissor` | — |
| Morada — via pública | text | O | — | — | `morada_via` | — |
| Morada — nº / andar | text | Op | — | ver ambiguidade A6 | `morada_numero` | — |
| Código postal | text | O | `NNNN-NNN` se PT | formato varia com país | `codigo_postal` | — |
| Localidade | text | O | — | — | `localidade` | — |
| País da morada | char(2) ISO | O | país existente | — | `pais` | — |
| Email | text | O | RFC 5322 básico | — | `email` | — |
| Telemóvel | text | O | E.164, com indicativo | — | `telemovel` | — |

**Uploads** → `documento`

| Documento | Obr. | Tipo | Notas |
|---|---|---|---|
| Documento de ID — frente | O | `id_frente` | PDF/JPG/PNG |
| Documento de ID — verso | C | `id_verso` | não aplicável a passaporte? → ambiguidade A7 |

---

## Passo 2 — Identificação fiscal

Tabela: `dados_fiscais` + `residencia_fiscal_adicional` (1:N).

| Campo | Tipo | Obr. | Validação | Condicional | Coluna | V? |
|---|---|---|---|---|---|---|
| NIF / NIPC | char(9) | O | **mod-11**, prefixo ∈ {1,2,3,5,6,8,9} | — | `nif` | — |
| País de residência fiscal | char(2) ISO | O | país existente | — | `pais_residencia_fiscal` | — |
| Residências fiscais adicionais | lista dinâmica | Op | ≥0 entradas | CRS/FATCA | tabela `residencia_fiscal_adicional` | — |
| ↳ Jurisdição | char(2) ISO | O | ≠ país principal, sem repetidos | por entrada | `.jurisdicao` | — |
| ↳ TIN | text | O | formato varia por jurisdição | por entrada | `.tin` | — |
| CAE | char(5) | C | 5 dígitos | só `empresa` | `cae` | — |
| Código da certidão permanente | text | C | `XXXX-XXXX-XXXX` | só `empresa` | `codigo_certidao_permanente` | — |
| Regime de IVA | enum | C | ver ambiguidade A8 | só `empresa` | `regime_iva` | — |

**Uploads** → `documento`

| Documento | Obr. | Tipo |
|---|---|---|
| Comprovativo de NIF | C (particular) | `comprovativo_nif` |
| Certidão permanente | C (empresa) | `certidao_permanente` |

---

## Passo 3 — Representante legal · **condicional**

**Condição de entrada:** `tipo_cliente = empresa` **OU** representação por procuração.
Ver ambiguidade **A1** — o campo que sinaliza "atua por procuração" não existe no passo 1.

Tabelas: `representante_legal` (1:1) + `beneficiario_efetivo` (1:N).

| Campo | Tipo | Obr. | Validação | Coluna | V? |
|---|---|---|---|---|---|
| Nome do representante | text | O | 2–200 car. | `nome` | — |
| Qualidade / cargo | text | O | — | `qualidade` | — |
| Tipo de documento de ID | enum | O | — | `doc_tipo` | — |
| Número do documento | text | O | — | `doc_numero` | — |
| Validade do documento | date | O | futuro | `doc_validade` | — |
| País emissor | char(2) ISO | O | — | `doc_pais_emissor` | — |
| NIF do representante | char(9) | O | mod-11 | `nif` | — |
| Email | text | O | RFC 5322 | `email` | — |
| Telefone | text | O | E.164 | `telefone` | — |
| Âmbito dos poderes | text longo | O | — | `ambito_poderes` | — |
| Código de acesso ao RCBE | text | C | só `empresa` | `codigo_rcbe` | — |
| Beneficiários efetivos | lista dinâmica | C | ≥1 se `empresa` (ver A9) | tabela `beneficiario_efetivo` | — |
| ↳ Nome | text | O | — | `.nome` | — |
| ↳ NIF | char(9) | O | mod-11 se PT | `.nif` | — |
| ↳ % de participação | numeric(5,2) | O | 0–100; soma ≤ 100 (ver A9) | `.percentagem` | — |
| ↳ Natureza do controlo | text / enum | O | ver A9 | `.natureza_controlo` | — |

**Uploads** → `documento`: `procuracao`, `ata_designacao`, `comprovativo_rcbe`.

---

## Passo 4 — PPE · **dados sensíveis, invisíveis ao papel `assistente`**

Tabela: `declaracao_ppe` (1:1).

| Campo | Tipo | Obr. | Validação | Condicional | Coluna | V? |
|---|---|---|---|---|---|---|
| É PPE? | boolean | O | resposta explícita, sem default | — | `e_ppe` | — |
| Cargo | text | C | — | `e_ppe = true` | `ppe_cargo` | — |
| País | char(2) ISO | C | — | `e_ppe = true` | `ppe_pais` | — |
| Entidade | text | C | — | `e_ppe = true` | `ppe_entidade` | — |
| Início do exercício | date | C | passado | `e_ppe = true` | `ppe_inicio` | — |
| Fim do exercício | date | C | ≥ início; nulo = em exercício | `e_ppe = true` | `ppe_fim` | — |
| É familiar / relacionado com PPE? | boolean | O | sem default | — | `e_relacionado_ppe` | — |
| Relação | text / enum | C | ver A10 | `e_relacionado_ppe = true` | `relacao_ppe` | — |
| Identificação da PPE relacionada | text | C | nome, cargo, país | `e_relacionado_ppe = true` | `ppe_relacionada_*` | — |
| Origem dos fundos | text longo | C | ver **A2** | `e_ppe = true` | `origem_fundos` | — |
| Origem do património | text longo | C | ver **A2** | `e_ppe = true` | `origem_patrimonio` | — |
| Declaração formal | boolean | O | tem de ser `true` | — | `declaracao_aceite` | — |
| Versão do texto da declaração | text | O | preenchido pelo servidor | — | `versao_declaracao` | — |

**Regras de negócio (não são campos, são invariantes):**

- `e_ppe = true` → `processo.nivel_risco = elevado`, sempre, sem exceção.
- Risco elevado → só `socio` ou `admin` podem aprovar. Aprovação automática bloqueada.
- Leitura deste passo por qualquer utilizador escreve em `evento_auditoria`.
- `assistente` não vê este passo — nem por URL direto, nem por Server Action, nem por RLS.

---

## Passo 5 — RGPD

Tabela: `consentimento_rgpd` (1:1, estado do passo) + `consentimento` (1:N, uma linha por finalidade).

| Finalidade | Obr. | Pré-marcado | Base legal proposta | `consentimento.finalidade` | V? |
|---|---|---|---|---|---|
| Prestação do serviço jurídico | O | nunca | execução de contrato — ver **A11** | `servico_juridico` | — |
| Cumprimento de obrigações legais | O | nunca | obrigação legal — ver **A11** | `obrigacoes_legais` | — |
| Faturação | O | nunca | execução de contrato / obrigação legal | `faturacao` | — |
| Comunicações de marketing | **Op** | **nunca** | consentimento | `marketing` | — |

Cada linha de `consentimento` grava: `finalidade`, `versao_texto` (referência a
`versao_texto_legal`), `texto_hash`, `aceite`, `aceite_em`, `ip`, `user_agent`, `revogado_em`.

**Conteúdo informativo apresentado** (não são inputs; são texto versionado que temos de
conseguir reproduzir daqui a 4 anos): prazos de conservação, direitos do titular, contacto
do Encarregado de Proteção de Dados.

---

## Passo 6 — Dados para faturação

Tabela: `dados_faturacao` (1:1).

| Campo | Tipo | Obr. | Validação | Coluna | V? |
|---|---|---|---|---|---|
| Igual aos dados fiscais | boolean | Op | copia do passo 2 no cliente | `igual_dados_fiscais` | — |
| Denominação de faturação | text | O | — | `denominacao` | — |
| NIF de faturação | char(9) | O | mod-11 | `nif` | — |
| Morada de faturação — via | text | O | — | `morada_via` | — |
| Morada — nº / andar | text | Op | — | `morada_numero` | — |
| Código postal | text | O | `NNNN-NNN` se PT | `codigo_postal` | — |
| Localidade | text | O | — | `localidade` | — |
| País | char(2) ISO | O | — | `pais` | — |
| Email para faturas | text | O | RFC 5322 | `email_faturacao` | — |
| Condições de pagamento | enum / text | O | ver A12 | `condicoes_pagamento` | — |
| Periodicidade | enum | O | ver A12 | `periodicidade` | — |
| IBAN | text | O | **mod-97**; UI em mono, grupos de 4 | `iban` | — |
| Referência / PO interna | text | Op | — | `referencia_cliente` | — |

---

## Passo 7 — Fecho, T&C e assinatura

Tabelas: `fecho_proposta` (1:1) + `assinatura` (1:1) + `consentimento` (T&C e proposta).

| Campo | Tipo | Obr. | Validação | Coluna | V? |
|---|---|---|---|---|---|
| Serviços contratados | texto / lista | — | **read-only** para o cliente — ver A13 | `servicos` JSONB | — |
| Modelo de honorários | enum / text | — | read-only — ver A13 | `modelo_honorarios` | — |
| Valores | numeric | — | read-only — ver A13 | `valor`, `moeda` | — |
| Aceitação dos T&C | boolean | O | checkbox só ativa após scroll ao fim | `consentimento(termos_condicoes)` | — |
| Versão dos T&C | text | O | preenchida pelo servidor | `versao_termos` | — |
| Aceitação da proposta | boolean | O | tem de ser `true` | `consentimento(proposta)` | — |
| Assinatura (rubrica) | imagem | O | canvas; guardada em storage privado | `assinatura.imagem_chave` | — |

**Ao submeter** (tudo do lado do servidor, nada do cliente):

1. Gerar PDF do dossier: 7 secções + anexos + página de assinatura.
2. Calcular SHA-256 do PDF → `assinatura.hash_documento`.
3. Gravar `ip`, `user_agent`, `assinado_em` = **timestamp do servidor**.
4. Escrever `evento_auditoria` (ação `processo.submetido` + `assinatura.criada`).
5. Email com cópia ao cliente + notificação ao responsável interno.
6. `processo.estado` → `submetido`, `submetido_em` = agora.

---

## Ambiguidades — precisam de decisão tua

Ordenadas por impacto no schema. As duas primeiras bloqueiam a Fase 1.

| # | Ambiguidade | Porque importa | Proposta |
|---|---|---|---|
| **A1** | O passo 3 é condicional a "empresa **ou** representação por procuração", mas não há campo no passo 1 que capture "atua por procuração". | Sem ele, um particular representado por procurador não tem caminho para o passo 3. | Acrescentar ao passo 1 um booleano "É representado por procurador?" |
| **A2** | Origem de fundos e origem de património são obrigatórios "se PPE = sim". | A Lei 83/2017 pede origem de fundos em diligência **normal**, não só reforçada. Limitar a PPE pode ficar aquém. | Obrigatório sempre; texto mais exigente se PPE |
| **A3** | Idade mínima. Menores podem ser clientes (representados). | Se validarmos ≥18, bloqueamos casos legítimos. | Sem mínimo; avisar se < 18 e exigir representante |
| **A4** | Valores de estado civil. Inclui união de facto? Separação judicial? Regime de bens? | Enum na BD. | `solteiro, casado, uniao_facto, divorciado, viuvo, separado_judicialmente`; regime de bens fora da v1 |
| **A5** | Validar o check digit do CC português (e do NIF que ele contém)? | Reduz erros de digitação, mas rejeita documentos estrangeiros mal classificados. | Validar só se `doc_tipo = cc`; aviso, não bloqueio |
| **A6** | Granularidade da morada: um campo livre ou via/nº/andar separados? | Muda o schema e a UX em 360px. | Via + nº/andar + CP + localidade + país |
| **A7** | Verso do documento é obrigatório para passaporte? | Passaporte não tem verso relevante. | Obrigatório só para CC e título de residência |
| **A8** | Valores do regime de IVA. | Enum na BD. | `normal, isento_art53, isento_art9, misto` |
| **A9** | Beneficiários efetivos: mínimo 1? A soma das percentagens tem de fechar em 100? Natureza do controlo é lista fechada? | Validação e UX da lista dinâmica. | Mínimo 1 para empresa; soma ≤ 100 com aviso se < 100; natureza como enum + campo livre |
| **A10** | "Relação com a PPE" é texto livre ou lista fechada (cônjuge, filho, sócio…)? | Filtrar por isto no back-office exige enum. | Enum + `outro` com texto |
| **A11** | Os passos 5.1–5.3 são **consentimentos** ou apenas **informação** sobre bases legais? Juridicamente, execução de contrato e obrigação legal não se consentem — e um consentimento pedido para algo que não é consentimento é inválido e enfraquece o resto. | Muda a UI (checkbox vs. declaração de tomada de conhecimento) e o modelo de dados. | Só o marketing é consentimento; os outros são "declaro que tomei conhecimento", gravados com o mesmo rigor probatório |
| **A12** | Condições e periodicidade de pagamento: listas fechadas ou texto? | Filtros e relatórios futuros. | Enums: `pronto_pagamento, 15_dias, 30_dias, 60_dias` e `avenca_mensal, trimestral, por_ato, projeto` |
| **A13** | Quem preenche o resumo da proposta (serviços, honorários, valores)? O cliente não pode. | Se é o escritório, falta um ecrã de back-office anterior ao envio do link. | Preenchido no back-office ao criar o processo; read-only para o cliente |
| **A14** | Um processo pode ter mais do que um representante legal? | 1:1 vs. 1:N. | 1:1 na v1, tabela desenhada para suportar 1:N depois |
| **A15** | O que expira exatamente em `expira_em` — o link mágico ou o processo? Qual o prazo? | Regra de negócio e job de limpeza. | O link; 30 dias, renovável pelo responsável |

---

## O que falta para fechar a Fase 0

1. Os 7 screenshots em `docs/onboarding-screens/` — sem eles a coluna **V?** fica toda a `—`.
2. As respostas às 15 ambiguidades acima (ou um "vai com as propostas").
3. Aprovação de `docs/DECISAO-ASSINATURA.md` e de `docs/SCHEMA.md`.
