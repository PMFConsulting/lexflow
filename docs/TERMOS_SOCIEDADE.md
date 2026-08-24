# Firm T&C — slot prepared, not yet activated

Product review of 23/08/2026, point 2. **None of this is wired up**: what exists is the
space, documented here so that the day the firm delivers the wording is not a
migration day with the system running.

## The problem

The Terms and Conditions the client accepts at step 7 come today from
`src/lib/termos.ts` — text written for the POC based on what the law requires to be
stated. It is useful for demonstrating the mechanism and it is wrong in substance: the
party contracting with the client is the **firm**, and the wording that binds them is
the firm's. The platform is the channel, not the party.

Until this is resolved, the firm is making its clients accept a contract it did not write.

## What already exists

Everything additive, in migration `0015`. No existing column was touched.

| Where | What | Status |
|---|---|---|
| `organizacao.termos_documento_ref` | reference to the firm's T&C file | `null`, no reader |
| `organizacao.termos_versao` | the version of the firm's wording | `null`, no reader |
| `organizacao.termos_atualizado_em` | when the firm submitted it | `null`, no reader |
| enum `tipo_documento` → `termos_sociedade` | the document type, once it exists | never written |

While the three columns are `null`, `LeitorTermos` keeps serving `src/lib/termos.ts` and
the client has to do absolutely nothing new. That is the contract of this preparation:
presence without effect.

The `termos_documento_ref` column is `text` and **not** an FK to `documento`. That is not
an oversight: `documento.processo_id` is `not null`, and the firm's T&C belong to no
matter at all. Choosing between "a dedicated table for firm documents" and "`processo_id`
stops being mandatory" is a decision made well with the wording in hand and badly today —
an FK invented now would be a constraint defending a shape nobody knows yet.

## What is missing, in the order it gets done

1. **Receive the wording.** PDF or text. If it comes as a PDF, decide whether step 7 starts
   showing a PDF (and the D30 read-through measurement is lost, for the same reason the
   attached commercial proposal lost it — see `LeitorProposta`) or whether the text is
   transcribed into `SeccaoTermos[]` and the PDF stays as the official copy.
   **Recommended:** transcribe. Measuring "read to the end" is what gives the acceptance its
   evidentiary value, and it is the only thing lost by moving to PDF.
2. **Decide where the file lives** (see above), and wire up `termos_documento_ref`.
3. **Submission screen in the back-office**, under `/configuracao`, restricted to `admin` for
   the same reason as `/emails` (D35).
4. **`textoEmVigor` looking up the firm's version** when it exists, and the platform's
   `VERSAO_TERMOS` when it does not.

## What must not be forgotten

D3 and D38, which are the same thing seen from two sides: consents point at a **version**,
and it is by key *and* version that `textoEmVigor` looks up. Replacing the wording without
bumping `termos_versao` erases the difference between what the client accepted and what is
now written — which is precisely the evidence this part of the system exists to preserve.

Bumping the version creates a new row in `versao_texto_legal`; earlier consents keep
pointing at the text that the people who gave them actually saw. That is what has to keep
holding on the day the source of the text stops being a `.ts` file and becomes a column.
