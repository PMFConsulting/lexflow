# Inventário de campos — fluxo de onboarding

**Fonte:** os 7 screenshots em `docs/onboarding-screens/`, lidos e transcritos campo a campo.
**Estado:** validado contra as imagens. Onde a imagem e o `docs/BRIEF.md` §5 discordam, **manda a
imagem** — e a divergência fica registada na secção D no fim.

Legenda: **O** obrigatório (asterisco no ecrã) · **Op** opcional · **C** condicional.
`⚠` = campo que aparece duplicado no screenshot (ver **D0**).

---

## D — Divergências entre o brief e o formulário real

Isto é o mais importante deste documento. Sete divergências, três delas de âmbito.

| # | Divergência | Impacto |
|---|---|---|
| **D0** | Vários campos aparecem **duplicados** em todos os screenshots: `Profissão` ×2, `Nacionalidade(s)` ×2, `País` ×2, `Freguesia`/`Concelho` ×2, `Localidade` ×2, a pergunta de familiar de PPE ×2, o bloco `Ao cuidado de` ×3. Sempre campos adjacentes com o mesmo valor. | Parece um **bug de render do formulário atual**, não um requisito. Assumi campo único em cada caso. Confirma. |
| **D1** | **O passo 7 não tem T&C, nem aceitação de proposta, nem assinatura digital.** Só uma "Declaração Final" com um checkbox e o botão Submeter. | O passo 7 do brief é **funcionalidade nova**, não migração. Metade da Fase 4 é construção de raiz. |
| **D2** | **O passo 5 não é RGPD.** Chama-se "Preferências de contacto" e é marketing: como chegou até nós, newsletter, áreas de interesse, convites para eventos. Não há um único consentimento granular dos que o brief descreve. | Os consentimentos RGPD são **novos**. E resolve **A11**: o que existe hoje é marketing puro, que é mesmo consentimento. |
| **D3** | **O documento de identificação está no passo 2, não no passo 1.** Tipo, número e validade vivem debaixo de "Identificação fiscal". | Muda a fronteira entre `dados_identificacao` e `dados_fiscais`. |
| **D4** | O passo 6 **não tem IBAN**, nem condições, nem periodicidade de pagamento. Tem um bloco "Ao cuidado de" (nome, email, telefone) que o brief não menciona. | Sem IBAN não há validação mod-97 a fazer no passo 6. Confirma se é para acrescentar ou se não se cobra por débito direto. |
| **D5** | O passo 4 **não tem "origem do património"**, e a **origem dos fundos é obrigatória sempre** (asterisco, sem condicional a PPE). Tem "Serviço(s) jurídico(s) que lhe vamos prestar", preenchido pelo cliente. | Resolve **A2** a favor da proposta. E resolve parte de **A13**: o serviço é declarado pelo cliente no passo 4. |
| **D6** | O passo 1 **não pede estado civil nem naturalidade**. Pede **Entidade Patronal**, que o brief não menciona. `Nacionalidade(s)` é **multi-valor**. A morada é muito mais granular: Morada, País, Localidade, Código Postal, Freguesia, Concelho, Distrito. | Resolve **A4** (não há estado civil) e **A6** (morada granular, mas com Freguesia/Concelho/Distrito em vez de nº/andar). |
| **D7** | O passo 3 **não tem RCBE nem beneficiários efetivos**. Tem "É representante?" como interruptor no topo e "Relação com o cliente final" como dropdown. | Resolve **A1** (o interruptor existe, está no passo 3). Mas a ausência de beneficiários efetivos é uma **lacuna de KYC**, não uma simplificação — ver nota no fim. |

**Nota sobre os screenshots:** todos mostram o percurso **Pessoa Singular**. Não há imagens da
variante **Empresa / Entidade Coletiva**. Tudo o que o brief diz sobre CAE, certidão permanente,
regime de IVA, RCBE e beneficiários efetivos continua por validar — provavelmente vive nessa
variante. **Preciso dos screenshots do percurso Empresa.**

---

## Passo 1 — Identificação do Cliente

Ecrã: `passo-1-identificacao.jpg` · Tabela: `dados_identificacao`

**Cabeçalho — "Quem é o cliente final?"** Dois cartões selecionáveis:
`Pessoa Singular` ("Cliente individual ou particular") · `Empresa / Entidade Coletiva`
("Sociedade comercial ou outra pessoa coletiva") → `processo_onboarding.tipo_cliente`.

### Dados pessoais e contactos

| Campo (rótulo no ecrã) | Controlo | Obr. | Notas | Coluna |
|---|---|---|---|---|
| Nome completo | text | O | — | `nome` |
| Profissão ⚠ | text | O | — | `profissao` |
| Entidade Patronal | text | O | hint: *"Caso não se aplique, preencha com N/A."* | `entidade_patronal` |
| Data de nascimento | date picker | O | formato `DD/MM/AAAA` | `data_nascimento` |
| Nacionalidade(s) ⚠ | **multi-select** (chips) | O | várias nacionalidades por cliente | tabela `nacionalidade` (1:N) |
| Contacto telefónico | text | O | sem máscara visível | `telefone` |
| Email | text | O | — | `email` |

### Morada

| Campo | Controlo | Obr. | Coluna |
|---|---|---|---|
| Morada | text | O | `morada` |
| País ⚠ | select | O | `pais` |
| Localidade | text | O | `localidade` |
| Código Postal | text | O | `codigo_postal` |
| Freguesia ⚠ | text | O | `freguesia` |
| Concelho ⚠ | text | O | `concelho` |
| Distrito | text | O | `distrito` |

> Freguesia/Concelho/Distrito são campos de texto livre no formulário atual. Com CTT/dados
> abertos dava para os derivar do código postal — melhoria de UX, não requisito.

---

## Passo 2 — Identificação Fiscal

Ecrã: `passo-2-fiscal.jpg` · Tabela: `dados_fiscais`

| Campo | Controlo | Obr. | Notas | Coluna |
|---|---|---|---|---|
| Número de Contribuinte Português? | checkbox | O | marcado no exemplo | `nif_portugues` |
| Reside em Portugal? | checkbox | O | desmarcado no exemplo | `reside_em_portugal` |
| Número de Contribuinte | text | O | valida mod-11 se `nif_portugues` | `nif` |
| Tipo de Documento | select | O | valor visto: `Cartão de Cidadão` | `doc_tipo` |
| Número do Documento | text | O | — | `doc_numero` |
| Data de validade | date picker | O | avisar se < 3 meses (regra do brief) | `doc_validade` |

**Aviso no ecrã:** *"Anexe um documento comprovativo do seu Número de Identificação Fiscal,
obtido no portal da Autoridade Tributária, com data de emissão dos últimos 6 meses."* → é uma
regra de validade sobre o upload, não sobre o campo.

**Documentação** — dropzone único, multi-ficheiro ("Largue ou clique para carregar ficheiros"),
com lista de ficheiros e remoção. Aviso: *"Anexe a cópia do documento de identificação válido e
legível e outros documentos relevantes."*

> O dropzone é **genérico**: um só sítio para todos os documentos, sem categorizar. O brief pede
> tipos (`id_frente`, `id_verso`, `comprovativo_nif`…) e alertas de validade por tipo. Proponho
> manter a coluna `tipo` em `documento` e pedir a categoria no upload — sem isso, os alertas de
> expiração do painel (§6) não têm de onde sair. **Resolve A7:** não há frente/verso separados.

---

## Passo 3 — Representante Legal · condicional

Ecrã: `passo-3-representante-legal.jpg` · Tabela: `representante_legal`

**Interruptor:** `É representante?` (checkbox no topo). Marcado → mostra tudo o resto.
**Isto resolve A1** — o sinalizador existe, e está no passo 3, não no passo 1.

| Campo | Controlo | Obr. | Notas | Coluna |
|---|---|---|---|---|
| Relação com o cliente final | select | Op? | sem asterisco visível; valor visto: `Gerente de Negócios` | `relacao` |
| Nome Completo | text | O | — | `nome` |
| Data de Nascimento | date picker | O | — | `data_nascimento` |
| Indique a(s) nacionalidade(s) | multi-select | O | — | tabela `nacionalidade` (1:N) |
| Profissão ⚠ | text | O | — | `profissao` |
| Contacto Telefónico | text | O | — | `telefone` |
| Email | text | O | — | `email` |

**Morada do representante:** mesmo bloco de 7 campos do passo 1.
**Identificação fiscal do representante:** `Número de Contribuinte` O, `Tipo de Documento` O,
`Número do Documento` O, `Data de Validade` O.
**Documentação do representante:** dropzone igual ao do passo 2.

> No exemplo, `Número de Contribuinte` e `Número do Documento` têm o mesmo valor (`229273394`) —
> dados de teste, não uma regra.

---

## Passo 4 — PPE e Relação de Negócio

Ecrã: `passo-4-ppe.jpg` · Tabelas: `declaracao_ppe` + `relacao_negocio`

### Declaração de Pessoa Politicamente Exposta

| Pergunta (texto exato) | Controlo | Obr. | Coluna |
|---|---|---|---|
| *"Ocupa ou ocupou nos últimos 12 meses algum cargo público ou político, em Portugal ou no estrangeiro?"* | radio Sim/Não | O | `e_ppe` |
| *"É membro próximo da família ou é reconhecido como estreitamente associado com alguma pessoa considerada PPE?"* ⚠ | radio Sim/Não | O | `e_relacionado_ppe` |

Nenhum radio vem pré-selecionado por defeito — correto para uma declaração.
**Os campos de detalhe do PPE (cargo, país, entidade, período) não aparecem** porque o exemplo
tem "Não" nas duas. Presumo que sejam condicionais; **é a última ambiguidade real** (ver A16).

### Relação de Negócio

| Campo | Controlo | Obr. | Hint no ecrã | Coluna |
|---|---|---|---|---|
| Serviço(s) jurídico(s) que lhe vamos prestar | text | **O** | *"Ex: Assessoria Jurídica Global/Avença/ Alterações Societárias/Constituição de Sociedade/ Questões Tributárias/ Recuperação de Crédito/ Questões Laborais, etc."* | `servicos` |
| Origem dos fundos | text | **O** | *"Ex: Rendimentos empresariais da própria empresa/Financiamento Bancário/Donativos/Quotas, etc."* | `origem_fundos` |

**Origem dos fundos é obrigatória sempre**, não só para PPE — o formulário atual já está
alinhado com a Lei 83/2017. **A2 resolvida.** Não existe campo de origem do património.

**Regra de negócio a manter do brief (não está no ecrã):** `e_ppe = Sim` → `nivel_risco = elevado`,
aprovação só por `socio`/`admin`, e o passo invisível ao papel `assistente`.

---

## Passo 5 — Preferências de contacto

Ecrã: `passo-5-preferencias-contacto.jpg` · Tabela: `preferencias_contacto`

**Não é o passo RGPD do brief.** É captação de marketing. Ver **D2**.

| Campo | Controlo | Obr. | Condicional | Coluna |
|---|---|---|---|---|
| Como chegou até nós? | radio: `Recomendação` · `Pesquisa Online` · `Evento/Conferência` · `Outro` | Op | — | `origem_contacto` |
| Quem? | text | O | se `Recomendação` (presumido) | `origem_detalhe` |
| Quer subscrever a nossa newsletter | radio Sim/Não | Op | — | `newsletter` |
| Adicione um ou mais emails para receber novidades | multi-select de emails (chips) | O | se newsletter = Sim | tabela `email_newsletter` (1:N) |
| Selecione as suas áreas de interesse | multi-select (chips) | Op | se newsletter = Sim | tabela `area_interesse` (1:N) |
| Deseja receber convites para iniciativas (Formações, Webinars, Workshops, outros)? | radio Sim/Não | Op | — | `convites_iniciativas` |
| Nome | text | O | se convites = Sim | `convites_nome` |
| Email | text | O | se convites = Sim | `convites_email` |

**Áreas de interesse vistas:** Administrativo e Contratação Pública · Penal e Contraordenacional ·
Propriedade Intelectual e Privacidade · Comercial e Contratos · Laboral. A lista pode ter mais
opções por abrir — **por confirmar**.

> Isto é consentimento RGPD a sério (marketing), e hoje é gravado como um simples Sim/Não. Para
> cumprir o §0 tem de passar a gravar versão do texto, data/hora e IP — é a única parte de RGPD
> que o formulário atual já tem, e é a que mais precisa de prova.

---

## Passo 6 — Informação de Faturação

Ecrã: `passo-6-faturacao.jpg` · Tabela: `dados_faturacao`

| Campo | Controlo | Obr. | Coluna |
|---|---|---|---|
| Os dados de faturação são os mesmos do cliente? | checkbox | Op | `igual_ao_cliente` |
| Nome ou Empresa | text | O | `nome` |
| NIF / NIPC | text | O | `nif` |
| Morada | text | O | `morada` |
| País ⚠ | select | O | `pais` |
| Localidade ⚠ | text | O | `localidade` |
| Código Postal | text | O | `codigo_postal` |
| Freguesia | text | O | `freguesia` |
| Concelho ⚠ | text | O | `concelho` |
| Distrito | text | O | `distrito` |
| Email | text | O | `email` |

### Ao cuidado de ⚠ (bloco repetido 3× no screenshot)

| Campo | Controlo | Obr. | Coluna |
|---|---|---|---|
| Os dados ao cuidado de são os mesmos do cliente? | checkbox | Op | `ac_igual_ao_cliente` |
| Nome | text | O | `ac_nome` |
| Email | text | O | `ac_email` |
| Contacto Telefónico | text | O | `ac_telefone` |

**Sem IBAN, sem condições de pagamento, sem periodicidade.** Ver **D4**. **A12 fica sem objeto**
enquanto esses campos não existirem.

---

## Passo 7 — Declaração Final

Ecrã: `passo-7-declaracao-final.jpg` · Tabela: `fecho_proposta`

| Campo | Controlo | Obr. | Coluna |
|---|---|---|---|
| *"Declaro que as informações prestadas são verdadeiras e assumo a responsabilidade pela sua atualização caso se verifiquem alterações."* | checkbox | O | `declaracao_veracidade` |

Botão: **Submeter**.

É tudo. Sem resumo de proposta, sem T&C com scroll obrigatório, sem aceitação de proposta, sem
assinatura. Ver **D1** — o passo 7 do brief é construção nova.

---

## Ambiguidades — estado atualizado

**Resolvidas pelos screenshots:** A1 (interruptor "É representante?" no passo 3) · A2 (origem de
fundos sempre obrigatória) · A4 (não há estado civil) · A6 (morada com freguesia/concelho/distrito)
· A7 (dropzone único, sem frente/verso) · A11 (o único consentimento real é marketing) ·
A13 parcialmente (o serviço é declarado pelo cliente no passo 4).

**Por decidir:**

| # | Questão | Proposta |
|---|---|---|
| **A16** | Os campos de detalhe do PPE (cargo, país, entidade, período) existem quando se responde "Sim"? Não consigo ver com o exemplo a "Não". | Assumir que sim e implementá-los; a lei exige-os |
| **A17** | Campos duplicados (**D0**) — bug do formulário atual ou requisito? | Bug. Campo único |
| **A18** | O percurso **Empresa** não tem screenshots. Existe? Que campos tem? | Preciso das imagens |
| **A19** | Beneficiários efetivos e RCBE não existem no formulário (**D7**). Numa sociedade de advogados isto é uma obrigação de identificação do beneficiário efetivo, não um extra. | Implementar na variante Empresa mesmo que o formulário atual não tenha |
| **A20** | IBAN e condições de pagamento (**D4**) — acrescentar ou deixar de fora? | Deixar fora da POC; o schema fica preparado |
| **A21** | "Relação com o cliente final" (passo 3) e "Áreas de interesse" (passo 5) são listas fechadas. Quais são todos os valores? | Preciso da lista completa |
| **A15** | Prazo de expiração do link mágico. | 30 dias, renovável |

---

## Nota que não é técnica

Duas ausências no formulário atual são obrigações legais, não escolhas de produto:
**beneficiários efetivos / RCBE** (A19) e a **informação RGPD ao titular** — prazos de conservação,
direitos, contacto do EPD (D2). Sinalizo porque o §0 do brief pede para tratar isto como requisito
funcional. A decisão de as incluir ou adiar é tua, e é jurídica antes de ser técnica.
