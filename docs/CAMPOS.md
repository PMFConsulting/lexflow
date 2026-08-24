# Field inventory — onboarding flow

**Source:** the 7 screenshots in `docs/onboarding-screens/`, read and transcribed field by field.
**Status:** validated against the images. Where the image and `docs/BRIEF.md` §5 disagree, **the
image wins** — and the divergence is recorded in section D at the end.

Note: field labels, hints and on-screen questions below are quoted **verbatim in Portuguese**,
because they are the literal UI text. Translating them would make this inventory wrong.

Legend: **O** mandatory (asterisk on screen) · **Op** optional · **C** conditional.
`⚠` = field that appears duplicated in the screenshot (see **D0**).

---

## D — Divergences between the brief and the real form

This is the most important part of this document. Seven divergences, three of them scope-level.

| # | Divergence | Impact |
|---|---|---|
| **D0** | Several fields appear **duplicated** in every screenshot: `Profissão` ×2, `Nacionalidade(s)` ×2, `País` ×2, `Freguesia`/`Concelho` ×2, `Localidade` ×2, the PEP family member question ×2, the `Ao cuidado de` block ×3. Always adjacent fields with the same value. | Looks like a **render bug in the current form**, not a requirement. I assumed a single field in each case. Please confirm. |
| **D1** | **Step 7 has no T&C, no proposal acceptance, and no digital signature.** Only a "Declaração Final" with a checkbox and the Submit button. | The brief's step 7 is **new functionality**, not a migration. Half of Phase 4 is built from scratch. |
| **D2** | **Step 5 is not GDPR.** It is called "Preferências de contacto" and it is marketing: how they found us, newsletter, areas of interest, event invitations. There is not a single granular consent of the kind the brief describes. | The GDPR consents are **new**. And it settles **A11**: what exists today is pure marketing, which is genuinely consent-based. |
| **D3** | **The identification document is at step 2, not step 1.** Type, number and expiry live under "Identificação fiscal". | It moves the boundary between `dados_identificacao` and `dados_fiscais`. |
| **D4** | Step 6 has **no IBAN**, no terms, and no payment frequency. It has an "Ao cuidado de" block (name, email, phone) that the brief does not mention. | Without IBAN there is no mod-97 validation to do at step 6. Confirm whether it is to be added or whether direct debit is not used for billing. |
| **D5** | Step 4 has **no "source of wealth"**, and the **source of funds is always mandatory** (asterisk, with no PEP conditional). It has "Serviço(s) jurídico(s) que lhe vamos prestar", filled in by the client. | Settles **A2** in favour of the proposal. And settles part of **A13**: the service is declared by the client at step 4. |
| **D6** | Step 1 asks for **neither marital status nor place of birth**. It asks for **Entidade Patronal**, which the brief does not mention. `Nacionalidade(s)` is **multi-value**. The address is far more granular: Morada, País, Localidade, Código Postal, Freguesia, Concelho, Distrito. | Settles **A4** (there is no marital status) and **A6** (granular address, but with Freguesia/Concelho/Distrito instead of number/floor). |
| **D7** | Step 3 has **neither RCBE nor beneficial owners**. It has "É representante?" as a toggle at the top and "Relação com o cliente final" as a dropdown. | Settles **A1** (the toggle exists, it is at step 3). But the absence of beneficial owners is a **KYC gap**, not a simplification — see the note at the end. |

**Note on the screenshots:** they all show the **Individual (Pessoa Singular)** path. There are no
images of the **Company / Legal Entity** variant. Everything the brief says about CAE codes,
permanent certificate, VAT regime, RCBE and beneficial owners remains unvalidated — it probably
lives in that variant. **I need the screenshots for the Company path.**

---

## Step 1 — Client identification

Screen: `passo-1-identificacao.jpg` · Table: `dados_identificacao`

**Header — "Quem é o cliente final?"** Two selectable cards:
`Pessoa Singular` ("Cliente individual ou particular") · `Empresa / Entidade Coletiva`
("Sociedade comercial ou outra pessoa coletiva") → `processo_onboarding.tipo_cliente`.

### Personal details and contacts

| Field (on-screen label) | Control | Mand. | Notes | Column |
|---|---|---|---|---|
| Nome completo | text | O | — | `nome` |
| Profissão ⚠ | text | O | — | `profissao` |
| Entidade Patronal | text | O | hint: *"Caso não se aplique, preencha com N/A."* | `entidade_patronal` |
| Data de nascimento | date picker | O | format `DD/MM/AAAA` | `data_nascimento` |
| Nacionalidade(s) ⚠ | **multi-select** (chips) | O | several nationalities per client | table `nacionalidade` (1:N) |
| Contacto telefónico | text | O | no visible mask | `telefone` |
| Email | text | O | — | `email` |

### Address

| Field | Control | Mand. | Column |
|---|---|---|---|
| Morada | text | O | `morada` |
| País ⚠ | select | O | `pais` |
| Localidade | text | O | `localidade` |
| Código Postal | text | O | `codigo_postal` |
| Freguesia ⚠ | text | O | `freguesia` |
| Concelho ⚠ | text | O | `concelho` |
| Distrito | text | O | `distrito` |

> Freguesia/Concelho/Distrito are free-text fields in the current form. With CTT/open data they
> could be derived from the postcode — a UX improvement, not a requirement.

---

## Step 2 — Tax identification

Screen: `passo-2-fiscal.jpg` · Table: `dados_fiscais`

| Field | Control | Mand. | Notes | Column |
|---|---|---|---|---|
| Número de Contribuinte Português? | checkbox | O | ticked in the example | `nif_portugues` |
| Reside em Portugal? | checkbox | O | unticked in the example | `reside_em_portugal` |
| Número de Contribuinte | text | O | validates mod-11 if `nif_portugues` | `nif` |
| Tipo de Documento | select | O | value seen: `Cartão de Cidadão` | `doc_tipo` |
| Número do Documento | text | O | — | `doc_numero` |
| Data de validade | date picker | O | warn if < 3 months (brief rule) | `doc_validade` |

**On-screen notice:** *"Anexe um documento comprovativo do seu Número de Identificação Fiscal,
obtido no portal da Autoridade Tributária, com data de emissão dos últimos 6 meses."* → this is a
validity rule about the upload, not about the field.

**Documentation** — single multi-file dropzone ("Largue ou clique para carregar ficheiros"), with a
file list and removal. Notice: *"Anexe a cópia do documento de identificação válido e legível e
outros documentos relevantes."*

> The dropzone is **generic**: a single place for all documents, with no categorisation. The brief
> asks for types (`id_frente`, `id_verso`, `comprovativo_nif`…) and per-type expiry alerts. I
> propose keeping the `tipo` column in `documento` and asking for the category on upload — without
> that, the dashboard's expiry alerts (§6) have nothing to draw from. **Settles A7:** there is no
> separate front/back.

---

## Step 3 — Legal representative · conditional

Screen: `passo-3-representante-legal.jpg` · Table: `representante_legal`

**Toggle:** `É representante?` (checkbox at the top). Ticked → reveals everything else.
**This settles A1** — the flag exists, and it is at step 3, not step 1.

| Field | Control | Mand. | Notes | Column |
|---|---|---|---|---|
| Relação com o cliente final | select | Op? | no visible asterisk; value seen: `Gerente de Negócios` | `relacao` |
| Nome Completo | text | O | — | `nome` |
| Data de Nascimento | date picker | O | — | `data_nascimento` |
| Indique a(s) nacionalidade(s) | multi-select | O | — | table `nacionalidade` (1:N) |
| Profissão ⚠ | text | O | — | `profissao` |
| Contacto Telefónico | text | O | — | `telefone` |
| Email | text | O | — | `email` |

**Representative's address:** same 7-field block as step 1.
**Representative's tax identification:** `Número de Contribuinte` O, `Tipo de Documento` O,
`Número do Documento` O, `Data de Validade` O.
**Representative's documentation:** dropzone identical to step 2's.

> In the example, `Número de Contribuinte` and `Número do Documento` have the same value
> (`229273394`) — test data, not a rule.

---

## Step 4 — PEP and business relationship

Screen: `passo-4-ppe.jpg` · Tables: `declaracao_ppe` + `relacao_negocio`

### Politically Exposed Person declaration

| Question (exact text) | Control | Mand. | Column |
|---|---|---|---|
| *"Ocupa ou ocupou nos últimos 12 meses algum cargo público ou político, em Portugal ou no estrangeiro?"* | radio Yes/No | O | `e_ppe` |
| *"É membro próximo da família ou é reconhecido como estreitamente associado com alguma pessoa considerada PPE?"* ⚠ | radio Yes/No | O | `e_relacionado_ppe` |

No radio comes pre-selected by default — correct for a declaration.
**The PEP detail fields (office, country, entity, period) do not appear** because the example has
"Não" for both. I presume they are conditional; **this is the last real ambiguity** (see A16).

### Business relationship

| Field | Control | Mand. | On-screen hint | Column |
|---|---|---|---|---|
| Serviço(s) jurídico(s) que lhe vamos prestar | text | **O** | *"Ex: Assessoria Jurídica Global/Avença/ Alterações Societárias/Constituição de Sociedade/ Questões Tributárias/ Recuperação de Crédito/ Questões Laborais, etc."* | `servicos` |
| Origem dos fundos | text | **O** | *"Ex: Rendimentos empresariais da própria empresa/Financiamento Bancário/Donativos/Quotas, etc."* | `origem_fundos` |

**Source of funds is always mandatory**, not only for PEPs — the current form is already aligned
with Lei 83/2017. **A2 resolved.** There is no source-of-wealth field.

**Business rule to carry over from the brief (not on screen):** `e_ppe = Sim` → `nivel_risco =
elevado`, approval only by `socio`/`admin`, and the step invisible to the `assistente` role.

---

## Step 5 — Contact preferences

Screen: `passo-5-preferencias-contacto.jpg` · Table: `preferencias_contacto`

**This is not the brief's GDPR step.** It is marketing capture. See **D2**.

| Field | Control | Mand. | Conditional | Column |
|---|---|---|---|---|
| Como chegou até nós? | radio: `Recomendação` · `Pesquisa Online` · `Evento/Conferência` · `Outro` | Op | — | `origem_contacto` |
| Quem? | text | O | if `Recomendação` (presumed) | `origem_detalhe` |
| Quer subscrever a nossa newsletter | radio Yes/No | Op | — | `newsletter` |
| Adicione um ou mais emails para receber novidades | multi-select of emails (chips) | O | if newsletter = Yes | table `email_newsletter` (1:N) |
| Selecione as suas áreas de interesse | multi-select (chips) | Op | if newsletter = Yes | table `area_interesse` (1:N) |
| Deseja receber convites para iniciativas (Formações, Webinars, Workshops, outros)? | radio Yes/No | Op | — | `convites_iniciativas` |
| Nome | text | O | if invitations = Yes | `convites_nome` |
| Email | text | O | if invitations = Yes | `convites_email` |

**Areas of interest seen:** Administrativo e Contratação Pública · Penal e Contraordenacional ·
Propriedade Intelectual e Privacidade · Comercial e Contratos · Laboral. The list may have more
options yet to be revealed — **to be confirmed**.

> This is genuine GDPR consent (marketing), and today it is stored as a simple Yes/No. To satisfy
> §0 it has to start recording the text version, date/time and IP — it is the only GDPR part the
> current form already has, and it is the one that most needs evidence.

---

## Step 6 — Billing information

Screen: `passo-6-faturacao.jpg` · Table: `dados_faturacao`

| Field | Control | Mand. | Column |
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

### "Ao cuidado de" (care of) ⚠ (block repeated 3× in the screenshot)

| Field | Control | Mand. | Column |
|---|---|---|---|
| Os dados ao cuidado de são os mesmos do cliente? | checkbox | Op | `ac_igual_ao_cliente` |
| Nome | text | O | `ac_nome` |
| Email | text | O | `ac_email` |
| Contacto Telefónico | text | O | `ac_telefone` |

**No IBAN, no payment terms, no frequency.** See **D4**. **A12 is moot** while those fields do
not exist.

---

## Step 7 — Final declaration

Screen: `passo-7-declaracao-final.jpg` · Table: `fecho_proposta`

| Field | Control | Mand. | Column |
|---|---|---|---|
| *"Declaro que as informações prestadas são verdadeiras e assumo a responsabilidade pela sua atualização caso se verifiquem alterações."* | checkbox | O | `declaracao_veracidade` |

Button: **Submeter**.

That is all. No proposal summary, no T&C with mandatory scrolling, no proposal acceptance, no
signature. See **D1** — the brief's step 7 is new construction.

---

## Ambiguities — updated status

**Resolved by the screenshots:** A1 ("É representante?" toggle at step 3) · A2 (source of funds
always mandatory) · A4 (there is no marital status) · A6 (address with freguesia/concelho/distrito)
· A7 (single dropzone, no front/back) · A11 (the only real consent is marketing) ·
A13 partially (the service is declared by the client at step 4).

**Still to be decided:**

| # | Question | Proposal |
|---|---|---|
| **A16** | Do the PEP detail fields (office, country, entity, period) exist when the answer is "Sim"? I cannot see, since the example answers "Não". | Assume yes and implement them; the law requires them |
| **A17** | Duplicated fields (**D0**) — bug in the current form or a requirement? | Bug. Single field |
| **A18** | The **Company** path has no screenshots. Does it exist? Which fields does it have? | I need the images |
| **A19** | Beneficial owners and RCBE do not exist in the form (**D7**). In a law firm this is a beneficial-owner identification obligation, not an extra. | Implement in the Company variant even though the current form does not have it |
| **A20** | IBAN and payment terms (**D4**) — add them or leave them out? | Leave out of the POC; the schema stays prepared |
| **A21** | "Relação com o cliente final" (step 3) and "Áreas de interesse" (step 5) are closed lists. What are all the values? | I need the complete list |
| **A15** | Magic link expiry period. | 30 days, renewable |

---

## A note that is not technical

Two absences in the current form are legal obligations, not product choices:
**beneficial owners / RCBE** (A19) and the **GDPR notice to the data subject** — retention
periods, rights, DPO contact (D2). I am flagging them because §0 of the brief asks for this to be
treated as a functional requirement. The decision to include or defer them is yours, and it is a
legal one before it is a technical one.
