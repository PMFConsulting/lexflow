# Architecture decision — digital signature (step 7)

Requested in `docs/BRIEF.md` §2. Status: **recommendation confirmed; scope decision still to be made.**

> **Context the screenshots added:** step 7 of the current form is only a "Declaração Final"
> with a checkbox and the Submit button — **there is no signature at all today**
> (divergence D1 in `docs/CAMPOS.md`). This is not migrating a feature, it is building one.
> In a POC context it is the first candidate to be deferred: the declaration of truthfulness,
> recorded with a server date/time and IP, covers the same evidentiary ground at almost zero cost.

## Recommendation: build in-house for v1 (`signature_pad` + `pdf-lib`)

1. Neither option produces a **qualified** signature (QES) on its own — DocuSeal and in-house
   both yield a **simple** electronic signature. Integrating buys no legal strength.
2. For what step 7 actually is (acceptance of a proposal and T&C by a single party, at the end of
   a flow we already control end to end), SES with an audit trail is the current standard in the
   sector and is admissible as evidence under article 25 of eIDAS.
3. The marginal work is small: the brief already requires `pdf-lib` + `@react-pdf/renderer` for
   the case file, SHA-256 hash, IP, user-agent and server timestamp. The signature adds a canvas
   and stamping the image onto a page. That is days of work, not weeks.
4. DocuSeal brings a second service to operate: Docker, its own Postgres, storage, backups,
   updates — and a second place where clients' personal data lives, subject to the same 7-year
   retention and the same erasure requests. It doubles the compliance surface, which is the
   expensive part of this project, not the code.
5. DocuSeal's real value is multi-party, recipient routing and visual field placement on the PDF.
   v1 needs none of that.
6. Licensing: DocuSeal and Documenso are **AGPL-3.0**. Using them as a separate service via API is
   the normal case, but AGPL inside an internal product of a law firm is a conversation worth
   having with the decision-makers, not a technical footnote.
7. Against in-house: we lose the field-placement UX, the automatic signature reminders and
   multi-party support — all things we will want once the matter-management module arrives
   (powers of attorney, fee agreements with several parties).
8. Against in-house, part 2: the compliance audit trail becomes our code, and therefore our
   responsibility to keep correct. That is exactly why the brief mandates chaining the
   `evento_auditoria` hashes — that piece has to be done properly.
9. **Mitigation:** we model `assinatura` following Documenso's vocabulary
   (`Document` / `Recipient` / `Field` / `AuditLog`), even with a single recipient and a single
   field in v1. Swapping to DocuSeal, Documenso or a QTSP later is an adapter, not a migration.
10. **Trigger to reassess:** the day multi-party signing appears, or the business requires a
    qualified signature (Chave Móvel Digital / Cartão de Cidadão via a Portuguese QTSP), the
    decision flips — and at that point the candidate is Documenso, for PAdES, not DocuSeal.

## What this implies for the schema

`assinatura` stores: `processo_id`, `tipo` (`simples` in v1, leaving room for `avancada`/
`qualificada`), the signature image (private storage key, never the dataURL in the database),
`hash_documento` (SHA-256 of the final PDF), `ip`, `user_agent`, `assinado_em` (**server**
timestamp), and `metadados` JSONB for whatever an external provider ends up returning.

## Dependency to add to §1

`signature_pad` — it is listed in §2 as a reference, but not in §1 as part of the stack. It is the
signature canvas library. ~12 kB, no dependencies. Please confirm you approve.
