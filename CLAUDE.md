# CLAUDE.md — Legal Matter Platform (PMF Consulting)

Full context in `docs/BRIEF.md`. This file records decisions and commands, and is
updated as the phases progress.

## Framing: this is a POC

Decided on 31/07/2026. **The goal is to prove the concept at the lowest possible cost**, not to
deliver the final system. Concrete consequences below. The brief remains the destination; the POC
is the first leg.

## Status

| Phase | Status |
|---|---|
| 0 — Analysis | **complete** — 7 screenshots read, fields inventoried, 7 divergences recorded |
| 1 — Foundations | **complete** and in production |
| 2 — Onboarding flow | **complete** — walked end to end in production |
| 3 — Back-office | **partial** — listing, matter detail, clients, emails, and the two firm portals |
| 3b — Firm and user onboarding | **complete** — built 25/08, not yet walked in production |
| 4 — Closing (PDF, signature, emails) | outside POC scope |

### What was done in Phase 1

Next.js 16 + TypeScript strict + Tailwind 4 + shadcn/ui · §3 tokens applied
(`src/app/globals.css`) with the three type families · back-office layout with an ink-coloured
sidebar · visual vocabulary components (`Carimbo`, `Carimbos`, `Ref`, `EstadoBadge`,
`RiscoBadge`) · complete Drizzle schema, 27 tables · three migrations, including PT full-text
search with `unaccent` and audit immutability · Better Auth with email+password and DB
sessions · PT validations (tax number mod-11, IBAN mod-97, postcode, phone) with 21 tests ·
audit hash chain with 8 tests and a verification script · seeds with an environment guard.

`pnpm build` clean, `pnpm typecheck` clean, 29 tests green, no horizontal scroll at 360px.

### What was done in Phase 2

Seven steps on their own routes (`/onboarding/[token]/passo/[n]`), with state in the database
and not in memory · Zod schemas shared between client and server · a Server Action that
revalidates token and schema · conditional logic (individual/company, representative, PEP) · a
declared PEP forces high risk and writes to the audit trail · matter creation with an atomic
sequential reference and a magic link shown exactly once · spine with stamps.

**Walked in production**, from the dashboard to submission: validation rejecting 13 empty
fields, a tax number with a wrong checksum refused, an expired document refused, step 3
correctly skipped for an individual without a power of attorney, high risk recorded, 9 audit
events with an intact chain, and `UPDATE`/`DELETE` on the audit trail returning zero rows
affected.

### Three defects that only appeared in use

1. **React 19 resets the form** after a Server Action passed via `action={}`.
   One wrong digit in the tax number wiped the other nineteen fields. Moved to `onSubmit` with
   `preventDefault`.
2. **Step 7 could not be submitted**: it called `submeter()` directly, but that function reads
   the declaration from the database and the checkbox was never saved beforehand.
3. **The empty `public/` folder** was not tracked by git, and the Dockerfile's `COPY` blew up
   from a clean clone — it passed on the machine of whoever had it locally.

### Outstanding in the flow

- Document uploads (the schema and the `documento` table already exist)
- Playwright E2E for both paths
- Company path still to be validated against images (A18)

### Update — Representative step removed, 5-step flow

Client request (05/08/2026): the Legal representative step leaves onboarding — the real form
did not have that figure, and the "Sou representado por procurador" field went unused. The
flow becomes **Identification → Tax → PEP → Billing → Closing**, 5 steps. The DB schema stays
intact (`representante_legal` and `preferencias_contacto` go unused, as had already happened
with the preferences). Each step now shows a short description next to the title, and the PEP
step explains in one sentence how risk is calculated.

Outstanding since Phase 2 and delivered in this update: the **approval flow**
(`alterarEstadoProcesso`, buttons on the matter detail). Removed in the following update —
see D20.

### Update — approvals and risk removed from the UI, Clients page

Client request (05/08/2026): simplify the POC. See D20 and D21.

- **Approvals out**: `alterarEstadoProcesso` and `AcoesProcesso` (Approve / Reject / Mark under
  review buttons) were removed entirely — deleted, not merely hidden. `podeAprovarRiscoElevado`
  also left `src/lib/sessao.ts` for having become unused. The decision email to the client
  (`notificarDecisao`) went with it. The `aprovado`/`rejeitado` states remain in the enum and
  in the schema — they just stop being reachable from the UI.
- **Risk out of the UI**: `RiscoBadge`, the "Fatores de risco" section and the risk
  filters/facets disappeared from the matter detail, the matter list, the dashboard and —
  because it appeared there too, to the client themselves — from the onboarding final review.
  The calculation (`nivelRisco`/`fatoresRisco`, PEP forces high risk) stays intact in the
  database, it is just shown to nobody.
- **`/clientes`**: new back-office page (`src/app/(backoffice)/clientes/page.tsx`), sidebar
  entry between Processos and — now without "Risco elevado" occupying that slot. A client is a
  person/company deduplicated by tax number (`src/features/clientes/consultas.ts`,
  `listarClientes`): a CTE with `row_number()` partitioned by tax number to pick the most recent
  matter and `count(*)` for the total, with search by name/tax number/email via `ilike` +
  `unaccent`, the same pattern as `/processos`. A matter without a tax number (step 2 unfilled)
  does not yet count as a client. No migration — it uses the existing `dados_fiscais`,
  `dados_identificacao` and `nacionalidade`.

### Update — Legal Representative back, 7-step flow

Client request (06/08/2026): the Legal Representative step returns to the flow, between Tax and
PEP. Reverses D19. **No migration** — the `representante_legal` table and the
`titular_nacionalidade` enum ('cliente' | 'representante') had existed since Phase 1; what was
missing was the step that wrote to them. Same pattern as the GDPR step reactivation.

Final order: **1 Identification · 2 Tax · 3 Legal Representative · 4 PEP · 5 Billing ·
6 GDPR · 7 Closing**. Renumbered: the Zod schemas, the `guardarPasso` `case` branches, the form
and final-review blocks, the matter detail blocks, the audit labels (`passo.N.gravado`) and the
`total` of the `Carimbos`. The database's `passo_valido` constraint already accepted
`between 1 and 7`.

The step hangs off a toggle — "É representante?", with "Não" as the starting answer. With
"Não", the row is written with `e_representante = false` and nothing else is mandatory; the
blank row is the proof that the question was asked, something the absence of a row does not
distinguish from "has not got here yet". With "Sim", it requires relationship, name, date of
birth, nationality(ies), occupation, phone, email and the seven address columns, with the same
PT validations as step 1.

Fixed along the way: step 1 was deleting **all** the matter's nationalities before rewriting its
own. It now deletes only those with `titular = 'cliente'` — without that, going back to fix a
comma in the name took the representative's nationalities with it.

### Update — no public sign-up

Client request (06/08/2026). The `/registar` screen was deleted and `disableSignUp` became
`true`, which also closes the API endpoint — the route kept accepting anyone calling it by
hand, even with no page. Accounts are now created on the server with
`scripts/criar_utilizador.mjs`, which writes the three required rows: `user` and `account`
(where Better Auth keeps the password, with `provider_id = 'credential'`) and `utilizador`,
already with `auth_user_id` linked — without that last step the login passes and the session
does not resolve.

The hash comes from the package itself (`better-auth/crypto`), not from a reimplementation: it
is the only way to guarantee that scrypt's parameters do not diverge on an update.
`scripts/verificar_hash.mjs` confirms it without a database, and the `--gerar-hash` mode
prepares the password on a machine with no access to Postgres.

### Update — per-server storage (SFTP) working end to end

Configured and walked in the production container (06/08/2026). Three things were broken, and
none of them showed up in development:

1. **The SFTP URL carried names raw.** A client folder is called
   `Maria Silva (249886344)`, and the space does not belong in a URL: curl truncated there and
   the upload ended up at `/Clientes/Maria`. The segments are now percent-encoded, as they
   already were in WebDAV.
2. **curl's `-Q mkdir` splits the line into words.** The path ended at the first space, and the
   created folder had the wrong name. It now goes in quotes, with `\"` and `\\` escaped.
3. **Alpine's `curl` does not speak sftp://** — it is compiled without libssh2, and syncing
   failed with "Protocol sftp not supported" on the first submission. See D26.

At the same time, and at Diogo's request, each folder now also carries `dados_cliente.pdf`
(D27), which is what the Python helper used to leave on OneDrive.

### Update — improvements requested by JMASSANO (analysis of 07/08/2026)

Eight points, from the client's analysis document (João Massano Escritório de Advogado).

- **Logo in the header.** `public/logo_jm.png` replaces the "POC" text in the onboarding
  header — which lives in the layout, so it appears across all seven steps at once — and in the
  login screen header.
- **Step 3 for legal entities only** (D28), with inverted semantics (D29) and "Relação com o
  cliente final" becoming **Cargo**.
- **Step 4** with clickable suggestions under each box, instead of the list of examples on a
  help line that nobody read. Clicking adds; clicking again removes.
- **GDPR**: "Outro" in *how they found us* opens a text box (the same `origem_detalhe` column as
  the referral's "who?", and mandatory for the same reason); areas of interest gain "Outra área"
  with a free-text box, which enters the list as one more value — no migration, the table was
  already free text; and "yes" to invitations brings the name and email from step 1
  pre-filled, editable.
- **Step 7**: mandatory reading of the T&C (D30).
- **Three emails** with the subjects **and the bodies** the client wrote (D31, D33).
- **SFTP only** (D32): OneDrive and WebDAV left the code, the schema and the scripts.
- **Login page** without the "Como funciona" block.

The **texts of the three emails** stopped being unconfirmed (07/08/2026): the bodies in
`src/lib/emails/jmassano.ts` are now those from the analysis document, verbatim — see D33.

The wording of the **T&C** in `src/lib/termos.ts` is still unconfirmed: it is demonstration text
written from what the law requires to be stated. When replacing it, also bump `VERSAO_TERMOS` —
that version is what gets recorded alongside the consent, and changing the text without changing
the version erases the difference between what the client accepted and what is now written.

### Update — email log, logo in the back-office

08/08/2026.

- **`email_log`** (D34): one row per send attempt, written by `enviarEmail` itself and not by
  its callers — that is what guarantees a new sending path cannot come into being without
  entering the log. Success and error both go in, including the case of a missing
  `RESEND_API_KEY`: the question being asked is "did the client receive anything?", and it only
  has an answer if failures are recorded with the reason. Migration `0008`. Twenty-eight tables.
- **`/emails`** in the back-office, between Clients and Configuration: date, recipient, subject,
  type, matter and state, with the failure reason under the subject. Search by
  recipient/subject/reference and faceted filters by state and by type, with the state in the
  URL — same pattern as `/processos`. **Administration only** (D35).
- **Logo in the back-office**: `public/logo_jm.png` is now also in the sidebar header, where it
  said "POC". Together with the four places it was already in — the seven onboarding steps, the
  login screen, the T&C — the logo is now everywhere there is a header.
- **Verified with no changes**: the three emails matching the client's document verbatim, sender
  `POC@jmassano.pt`; step 3 for legal entities only; "Cargo" in place of "Relação"; no "Como
  funciona" block on the login page; OneDrive/WebDAV with no traces in the code (what remains is
  comments, migration `0006`/`0007` which is history, and the test confirming that a
  `protocolo: "webdav"` is refused at the boundary).

### Update — complete platform audit

08/08/2026. Sweep of every page — dashboard, matters, clients, configuration, emails, the seven
onboarding steps on both paths, login, T&C, 404 and error.

**The "Novo processo" modal (D36).** It was not a modal: it was a block that replaced the button
wherever the button happened to be. On the dashboard it opened flush right inside the header and
pushed it; on the empty card it opened centred and at a different width. And once a matter was
created, the link panel stayed where the button was until somebody reloaded the page — **there
was no way to create a second matter**. It became a real dialog (`components/ui/dialog.tsx`,
new, on top of the `radix-ui` that `sheet` already used), with the same pair of cards as
onboarding step 1 for the client type, `role="radiogroup"` instead of two `aria-pressed`, a
footer with aligned buttons, and the email validated before any matter is created.

**Five functional defects:**

1. **Risk only went up.** Declaring a PEP put the matter at high risk; going back and correcting
   to "Não" left it high forever, with the factor "pessoa politicamente exposta declarada" sitting
   under a declaration saying the opposite. It now resets, with `risco.reposto` in the audit
   trail.
2. **Foreign client blocked at step 5.** Step 2 accepts a foreign tax number
   (`nifPortugues = false`), but billing imposed the Portuguese mod-11 on everyone: no number
   could pass, not even theirs. The checksum is now applied only to nine digits — which is what
   catches a transposed digit — and any other form is accepted. Tests in `schemas.test.ts`.
3. **PEP filter open to the `assistente`.** The detail hides step 4 from them and records the
   attempt, but `?ppe=sim` on the listing gave them the same information in bulk. The filter is
   ignored on the server and does not appear in the bar.
4. **Personal address hard-coded.** The submission notice landed in a personal Gmail when
   `EMAIL_NOTIFICACOES` was missing, with a reference and a link to the case file. No default
   value: with no destination, the notice does not go out (D37).
5. **Frozen consent.** `textoEmVigor` returned the most recent row for the key, so changing the
   text here never reached a running installation — the client consented to the old wording. It
   now looks up by key *and* version (D38).

**Texts.** "POC Consulting" on the submission screen and "PMF Consulting" in the GDPR consents
and in the headers of both PDFs became JMASSANO. Step 4 promised "aprovação de um sócio ou
administrador" (deleted in D20) and explained the risk calculation to the client (hidden in
D21) — it now explains what a PEP is and why the question is mandatory. The 404 offered "Pedir
novo link" to `/entrar`, which is the team's entrance.

**Visual and accessibility.** JM logo on the 404 and the error screen, the last two places still
saying "POC" — along with the tab title, now "· JMASSANO". The `<select>` elements had `h-9`
against `Input`'s `h-8` and sat misaligned on the same grid row, with no focus ring: they now
share the input's skin (`classeSelect`). Labels on `CampoLista`, `Anexos` and `Assinatura`
aligned in `text-tinta-suave` with those of `Campo`. The three pill groups in the matter filter
gained a label — they read as a single row. A draft matter opened with six empty cards on the
detail; they now say "passo ainda por preencher". The end of a PEP's term of office was
collected and never shown. The T&C reader, which unlocks acceptance of a contract, had no focus
trap: `Tab` escaped to the form underneath. It now sits on `Dialog`, with the D30 measurement
intact.

### Update — step 2 on the Company path: the attachment was a red herring

08/08/2026. Reported as "the step 2 file field is mandatory and never gets filled —
`set_input_files` and `DOM.setFileInputFiles` return OK, but `input.files.length` stays at 0".

**The attachment is not a form field.** `Anexos` does not live inside the step's payload: the
input has no `name`, it does not enter `new FormData(form)`, and `passo2` does not ask for any
document. The upload is a separate Server Action (`carregarDocumento`), fired on `onChange`, and
the field is **cleared on purpose** in the `finally` — that is what allows re-picking the same
file after an error. `files.length === 0` after the upload is the expected state, not the
failure. What was blocking the step was the one field the schema refused, and "Falta corrigir um
campo" did not say which.

Fixed around this:

- **The tax number message now says what the check digit would have to be** and the error
  summary now names the field (`alvoDoErro`/`rotuloVisivel`, taken from the DOM and not from a
  label map that aged separately). The yes/nos, the lists and the boxes carry the `name` in a
  hidden input, which has no box: the summary's `scrollIntoView` and `focus` were not moving
  precisely on the fields where the red is hardest to spot by eye.
- **Accepted formats in one single place** (D39): the field's `accept` announced `.heic` and the
  server refused it by MIME, with Chrome declaring `""` for HEIC and automation declaring
  `application/octet-stream`. Files from the accepted list itself were being refused — and, with
  the field clearing afterwards, it looked as though attaching did nothing. A refused upload now
  also states **the name of the file** it refused.
- **`naturezaJuridica` mandatory for legal entities** (D40), with the incorporation date
  refusing the future. `docTipo` was already right — the `z.enum` refuses the empty option with
  its own message; a test was added to pin it down.

### Update — the step 2 attachment, second pass

08/08/2026. Reported again, now with more detail: `set_input_files` and
`DOM.setFileInputFiles` return OK on `#ficheiro-Documentação`, and afterwards
`input.files.length` is 0 and `input.value` is empty; step 2 does not advance, with "Falta
corrigir um campo".

**The previous pass's conclusion holds, and is now pinned down in a test.** The attachment is
not a field of the step: the input has no `name`, it does not enter `enviar`'s
`new FormData(form)`, `carga(2, fd)` builds nine fields and none is a file, and `passo2` does
not ask for any document. No attachment can block step 2 — on either path.

**`files.length === 0` is the intended final state, not the failure.** The `finally` in
`escolher` clears the field on purpose, and clearing `value` empties the `FileList`. That is
what allows re-picking the *same* file after an error — without it, `change` does not fire
again, because the value does not change. Reading `files.length` right after an upload measures
the field after it has done its job: anyone wanting to know whether the attachment went through
looks at the list, or at the new `data-anexos`.

Three things fixed around this, none of them the cause of the report but all of the same kind —
the component gave no signal about itself:

- **Ids from `useId()`** (D41), in place of `ficheiro-${titulo}` / `tipo-${titulo}`.
- **`data-anexos` (count) and `data-estado`** (`pronto` / `a-carregar` / `erro`) on the section:
  the missing signal for confirming an upload without interrogating a field that clears itself.
- **The field stops being `disabled` during the upload.** A second pick partway through the
  first vanished without a word; it now says there is a file uploading. A field that sometimes
  accepts and sometimes does not, with no explanation, is the same silence defect in different
  clothes.

Also pinned down in a test: **a blank `regimeIva` is not the same as an absent one**. It is the
`|| undefined` in `carga()` that holds this, and without it the `z.enum().optional()` receives
`""` and blocks the step on an optional field the client never opened — which is exactly the
hardest form of "Falta corrigir um campo" to recognise.

**Unconfirmed:** it was not possible to run `pnpm test` or `pnpm typecheck` in this session (the
runs were blocked by permissions). Run them before committing.

**`pnpm test:e2e` does not exist.** It is listed under Commands below, but there is no script in
`package.json` and no Playwright in the dependencies — the path is still driven externally.

### Update — the registration email that does not go out, and the silence around it

09/08/2026. Reported: five matters created in production with temporary addresses, a link
generated on all of them, `/emails` saying «0 mensagens» and no inbox receiving anything.
`RESEND_API_KEY` confirmed in the container.

**Reading the code does not close the case, and that is the defect.** The path — dialog →
`criarProcesso` → `enviarEmail` → `email_log` — is correct end to end: the dialog sends the
email, the action calls the send when it exists, and the send always writes the row. Two
hypotheses remain, and the platform **did not allow them to be told apart**:

1. `enviarEmail` was never called — the address did not reach the server (the
   `Failed to find Server Action` in the logs points to a tab left open from before a deploy,
   sending an action identifier the server no longer knows);
2. it was called, it failed, and writing to `email_log` **also** failed — the `catch` in
   `registar` swallowed it with a `console.error` carrying neither recipient nor template.

Both produce exactly the same screen: «0 mensagens». That is why the investigation did not
converge, and it is what gets fixed here — the diagnosis is the product, not the patch.

- **`enviarEmail` can no longer blow up** (D42). `tentarEnviar` reads the environment *before*
  its own `try`, and `env()` throws when a variable is missing: that exception jumped over the
  write **and** propagated, turning a failed email into a failed matter creation.
- **15s timeout on the `fetch` to Resend** (D42). Without it, a closed outbound path to the
  internet produced no error at all — the request hung, and the Server Action with it.
- **One console line per attempt**, with template and recipient, and the write failure shouted
  with the same fields. That is what separates "it was never even attempted" from "it was
  attempted and not recorded" without a database at hand.
- **The reason travels to the dialog.** «Não foi possível enviar o email» on its own sends
  whoever reads it to the container logs; a 403 from Resend with the sender in front is solved in
  the second it is read. The 403 is the most likely cause and the least visible:
  `POC@jmassano.pt` is a **default** value that nobody wrote, and Resend refuses any domain not
  verified on the account.
- **`pnpm email:testar <destination>`** (D43), also inside the image: it sends for real through
  the same API and writes the row in `email_log` in the same shape. It separates the three
  causes — key not reaching the environment, unverified domain, closed outbound — in seconds,
  without creating real matters.
- **The dialog catches the Server Action's rejection.** Without a `catch`, an action that blew up
  left the button coming out of "A criar…" and nothing else — no link, no warning. This is the
  silence that makes a server failure look like a lost click.

**Closed along the way:** the "Novo processo" dialog was halfway through the change to the
opening data — it asked for a corporate tax number in the schema and on the server and **had no
field at all to write it in**, and it was still reading an `erroEmail` that no longer existed.
What landed: the field, the errors under the box that caused them, and `trocarTipo` clearing the
previous path's errors without wiping the values.

**Unconfirmed:** `pnpm test` and `pnpm typecheck` were again blocked by permissions in this
session. Run them before committing — there are new tests in `src/lib/email.test.ts` and
`src/features/processos/schemas.test.ts`, and `vitest.config.ts` now redirects `server-only` to
an empty module (the real one throws on purpose, and without the redirect no server module is
testable).

### Update — the registration email, third pass: the hypothesis that remained

09/08/2026, later. New evidence: `scripts/testar_email.mjs` did in fact send to
`teste1@emalupe.com`, the message reached the inbox, and the row entered `email_log`. **That
kills hypothesis 2 entirely** — Resend accepts the sender, the key reaches the environment, the
server has outbound access to `api.resend.com`, and the log write works. None of that is the
problem.

**Hypothesis 1 remains, and the code says it is the only possible one.** With `emailCliente`
filled in, `criarProcesso` calls `enviarEmail`, and `enviarEmail` writes to `email_log` on
**every** exit path, including the exception one (D42). There is no path by which an attempted
send leaves `/emails` at zero. Therefore: **the `if (emailCliente)` never opened** — the address
was not on the server at the moment of the decision.

What was left unfixed was this: **that branch left no trace at all.** Not in `email_log`, which
only records send attempts and cannot invent one nobody asked for, nor in `evento_auditoria`.
And the dialog, which only knew the address it had written itself, showed «Não foi possível
enviar o email para X» — accusing the send of a failure that belonged to the request, with
`erroEmail` empty, because there was no send at all to produce a reason. Three faults with a
single screen, again.

- **`link.sem_email`** in `evento_auditoria` (D44) when a matter is born without an address, with
  an accompanying `console.warn`. The case file now answers "was an address given?" in writing.
- **`paraServidor` in the Server Action's response** (D44): the address the server received, not
  the one the dialog thinks it sent. Comparing the two is what separates "the send failed" from
  "the address never got here" — and the dialog now says which of the two, with the right exit
  for each (reload the page in one, go to Resend in the other).
- **`console.info` at the action's entry**, with the type and address received, before any matter
  exists. A `grep` of the container logs closes the question without a database at hand.
- **Tests with the exact payload the dialog builds**, key by key — including
  `{ nome: undefined, email: "…" }`, which is not the same object as `{ email: "…" }` for a
  `z.preprocess`. That is the only way for the email to get lost between the box and the `if`
  without anyone noticing, and it is now pinned down in a test.

**Deploy note, and it may well be the whole answer:** none of the 09/08 work — neither the
D42/D43 fixes, nor migration `0009`, nor these — is committed, and therefore **it was never built
and never went to production**. What is running there is `7dc7dc7` or earlier, where
`enviarEmail` had no `try` around `tentarEnviar`, `criarProcesso` had no `try` around the email
block and the dialog had no `catch` — the combination that creates the matter, loses the link
and says nothing. Before testing in production again: run `pnpm test` and `pnpm typecheck`,
commit, apply `0009` and deploy. Testing the POC against an image that does not have the fixes
measures the old defect.

**Unconfirmed (again):** `pnpm test` and `pnpm typecheck` remained blocked by permissions in
this session. None of the changes above were executed.

### Update — fourth pass: the send was not failing, it was never reached

09/08/2026, later. Confirmed in production with a browser: five matters created through the modal
with the address filled in, `/emails` showing **one** message — the one from
`scripts/testar_email.mjs` — and no email in any inbox.

**The three previous passes always read the same stretch of code, and that stretch was correct.**
`enviarEmail` writes to `email_log` on every path (D42), `criarProcesso` calls it when there is an
address, the schema preserves the email with the exact payload the dialog builds (D44, pinned in a
test). None of that is the defect, which is why fixing it changed nothing.

**The defect is earlier.** The send lives behind an `if`, and between the matter's `INSERT` and
that `if` there were three `await`s with no network underneath — `headers()`, the `registarEvento`
for `processo.criado`, and `origemPublica()`. **None of the three has anything to do with email**,
and any of them throwing produced, point for point, the reported screen: the matter saved and
visible in `/processos`, `/emails` at zero (because the one writing the row is `enviarEmail`, and
it was never called), no `link.enviado`, no `link.envio_falhou`, no `link.sem_email`, and the
dialog saying «o servidor não respondeu» — a sentence that reads as a network failure and not as
*this email is never going out*. A fault in audit code presenting itself as an email fault, and
erasing its own trace on the way.

- **Everything that runs after the matter is saved now runs inside its own `try`** (D46): the
  headers, each audit event (`auditar`), `origemPublica`, the send and `revalidatePath`. From the
  INSERT onwards, `criarProcesso` has a single exit, and it always carries the plaintext token
  with it — which only exists on that call.
- **The entry `console.info` becomes the action's first statement** and records the **shape** of
  the payload, not just the values. It used to be after the `safeParse`, so a payload refused by
  the schema left no line at all. If `carga=string:particular` ever shows up instead of
  `carga={tipoCliente,nome,email}`, the one remaining hypothesis is answered without
  investigation: a tab left open from before a deploy calling the old signature, of three
  positional arguments, against a server that now expects an object.
- **The same class of defect in `submeter`**: `notificarSubmissao` promises in its comment not to
  throw, and it threw — the `env()` reading the internal notice destination validates the whole
  environment and blew up **three lines before** the two client emails entered the queue.
  Guarded, and `origemPublica` for the internal notice with it.
- **`src/features/processos/acoes.test.ts`**, new: it mocks the database, the audit trail and the
  email channel and pins the rule in six cases — audit throwing, `headers()` throwing,
  `origemPublica` throwing, `revalidatePath` throwing, `link.enviado` throwing, `enviarEmail`
  throwing. In all of them, **the email was attempted anyway** and the action returned the link.

**How to confirm in production, without a database at hand:** open `/processos/<id>` for one of
the five and look at the audit trail. If there is **no** `processo.criado`, the action was dying
in `registarEvento` and this is it. If there is a `processo.criado` and no `link.*`, the
`if (emailCliente)` did not open and the running image predates `6c12b47`. In the container logs,
a `grep` for `[processo] pedido de criação recebido` gives the same answer in one line.

**Unconfirmed (third time):** `pnpm test` and `pnpm typecheck` were again blocked by permissions.
Run them before committing — there is a new test file.

### Update — the 404 on the onboarding link

10/08/2026. Reported: an onboarding link returning 404. Sweep of the token's entire path, from
generation to the client page. Five ways for a **valid** link not to open, and all five presenting
with the same screen — "this page does not exist" — which is the reason the report could not be
reproduced by eye: the URL, by eye, looks fine.

1. **The token picks up dirt on the way** (D47). A token is 43 characters of `base64url`, and
   what reaches the server has passed through an email client and a paste: it carries the full
   stop from the end of the sentence, Outlook's `<>`, a hard space, a `​` from webmail, the
   trailing slash the browser adds. None of those can exist in a token, and any of them changes
   the SHA-256 entirely.
2. **The token and the hash were two lines** (D47). `gerarToken()` at the top,
   `hashToken(token)` further down inside the `values` — the day one of them hashes something
   else gives a real matter with a link the query never finds. They now both come out of the same
   `novoTokenAcesso()`.
3. **A collision on `processo_token` left an orphaned matter** (D48). The 23505 `catch` treated
   both unique constraints as one: it retried the INSERT with the **same** token four more times
   and gave up — while the row existed on the other side, and the only token that opens it was
   going to be thrown away with the call. It now distinguishes the constraint and recovers the
   row.
4. **Nobody tried the link before handing it over** (D48). A lookup is now performed, through the
   same function that serves the client page; on failure, the hash and the validity are reset; on
   failure again, the dialog says **on screen** that the link does not open and `link.nao_resolve`
   goes into the audit trail. A link that does not resolve stops being discovered through a
   complaint.
5. **There were two links** (D48). The email's came from `origemPublica()` and the dialog's was
   assembled in the browser with `window.location.origin`. They coincide almost always — until
   somebody opens the back-office over `localhost`, over a tunnel, over an IP or over a second
   domain. The server now returns the link, and that is the one the dialog shows.

And the 404 itself (D49): `processoPorToken` returned `null` for everything and the four routes
answered it with `notFound()`. It becomes `acessoPorToken`, with four states — `ok`, `expirado`,
`arquivado`, `desconhecido` — and the client sees what happened and what to do next. The Server
Actions say the same text, from the same source.

**Unconfirmed (fourth time):** `pnpm test` and `pnpm typecheck` were again blocked by permissions.
None of these changes were executed. There are two new test files
(`src/lib/token.test.ts`, `src/features/onboarding/dados.test.ts`) and
`src/features/processos/acoes.test.ts` changed its mocks.

### Update — «sent» did not mean «delivered»

10/08/2026. Reported: in a test with twenty companies, **one** of the registration emails stayed
at `enviado` in `email_log` and never reached the recipient's inbox (mail.tm). No server error,
nothing in the console, and — what matters — **indistinguishable in the listing from the nineteen
that arrived**. The matter was left without a link and nobody had any way of knowing which of the
twenty it was.

The log row was written at the moment the provider answered 200. That is a statement about
**acceptance**, not about delivery, and the "Enviado" label said the second thing. Between the 200
and the mailbox there is a destination server that can still refuse (full mailbox, address that
does not exist, greylisting that expires, filter that bounces) — and none of that came back to
this platform.

- **`estado_email` gains three values** — `entregue`, `devolvido`, `queixa` — and `enviado` comes
  to mean, literally, "the provider accepted it; delivery is unconfirmed". The label in `/emails`
  is now **Aceite**, not **Enviado** (see D50).
- **`canal` and `mensagem_id`** in `email_log`: who accepted it, and with which identifier.
  Without the pair there is nobody to ask about the outcome — Brevo's id does not exist in
  Resend, and each one's lookup has its own address, header and format. `verificado_em` says when
  the question was asked.
- **Deferred polling, not a webhook** (D51): `confirmarEntrega` runs detached after the send,
  asks the provider at 15s, 45s and 2m30, and closes the row on the first outcome. Resend via
  `GET /emails/{id}` (`last_event`), Brevo via
  `GET /v3/smtp/statistics/events?messageId=…` (event list, the most severe one wins).
- **A bounce writes the reason into the `erro` field** and shouts it in the console with the
  recipient and the template in front. A bounce now counts, in the page header, towards the
  messages that "did not arrive" — alongside the send error, because it is the same problem seen
  from two places.
- **`pnpm email:conferir`** (D51), also inside the image: it checks the rows left at `enviado`
  and closes them. It is what plugs the polling's two holes — a container restart partway
  through, and an outcome that arrives hours after the last attempt.

**Unconfirmed:** `pnpm test` and `pnpm typecheck` were again blocked by permissions.
Run them before committing — `src/lib/email.test.ts` grew two new blocks, and there is a
migration `0010` still to be applied.

### Update — Product Owner's product review (23/08/2026)

Seven points. Everything additive in the database: migration `0015`, no existing column altered,
no earlier migration touched. Thirty tables.

1. **Commercial proposal attached to the invitation** (D52). The "Novo processo" dialog now
   accepts this client's proposal PDF, and so does the matter detail — the proposal is often
   still not finalised when the case file is opened, and without the second place the only way
   out was creating a new matter just to be able to attach a file. At step 7 that is what the
   client reads and accepts; with no attachment, it falls back to the generic `/custos.html`, as
   before.
2. **Firm T&C — slot prepared, not yet activated** (D53). Three nullable columns in
   `organizacao` and the value `termos_sociedade` in the enum, with nothing reading them. What is
   missing is in `docs/TERMOS_SOCIEDADE.md`. The end client does not have to do anything new.
3. **Corporate tax number starts with 5, 6, 8 or 9** (D54), in the back-office and at step 2 of
   the Company path.
4. **Phone with exactly 9 digits** (D55). It accepted `123` and it accepted `9123456789`.
5. **Mandatory attachments at step 2** (D56): identification and tax number proof on both paths,
   plus the permanent certificate for legal entities.
6. **Email verification code at closing** (D57), between the final declaration and the signature.
   Without it, the signature canvas does not mount and the submit button does not wake up.
7. **Correcting without walking the whole flow again** (D58): the review's "Corrigir" links carry
   `?regresso=fecho`, and that step's "Guardar" returns the client to the closing step.

**Verified in this session:** `pnpm test` 385 green (19 files), `pnpm typecheck` clean,
`pnpm build` clean, `pnpm db:validar` applying `0015` on an ephemeral PGlite. `pnpm lint`
continues to fail with exactly the same 10 problems as before (6 errors, 4 warnings, all in
`use-mobile.ts`, `smtp.ts`, `Lombada.tsx` and `email.test.ts`) — none introduced here.

**Outstanding, and the only thing left half-done:** the reader for the attached proposal **does
not measure reading to the end**, unlike what D30 requires for the T&C. See the second half of
D52.

### Update — firm and user onboarding, the two portals, and the API (25/08/2026)

The client's message of 25/08 has two halves. The first is a re-check of the seven points of the
23/08 product review: **six were already done** (D52, D54–D58 — commercial proposal, corporate
tax number 5/6/8/9, nine-digit phone, mandatory attachments at step 2, OTP at closing, correction
returning to the closing step). The seventh — the firm's T&C — was only a prepared slot (D53),
and the client had asked for it to be held until user onboarding was defined. The second half is
that definition: *"quero um portal admins, de admins da sociedade e um portal de advogados
normais"* and *"tens q fazer o processo de onboarding tudo da sociedade e onboarding de users
todo"*. Two more asks arrived while the work was in progress: **the app has to be ready for a
legal review**, and **the onboardings need an API a bot can drive**.

Everything additive in the database: migration `0016`, no existing column altered, no earlier
migration touched. Thirty-five tables.

**Firm onboarding** (`/sociedade/[token]`, six steps). The platform used to start at the point
where a firm already existed — the organisation came from the seeds and accounts were written on
the server (D23). That is fine for one firm and stops being fine at the second. A firm is now
invited with `pnpm sociedade:convidar`, which creates the organisation shell plus the magic link,
and walks: identification (NIPC with the D54 rule, legal form, Bar number, reference prefix),
address and contacts, permanent certificate, **its T&C**, the first administrator, and a binding
declaration. Submitting creates the administrator's own invitation and emails it.

**User onboarding** (`/convite/[token]`, six steps). Personal data, professional data (bar card,
mandatory only for `advogado`/`socio` — an assistant legitimately has none, and requiring it made
the step impossible to close), documents, **GDPR and professional secrecy**, the firm's T&C, and
the password. **The account does not exist until the last step**, which is what stops anyone
logging in without having finished identifying themselves; the three writes (`user`, `account`,
`utilizador`) are one transaction.

**The two portals.** `/admin` for firm administrators — firm data, publishing a new T&C version,
the team with each person's acceptance beside them, invitations (create, resend with a *new*
token, cancel), roles and activation, and `/admin/conformidade`. `/advogado` for everybody else —
own profile, professional data, own documents, own acceptance history, and the team. It is not a
reduced administration: administration answers *who has access*, this answers *what does the firm
hold about me and what do I have left to do* — and under GDPR a person has to be able to see
their own data without going through whoever administers.

**Firm T&C activated** (D59). `termosEmVigor` resolves what is in force per organisation, and it
is the only function that knows: client step 7, user onboarding step 5 and the lawyer portal all
call it, so there is no day on which the firm has two articles of terms in force without knowing.
It falls back to the platform text in **three** cases and not just the obvious one — never
delivered, delivered and since deleted, delivered with no version — which is what a check against
`termos_documento_ref != null` alone let through.

**Prepared for legal review** (D60, D61). `fecho_proposta.tc_versao` is new and it closes a real
hole: the client's T&C acceptance was a boolean, so it said somebody accepted and did not say
what — and the day the firm bumped a version, every earlier acceptance would read as an
acceptance of the new text. Step 4 of user onboarding separates the three answers that are
usually conflated: information (not consent, because the lawful basis is contract and legal
obligation), a secrecy declaration, and one actual consent. `docs/CONFORMIDADE.md` maps each
obligation to where it is met **and lists what is missing**, marked ⚠ rather than hidden — the
beneficial owners (A19) and the seven-year purge are the two that matter most.

**API for the bot** (D62). `/api/onboarding/{cliente,sociedade,convite}/…`, documented in
`docs/API.md`. Every route calls the same function the screen calls; there is no second set of
rules with the same name. Two auth layers — the magic-link token in the path, and `API_CHAVE` as
a bearer token — and **without the key configured it answers 503 rather than opening**.

**Found along the way, and unrelated to the ask:** `pnpm db:validar` had a
catastrophic-backtracking regex (`/^(--[^\n]*\n?)+$/`) that hangs the script on any migration
with a comment-only block. The symptom does not point at the script — it freezes immediately
*before* printing the new migration's first statement, and the obvious reading is that the
migration is at fault. Replaced with a linear line-by-line check.

**Refactors that made the above possible, all behaviour-preserving:** `Anexos`, `Lombada`,
`LeitorTermos`, the unavailable-link screen and the error-targeting DOM helpers moved to
`src/components/`, with the client-flow files becoming thin wrappers; the shared Zod pieces moved
to `src/lib/campos.ts`; the email frame to `src/lib/emails/moldura.ts`; the country list to
`features/onboarding/componentes/paises.ts`. Each of these had cost real effort to get right
(D41's `useId`, the field that clears itself in the `finally`, the D30 measurement), and a second
copy would have lost half of those lessons in a month.

**Verified in this session:** `pnpm test` 469 green (25 files), `pnpm typecheck` clean,
`pnpm build` clean, `pnpm db:validar` applying `0016` on an ephemeral PGlite (35 tables, audit
trail still refusing UPDATE and DELETE). `pnpm lint` fails with 9 problems (6 errors, 3
warnings), all pre-existing — one fewer than before, because a refactor removed an unused
variable. **Not verified:** none of the new flows has been walked in production, and no seed
creates a firm onboarding — the first walkthrough needs `pnpm sociedade:convidar` on the server.

### Update — the new flows walked in a running environment (25/08/2026, later)

The previous entry ended with *"none of the new flows has been walked in production"*. They have
now been walked — not in production, which this session cannot reach (the egress policy blocks
`poc.terlicalabs.com`), but against a **real Postgres 16 with the migrations applied, the
production build, and Chromium**. Which is the point: `pnpm build` and `pnpm typecheck` were
clean the whole time, and **four defects were sitting there**, three of which nothing but
rendering a page could have found.

1. **A function crossing the server/client boundary** — every new page was a 500. `Lombada` took
   `href: (n) => string`, and the layouts that mount it are Server Components: *"Functions cannot
   be passed directly to Client Components"*. Not a type error and not a build error — a runtime
   serialisation rule. It is now `base: string` and the component appends the step; the three
   flows have links of the same shape, so the function never had anything to express that the
   prefix does not.

2. **The layout swallowing its own success screen.** The spine layout refuses anything that is
   not a registration in progress, and a **submitted** registration is one of those. Sitting a
   level above `/submetido`, it replaced the success screen with "this registration has already
   been submitted" — with the step spine around a registration that no longer has steps. Both
   spine layouts moved down into `passo/`.

3. **The first administrator's invitation dying inside a failed email.** This is the serious one.
   `submeterSociedade` generated the token, emailed it, and discarded it. The email failed (no
   provider configured), `email_log` recorded the failure correctly — and the person named as
   administrator became permanently unreachable: the firm submitted, the invitation `pendente`,
   and **no way to open it**. It is the only invitation on the platform that cannot be resent,
   because it is born before any account exists to log in and press "Resend". The link is now
   returned by the action and shown on screen when the email does not go out, with the provider's
   reason underneath — D48, applied where it had been missed.

   Removing `revalidatePath("/")` from that action was part of the same fix: revalidating the
   root from a public action is far too broad, and what it actually did was make Next re-render
   the route mid-call, letting the layout take over and erase the panel carrying the only
   plaintext copy of the link.

4. **Two nested `<main>` landmarks** in the back-office (pre-existing, not from this work):
   `SidebarInset` already renders a `<main>`. Invalid HTML, and a screen reader jumping to "main
   content" finds two. It surfaced only when a selector resolved to two elements.

**What was verified, walked and not inferred:** firm registration end to end with every refusal
firing (corporate tax number starting with 2, prefix with a space, ten-digit phone, missing
certificate, T&C as a PNG, unticked declaration); user registration end to end, with the bar card
correctly absent for a profile that does not practise law, both mandatory declarations at step 4,
the T&C checkbox locked until the document is opened, and the account created only at the last
step; login and both portals; publishing a new T&C version, the repeated version refused with the
one in force named, the person immediately appearing under "acceptances missing" and leaving it
after accepting — with **both** rows of evidence preserved; duplicate invitation refused; demoting
the last administrator refused; the audit chain intact across 35 events and 3 organisations
(`pnpm auditoria:verificar`).

**The API was walked too, and it created a lawyer's account from end to end** — every step, both
uploads, and `POST /concluir` — with 401 without a key, 400 on malformed JSON, 422 with the field
named on a business-rule refusal, 415 on a non-multipart upload, 409 on `POST /passo/6` pointing
at `/concluir`, a file claiming to be a PDF refused by magic bytes, and a document type outside
the allowlist refused.

**And point 2 was proven at the far end:** a matter opened from the back-office came out as
`PA-2026-0002` — the prefix the firm chose in its own registration — and step 7 serves
`TERMOS.PDF · VERSÃO 2026.09.1`, the firm's document, with the unlock text correctly saying
"open the document" and not "read it to the end" (D59), and the OTP still holding the signature
canvas back (D57).

**Still not walked:** the closing of a client matter, because the verification code goes by email
and no provider is configured here — the code is a ten-minute secret that is deliberately written
to no log (D57), so there is no way to read it from this side.

### Update — S3 driver prepared, no documents moved (01/09/2026)

Owner's instruction, verbatim: *"Do not migrate already the documents please as this is a
demonstration as of now that into the next week we will deploy the documents to the AWS."* This
PR (`feat/s3-por-sociedade`) is only the code side of that: a second storage driver next to
`servidor.ts`, so that turning it on for a firm is a configuration change and not a rewrite.
**Nothing existing moves.** The 96 identification PDFs and the signature images already in the
database stay there; migrating them is a dedicated script, deliberately left for next week (D65).

`src/lib/storage/s3.ts` signs PUT/HEAD requests with SigV4 by hand (`node:crypto` + `fetch`), the
same call as `servidor.ts` made for curl over an SSH library: the two request shapes this driver
needs do not justify `@aws-sdk/client-s3`'s dependency weight in the build. `armazenamento_sociedade.bucket_s3`
(migration `0027`, additive, nullable) is the switch `criarDestino` reads — filled in, S3; null,
SFTP exactly as before. `scripts/armazenamento.ts configurar --protocolo s3 --bucket <nome>` wires
an already-created bucket to a society; creating the bucket itself stays manual, in the AWS
console, while there are only five of them.

**Verified in this session:** `pnpm typecheck` clean, `pnpm test` 880 green (up from 874 — the new
S3 driver tests, mocked at `fetch`, never talk to AWS), `pnpm build` clean, `pnpm db:validar`
applying `0027` (38 tables). Not walked against a real bucket — the five buckets already created
(`lexflow-pmf-consulting`, `lexflow-andrade-costa`, `lexflow-mota-associados`,
`lexflow-bernardino-lopes`, `lexflow-pinto-costa`) are referenced in the driver's tests and in
`docs/ARQUITETURA.md`, not touched by this session.

## Infrastructure — ~€65/year for unlimited POCs

Complete guide in [`docs/DEPLOY.md`](docs/DEPLOY.md).

| Layer | Choice | Cost |
|---|---|---|
| Domain | `terlicalabs.com` at Cloudflare Registrar | ~€10/year |
| Server | Hostinger VPS KVM 1 (1 vCPU, 4 GB), Ubuntu 24.04 in the EU | ~€5–8/month |
| PaaS | Coolify, self-hosted | free |
| Postgres | on the server itself, via Coolify | free |
| Email | Resend | free (3,000/month) |
| Signature | outside POC scope | see `docs/DECISAO-ASSINATURA.md` |

**Address of this POC:** `poc.terlicalabs.com`. The apex `terlicalabs.com` is the Terlica Labs
website, where projects are requested, and it lives in another repository — same server,
different project in Coolify.

**Why not Vercel:** the Hobby plan forbids commercial use, and these are client projects. Pro is
€20/month, per project on the account. The VPS is a fixed cost that does not grow with the number
of clients.

**Why not Supabase:** the free plan suspends the project after 7 days without use — exactly the
pattern of a POC shown once a fortnight. With Postgres on the server itself the problem
disappears and one account is saved.

## POC scope cut — to be validated

**In scope:** the 5 steps with drafts and a magic link · back-office with a filterable listing and
matter detail · append-only `evento_auditoria` with a hash chain · risk engine · roles enforced in
the application · §3 design tokens.

**Out of scope (with the schema already prepared):** RLS in Postgres — application guards only ·
TOTP MFA · EN locale · case file PDF generation · digital signature · CSV/PDF exports ·
transactional emails beyond the magic link · the Company path, for as long as there are no
screenshots.

**The audit trail stays in scope on purpose.** It is the heart of the value in a KYC system and
costs little to do well from the start; grafting it on later forces rewriting every write.

## Golden rule of the domain

This is KYC/AML subject to Lei 83/2017, Bar Association Regulation 2/2020 and the GDPR. Immutable
audit trail, 7-year retention, consents with evidence, and erasure that cannot erase what the law
requires to be kept. A functional requirement, not a disclaimer. **Being a POC does not change
this** — it changes what is built around it.

## Decisions taken

| # | Decision | Where |
|---|---|---|
| D1 | In-house signature (`signature_pad` + `pdf-lib`) when the time comes; outside the POC, because the current form has no signature at all | `docs/DECISAO-ASSINATURA.md` |
| D2 | `utilizador` (domain) kept separate from the Better Auth tables, linked by `auth_user_id` | `docs/SCHEMA.md` |
| D3 | `versao_texto_legal` as its own table; consents reference it by FK | `docs/SCHEMA.md` |
| D4 | Magic link token stored only as SHA-256 | `docs/SCHEMA.md` |
| D5 | `evento_auditoria` immutability via `REVOKE` + `RULE ... DO INSTEAD NOTHING` in Postgres | `docs/SCHEMA.md` |
| D6 | Audit hash chain per organisation, not global | `docs/SCHEMA.md` |
| D7 | Dynamic lists in 1:N tables, not JSONB | `docs/SCHEMA.md` |
| D8 | Address as a reusable set of columns (7 fields: morada, país, localidade, CP, freguesia, concelho, distrito), repeated in client/representative/billing | `docs/SCHEMA.md` |
| D9 | Nationality in a 1:N table — the form accepts several per holder | `docs/SCHEMA.md` |
| D10 | Supabase free as Postgres + Storage; Better Auth stays as auth | this file |
| D11 | `env()` and `db()` are lazy, not module constants — `next build` does not need a database, and failing the build for want of a runtime secret is a bad deal | `src/env.ts` |
| D12 | `prepare: false` on the Postgres connection — Supabase's pooler in transaction mode is pgBouncer and does not support prepared statements | `src/db/index.ts` |
| D13 | Full-text search by trigger and not by generated column: `unaccent` is not immutable and the sources (name, tax number) are in other tables | migration `0001` |
| D14 | 30-day sessions for POC (deliberate client decision for convenience: "não tenho que ir a cada vez"; review to 8h for production) | `src/lib/auth.ts` |
| D15 | The `id`s are generated in the application (`uuidv7`), not by the database — Postgres only has native `uuidv7()` in v18. Practical consequence: any raw SQL INSERT has to supply the `id` | `src/db/schema/_comum.ts` |
| D16 | Hosting on our own VPS with Coolify, instead of Vercel — the Hobby plan forbids commercial use and Pro is €20/month. A fixed cost for unlimited POCs | `docs/DEPLOY.md` |
| D16b | Provider: Hostinger (Hetzner required a VAT ID). An EU company with an EU datacenter — for a system holding identification documents and PEP declarations, a US provider would bring Cloud Act exposure even with a European datacenter | `docs/DEPLOY.md` |
| D17 | Postgres on the server itself instead of Supabase — it eliminates the free plan's suspension after 7 days without use, which is the pattern of a POC shown once a fortnight | `docs/DEPLOY.md` |
| D18 | `output: "standalone"` and a three-stage Docker image; the migrations run at container startup and, if they fail, it does not come up | `Dockerfile` |
| D19 | Representative step removed from onboarding (client request); the flow becomes 5 steps. The `representante_legal` table stays in the schema, it just stops being written | this file |
| D20 | Approval flow deleted (not merely hidden): `alterarEstadoProcesso`, `AcoesProcesso`, `podeAprovarRiscoElevado`, decision email. The `aprovado`/`rejeitado` states stay in the schema as possible final states, only with no path in the UI to reach them. **Correction, 29/08/2026: no longer accurate — the approval flow was rebuilt on 11/08/2026** (migration `0013_fluxo_aprovacao.sql`) and is in production: `aprovarProcesso`/`rejeitarProcesso` in `src/features/processos/acoes.ts`, surfaced by `AcoesAprovacao.tsx` and mounted in `DetalheProcesso.tsx` whenever `processo.estado === "aguardar_aprovacao"`. This row is left in place as a record of the decision that held at the time; it does not describe the flow as it exists today | this file |
| D21 | Risk (`nivelRisco`, `fatoresRisco`, PEP forces high risk) stops appearing in any UI — back-office or client onboarding — but the calculation and the writes continue; grafting it back one day means showing fields that already exist, not rewriting logic | this file |
| D22 | Legal Representative step back in the flow, between Tax and PEP (reverses D19). 7-step flow, no migration — the table and the enum already existed | this file |
| D23 | No public sign-up: `disableSignUp: true` and `/registar` deleted. Accounts created on the server by `scripts/criar_utilizador.mjs`, with the hash coming from `better-auth/crypto` and not from a reimplementation | `scripts/criar_utilizador.mjs` |
| D24 | `summary.pdf` is written without object streams and carries the matter reference as a plain-text entry in the Info dictionary. An archive summary has to be identifiable without a PDF library at hand — and pdf-lib's `setTitle` writes in hexadecimal UTF-16BE | `src/lib/storage/resumo.ts` |
| D25 | `nomeSeguro` preserves the trailing dot of a company name ("Lda.", "S.A.") and only strips it when the name starts with a dot, which is the shape of a hidden file. It contradicts the SharePoint rule on purpose: a folder with the wrong legal name is worse than a folder with a name SharePoint normalises | `src/lib/storage/tipos.ts` |
| D26 | Production image on `node:22-bookworm-slim` and not on Alpine: Alpine's `curl` is compiled without libssh2 and has no `sftp://`. The alternative — `openssh-client` and rewriting the adapter around the `sftp` binary — cost the `.netrc` (the password would start depending on `sshpass`) and `--hostpubsha256` (host key pinning). Swapping the base costs megabytes of image and zero lines of logic. The `curl --version \| grep -qw sftp` in the Dockerfile is what prevents the silent regression: without sftp, the image does not build | `Dockerfile` |
| D27 | Each client folder carries two PDFs: `summary.pdf` with the matter detail and `dados_cliente.pdf` — a cover page with date, reference, name, tax number and the index of the files. The second name is not our choice, it is what the Python helper already left in each client folder and what the case file is searched by. The cover is generated last, once there is something to index, and it does not index itself | `src/lib/storage/capa.ts` |
| D28 | Step 3 (Legal Representative) only appears for legal entities. An individual represents themselves — the question has no possible answer. The **numbering does not move**: the step is still 3 and Closing still 7, because renumbering would break the audit labels (`passo.N.gravado`), the `passo_valido` constraint and the already-saved "Corrigir" links. What changes is the path: `passosDoProcesso`, `proximoPasso` and `passoAnterior` skip it, and the header count becomes "de 06" | `src/features/onboarding/passos.ts` |
| D29 | The step 3 question is inverted: "É o representante legal desta entidade?" — **Sim** proceeds (whoever is filling in already identified themselves at step 1), **Não** opens the representative's fields. With no starting answer, unlike before: pre-answering a declaration about who acts on whose behalf is treating it as done. Switching to individual at step 1 deletes the representative row — left there, it appeared in the archive PDF describing a matter that is no longer that one | `src/features/onboarding/schemas.ts` |
| D30 | The T&C acceptance checkbox only unlocks after the document has been opened and scrolled to the end, banking-style. The text is rendered inside the reader and not in an `iframe`: that way the end of the document is a measurement of the element itself, without depending on the browser allowing another document's `scrollTop` to be read. A document that fits entirely on screen counts as read — otherwise the checkbox would stay locked forever on a large monitor. The same text is at `/termos-condicoes` and goes as a PDF in the welcome email, all three from the same source | `src/lib/termos.ts` |
| D31 | Three emails to the client, all in `src/lib/emails/jmassano.ts`: **JMASSANO \| Registro** (with the link, at the moment the firm creates the matter), **JMASSANO \| Confirmação de Receção dos seus Dados** and **Bem-vindo à JMASSANO Escritório de Advogado** (with a summary, T&C and fee proposal attached). The last two both go out on submission because the POC has no approval step (D20) — there is no second moment at which to welcome. The attached summary is the same `summary.pdf` that goes to the archive, generated from the same place, so the client and the firm do not end up with different versions of the same document | `src/lib/emails/jmassano.ts` |
| D32 | A single storage destination: the firm's server, over SFTP. OneDrive and WebDAV left the code, the schema (the `tipo` column and the `tipo_armazenamento` enum were removed in migration `0007`) and the scripts (`gera_pasta_cliente.py` deleted). `protocolo` stays in the Zod schema fixed at `z.literal("sftp")`, and it does not disappear: it is what makes an old configuration on another protocol blow up at the boundary instead of being treated as SFTP. The migration deletes the credentials of rows that were on `onedrive` — a Graph secret with no purpose does not stay recorded | `src/db/migrations/0007_armazenamento_so_sftp.sql` |
| D34 | `email_log` is written inside `enviarEmail` and not at the places that send, and `template` is a mandatory parameter: a new sending path does not compile without answering "which email is this", which closes the door on unlogged sends. It is not an audit trail and does not replace one — `evento_auditoria` remains append-only with a hash chain and is what the law requires to be kept; this is the channel's technical log, which can be truncated with no consequence. It stores the token's **hash** and never the plaintext token (otherwise reading the table would be enough to enter any case file, against D4), and it does not store message bodies — duplicating personal data into a diagnostic table multiplies GDPR surface for nothing. The write never throws: an email that does not go out *because* the logging failed is worse than an unlogged email | `src/lib/email.ts` |
| D35 | `/emails` is for the `admin` role only, with the guard on the page (`exigirAdmin`) and not only in the sidebar — hiding the navigation entry does not close the address to anyone typing it by hand. The list shows client addresses side by side, it is for diagnosis and not for daily work. The values of `?estado=` and `?template=` are filtered against the enum before reaching `inArray`: without that, a hand-written parameter was a 500 straight from the URL | `src/app/(backoffice)/emails/page.tsx` |
| D36 | "Novo processo" is a dialog (`components/ui/dialog.tsx`, on top of the `radix-ui` that `sheet` already used) and not an inline block. Opened inline, the form took the width and alignment of wherever it happened to be, and the link panel that followed it stayed where the button was until somebody reloaded the page — which made creating a second matter impossible. The content only mounts with the dialog open: that is what guarantees it reopens clean | `src/features/processos/componentes/BotaoNovoProcesso.tsx` |
| D37 | `EMAIL_NOTIFICACOES` with no default value. What was there was a personal address hard-coded, and in an installation missing the variable it meant client case file references and links going out to the inbox of whoever wrote the code. With no destination configured, the back-office notice does not go out and a `console.warn` remains — the two client emails and the SFTP archiving do not depend on it. The link's address also stopped being hard-coded: it comes from the request headers, as the registration email's already did (`lib/origem.ts`, now shared) | `src/features/onboarding/acoes.ts` |
| D38 | `textoEmVigor` looks up by **key and version**, and not by the most recent row for the key. It was not like that: the mere existence of a row meant it was returned forever, and changing the wording in the code had no effect at all on a running installation — the client consented to the old text while the screen showed them the new one. With lookup by exact version, bumping `versao` creates a new row and earlier consents keep pointing at the text the people who gave them actually saw, which is what D3 requires | `src/features/onboarding/consentimentos.ts` |
| D39 | Attachment extensions and MIME types in a single source (`formatos.ts`), with the field's `accept` derived from it. The declared MIME wins when it is known; only when the browser does not commit (`""`, `application/octet-stream`) does the extension decide — a file claiming to be `text/html` and named `x.pdf` is still refused. They were written in two places and diverged: the field announced `.heic`, the server would not let it in | `src/features/onboarding/formatos.ts` |
| D40 | `naturezaJuridica` mandatory for legal entities, in the same `superRefine` where an individual already gives occupation, employer and date of birth. It is legal form, not an incidental field — it decides who can bind the entity, which is what step 3 asks next. No migration: the column exists and stays nullable, because earlier drafts cannot become invalid in the database; the requirement is in the Zod schema, at the boundary | `src/features/onboarding/schemas.ts` |
| D41 | The `Anexos` ids come from `useId()`, as every other field's already did (`Campo.tsx`), and not from `ficheiro-${titulo}`. A Portuguese title produced `id="ficheiro-Documentação"` — valid, but fragile to address: `ç` and `ã` have two Unicode representations (NFC and NFD) that read the same and are not the same sequence of code points, and `querySelector` compares code points and not canonical forms. A selector that passes through a tool normalising to NFD does not find a field that is there. What gives the field a stable name becomes `data-campo`, which is ASCII and does not change with the on-screen text | `src/features/onboarding/componentes/Anexos.tsx` |
| D42 | `enviarEmail` never propagates and never waits forever: `tentarEnviar` runs inside a `try` (`env()` throws *before* the inner `try`, and that exception jumped over the write and blew up the matter creation) and the `fetch` carries `AbortSignal.timeout(15s)` (without it, a closed outbound path to the internet hung the Server Action with no error at all). Each attempt leaves a console line with template and recipient, and the write failure is shouted with the same fields — without that, «0 mensagens» in `/emails` means both "it was never even attempted" and "it was attempted and not recorded", which is the difference an investigation needs to see | `src/lib/email.ts` |
| D43 | The failure reason comes out of the server and reaches the dialog, and there is a `pnpm email:testar <destination>` inside the production image. The three causes of "the client received nothing" — key not reaching the container's environment, `EMAIL_REMETENTE`'s domain unverified at Resend (403, and `POC@jmassano.pt` is a default value nobody suspects), closed outbound internet access — all say «não foi possível enviar» and are solved in three different ways. The script writes to `email_log` in the same row shape: if it appears in `/emails` and a created matter does not, the problem is upstream of the send | `scripts/testar_email.mjs` |
| D44 | A matter created **without** an address writes `link.sem_email` in `evento_auditoria`, and the Server Action returns `paraServidor` — the address the server received, next to the one the dialog sent. The two close the last place where the platform could stay silent: `email_log` records send attempts and cannot record a send that was never requested, so «0 mensagens» in `/emails` said both "there was no address" and "there was an address and it got lost on the way" — which are fixed in different places (reload the page versus go to the Resend dashboard). The dialog stops accusing the send of a failure that belonged to the request | `src/features/processos/acoes.ts` |
| D33 | The bodies of the three emails become those of the client's analysis document, verbatim — including the open signature ("Assinatura do Advogado gestor do Cliente"), which is the space for the lawyer managing each client. Two things fall away for not being in that text: the greeting stops carrying the name ("Caro(a) Sr.(a)," is what is there) and the matter reference leaves the body of emails 2 and 3 — it stays in the subject of the back-office notice and in the attached summary. The T&C summary block leaves email 2 for the same reason; the full T&C go as a PDF in email 3. The `nome` and `referencia` parameters stay in the signatures, accepted and ignored, so either can be restored without touching the callers | `src/lib/emails/jmassano.ts` |
| D46 | From the matter's `INSERT` onwards, **each step of `criarProcesso` runs inside its own `try`** and the action has a single exit. The email send sits behind an `if`, and getting there depended on three `await`s with no network underneath — `headers()`, the `registarEvento` for `processo.criado`, and `origemPublica()`. None has anything to do with email, and any of them throwing gave the same screen: matter in `/processos`, `/emails` at zero (the one writing the row is `enviarEmail`, and it was not called), no `link.*` in the audit trail, and «o servidor não respondeu» in the dialog. That is why three passes reading the send path did not close the case — the send path was correct and was not being reached. The audit trail is still written by the same `registarEvento`, with the same chain; what it can no longer do is interrupt the rest. Same arrangement in `submeter`, where the internal notice's `env()` blew up before the two client emails entered the queue | `src/features/processos/acoes.ts` |
| D47 | The plaintext token and the hash come out of the same `novoTokenAcesso()`, and every token arriving from outside passes through `normalizarToken` before being looked up. The two halves of the same defect: a hash that is not that token's, and a token that is not the one that left here. The cleanup is **only at the ends** — trimming the middle would turn a corrupted token into a possibly valid one, which is hiding the fault; at the ends there is no such risk, because the length is fixed and no token is a prefix of another. `hashToken` normalises before computing, which makes the lookup idempotent: the link with the full stop stuck on from the email's sentence finds the same row as the clean link | `src/lib/token.ts` |
| D48 | `criarProcesso` **tries the link before handing it over**, through the same `acessoPorToken` that serves the client page — not through a second query written separately, which would diverge, and diverge precisely on the side that is not on the client's path. On failure, it resets the hash and the validity once; on failure again, it returns `linkVerificado: false`, the dialog warns in red and `link.nao_resolve` goes into the audit trail. In the same pass: the 23505 now distinguishes `processo_referencia_org` (retry with another number) from `processo_token` (the row already exists — recover it, because retrying with the same token could never work and giving up left a matter nobody could reach again), and the link is now assembled **once only, on the server**, and returned to the dialog instead of being rebuilt in the browser | `src/features/processos/acoes.ts` |
| D49 | `acessoPorToken` returns four states — `ok`, `expirado`, `arquivado`, `desconhecido` — in place of `Processo \| null`, and the four onboarding routes show `LinkIndisponivel` instead of `notFound()`. A `null` forces its recipient to invent the reason, and what each route invented was a 404: the same sentence for "the link expired", "the case file was archived" and "you mistyped the domain", which are fixed in three different places. The deleted and validity filters left the `where` — inside it, an archived matter and an invented token both returned zero rows and no screen could tell them apart. **Nothing new is revealed:** anyone guessing tokens still receives `desconhecido`; the other three are only reachable by someone already holding a token that matches | `src/features/onboarding/dados.ts` |
| D50 | `estado_email` stops having two values and comes to have five: `enviado` and `erro` are about **acceptance** by the provider, `entregue`/`devolvido`/`queixa` are the outcome. The `enviado` label becomes **Aceite** — what the column always said was "the provider took the message", but the label said "it arrived", and that is how a message that never arrived appeared in `/emails` indistinguishable from nineteen that did. The new values go to the end of the enum, which is where `ALTER TYPE ADD VALUE` puts them: the array in `enums.ts` has to stay in the same order, otherwise the next `db:generate` proposes a migration fixing what is not broken | `src/db/schema/enums.ts` |
| D51 | Delivery is confirmed by **deferred polling in the process itself** and not by webhook. The webhook is the official route and would be the right one in a serious system, but it costs a public endpoint outside the authentication `middleware`, signature verification (`svix`) — without which it is a button for anyone to mark emails as delivered — and configuration in the dashboard of *each* of the two providers, which goes undone the day the account changes and nobody works out why the states stopped. Polling needs none of that: it runs in Coolify's long-lived container (not in a serverless function that dies with the response), it uses the key that already exists and it works the same on both channels, at the price of three HTTP requests per email. What it does not cover — a restart partway through, an outcome that arrives late — is left to `pnpm email:conferir`, and meanwhile the row stays at `enviado`, which is no lie at all: it is what is known | `src/lib/email.ts` |
| D52 | The commercial proposal is **one document per matter**, uploaded by the firm (`documento.tipo = 'proposta_comercial'`, PDF only, 4 MB) and served to the client via `/onboarding/[token]/proposta` — authorised by the same magic link that opens the steps. Uploading another soft-deletes the previous one: step 7 shows **the** proposal, singular, and two live rows would force picking one by ordering, which is how the client accepts the wrong one without anyone noticing. The upload runs **after** the matter's INSERT and its failure undoes nothing (same rule as D46) — the screen says the case file is open and the proposal did not go in, instead of making them repeat everything. **What is lost:** with an attachment, the checkbox unlocks on *opening* the document and not on reaching its end. `next.config.ts`'s `X-Frame-Options: DENY` refuses even the same domain, and an `<iframe>` would give a blank rectangle; measuring the scroll of a PDF that opens in another tab is not possible. Faking the D30 measurement was worse than saying it does not exist there | `src/features/processos/proposta.ts` |
| D53 | Firm T&C: **space prepared, nothing wired.** `organizacao.termos_documento_ref` / `termos_versao` / `termos_atualizado_em`, nullable, plus `termos_sociedade` in `tipo_documento`. While they are `null`, step 7 serves `src/lib/termos.ts` and the client does nothing new. `termos_documento_ref` is `text` and not an FK on purpose: `documento.processo_id` is `not null` and the firm's T&C belong to no matter — choosing between a dedicated table and a nullable column is done with the wording in hand, not today. The plan and the trap (D3/D38: bump the version, otherwise the difference between what the client accepted and what is now written is erased) are in `docs/TERMOS_SOCIEDADE.md` | `docs/TERMOS_SOCIEDADE.md` |
| D54 | `validarNipc` = `validarNif` plus the first digit being 5, 6, 8 or 9. `validarNif` answers "is this a valid tax number?" and the right answer for an individual's tax number is "yes" — in the corporate tax number box that answer is wrong in substance, and it was being recorded in `nif_cliente` saying the entity is that person. The prefix is checked **before** the checksum: saying "the last digit would have to be 4" about a number that is not even a corporate one sends the user to fix the wrong thing. At step 2 the rule is chosen by the **matter's** `tipo_cliente`, injected by `guardarPasso` — whatever the payload brought under that name was exactly what the rule exists to prevent being chosen | `src/lib/validacao-pt.ts` |
| D55 | Phone with **exactly nine digits**, with or without `+351`/`00351`. The `^\+?\d{6,15}$` that was here accepted `123` and accepted `9123456789` — and it is the second that costs: one digit too many looks like a correct number and is only discovered when somebody tries to call, weeks later, a client who is no longer looking at the form. Spaces, hyphens, dots and parentheses pass (that is formatting from someone copying off a business card); a foreign dialling code is refused **with that reason stated**, otherwise it reads as a counting error and the client ends up adding and removing digits from a correctly written number | `src/lib/validacao-pt.ts` |
| D56 | Step 2 does not close without the mandatory attachments — identification and tax number proof on both paths, plus the permanent certificate for legal entities (which for an individual would be a dead-end step, like step 3 in D28). The attachment list **does not come from the payload**: `Anexos` uploads via its own Server Action and the input does not even have a `name`, so the step's `FormData` never knew about files and never could. `guardarPasso` reads it from the `documento` table with the `apagado_em` filter (removal is a soft delete) and injects it before Zod. One error per missing document, and not a single "attachments missing": three documents to attach have to read as three things to do | `src/features/onboarding/schemas.ts` |
| D57 | Email verification code before the signature, in the new `codigo_otp` table: six digits, ten minutes, five attempts, one request per minute, and the verification valid for one hour (the time to read the T&C, read the proposal and sign — forcing a repeat partway through would turn the measure into an obstacle worked around by requesting another code). The SHA-256 of `processoId:codigo` is stored, with the matter serving as salt, and **the code never enters `evento_auditoria`**: it is a ten-minute secret and the record lasts seven years. The question is asked in `guardarPasso` **before Zod** — asked afterwards, the answer to the client was «Assine no quadro antes de submeter» about a canvas the platform is hiding until they validate the code — and repeated in `submeter`, which is a separate Server Action and callable on its own | `src/features/onboarding/acoes.ts` |
| D58 | The review's "Corrigir" links carry `?regresso=fecho`, and that step's "Guardar" returns the client to the closing step instead of sending them to the next one. The parameter is read on the **server** (`searchParams` as a prop, not `useSearchParams`) and confirmed against the matter: it is only valid when every earlier step is saved, otherwise hand-writing the parameter at step 1 threw the client into the review of an empty form. In the same pass, `passo_atual` stops going backwards (`Math.max`): saving a correction at step 2 set it to 3, and anyone closing the tab resumed at 3 on a matter that was already at 7 | `src/app/(cliente)/onboarding/[token]/passo/[n]/page.tsx` |
| D45 | `--marca` (terracotta `#d9694b`, `#e07a5f` in dark mode) is the only colour in the palette that does **not** encode state — it marks a user choice, and for now only in the "Novo processo" dialog: the selected card and the header badge. What was there was `border-tinta`, the colour of the surrounding text, and an outline in the text colour reads as a frame and not as "chosen". It stays a token rather than being hard-coded in the components for two reasons: dark mode needs a different value (the same hex over ink falls to 4.8:1 and the icon inside the card stops being legible), and the JMASSANO logo is **archive green and brass** — swapping this for `var(--latao)`, which is literally the logo's gold, is one line. Terracotta stays in outlines, badges and ticks, never in running text: 3.46:1 on white is enough for an interface element, not for body copy | `src/app/globals.css` |
| D59 | Os T&C da sociedade deixam de ser um slot (reverte a D53 na parte que dizia «por acionar»). `termosEmVigor` é a **única** função que sabe qual articulado está em vigor numa organização, e os três sítios que o mostram — passo 7 do cliente, passo 5 do registo de utilizador, portal do advogado — chamam-na a ela; duas funções com o mesmo propósito divergiriam, e o dia em que divergissem seria o dia em que a sociedade tinha dois articulados em vigor sem o saber. Recua para o texto da plataforma em **três** casos e não só no óbvio: nunca entregue, entregue e entretanto apagado, entregue sem versão — os dois últimos são o que uma verificação a `termos_documento_ref != null` deixava passar, dando um passo 7 a apontar para um ficheiro que não abre com a caixa trancada para sempre. Servido em PDF, **perde-se a medição de leitura até ao fim da D30** (o `X-Frame-Options: DENY` recusa o próprio domínio e um `<iframe>` daria um retângulo em branco): a caixa destranca ao *abrir*, e o ecrã diz que é isso que está a acontecer — a mesma escolha da D52, e fingir a medição era pior do que dizer que ali ela não existe | `src/lib/termos-sociedade.ts` |
| D60 | `fecho_proposta.tc_versao`: a aceitação dos T&C pelo cliente deixa de ser um booleano. Dizia que ele aceitou e não dizia **o quê** — e no dia em que a sociedade subisse uma versão, cada `tc_aceitacao = true` gravado antes passava a parecer uma aceitação do texto novo, apagando sem rasto a diferença entre o que ele leu e o que passou a estar escrito. É a D3/D38 vista do lado do processo. A coluna é anulável de propósito: as linhas anteriores não podem ganhar retroativamente uma versão que ninguém gravou, e «aceitou, versão desconhecida» é o estado real dessas — e o que uma revisão jurídica tem de poder ver | `src/db/schema/seccoes.ts` |
| D61 | As três respostas do passo de RGPD do registo de utilizador **não são do mesmo tipo**, e o esquema, o ecrã e o texto dizem-no: a informação sobre tratamento de dados é **tomada de conhecimento** (a base legal é o contrato e a obrigação legal — pedir consentimento onde ele não é a base produz um consentimento inválido e faz a pessoa acreditar que o pode retirar), o sigilo profissional é uma **declaração** obrigatória, e as comunicações internas são o único **consentimento** — e por isso o único que pode ficar por marcar sem travar o passo. Se as três fossem obrigatórias, a que é consentimento deixava de o ser: um consentimento que não se pode recusar não é livre | `src/features/convites/schemas.ts` |
| D62 | A API dos onboardings **não tem lógica própria**: cada rota chama exatamente a função que o ecrã chama, e o que acrescenta é transporte. É a única disciplina que impede o que sempre acontece a uma segunda porta para a mesma casa — a validação apertar de um lado e não do outro. Autenticação em duas camadas: o token do link mágico diz *qual* registo, a `API_CHAVE` diz *quem* chama; não são redundantes, porque um token de link vive num email e um email reencaminha-se, e há diferença entre ele abrir um formulário e abrir uma porta programática percorrida em segundos sem olhos humanos pelo meio. **Sem `API_CHAVE` a API responde 503 e não fica aberta** — um recuo permissivo seria a instalação que esqueceu a variável a servir dados de KYC a quem os peça. Não cria registos, não valida códigos OTP e não devolve dados pessoais preenchidos | `docs/API.md` |
| D63 | A conta de uma pessoa da equipa nasce **no último passo do registo dela**, e as três escritas (`user`, `account`, `utilizador`) são uma transação. Uma conta criada à cabeça é uma conta que entra na plataforma sem ninguém se ter identificado; e a meio das três escritas não há estado intermédio aceitável — um `user` sem `account` é uma conta sem palavra-passe a ocupar o email para sempre, um `account` sem `utilizador` é um login que passa e uma sessão que não resolve, e as duas dão a mesma coisa a quem lá está: um convite gasto e nenhuma maneira de entrar. As verificações dos cinco passos anteriores repetem-se dentro do `concluirConvite` e não só no ecrã, porque uma Server Action é chamável à mão | `src/features/convites/acoes.ts` |
| D64 | BUG-022 (migração `0025`): uma conta de acesso já existente, ao ser associada a uma segunda sociedade, reaproveita a credencial em vez de a substituir — regenerar a palavra-passe entregaria a alguém uma credencial que já usa e não pediu. A pessoa recebe um aviso ("foi adicionado como administrador de uma nova sociedade"), sem palavra-passe nenhuma no corpo | `src/features/plataforma/contas.ts` |
| D65 | Um bucket S3 por sociedade (`armazenamento_sociedade.bucket_s3`, coluna nula por omissão), nunca um bucket partilhado — o mesmo princípio do D32 (um único destino por sociedade, sem ambiguidade), estendido a um segundo tipo de destino. `criarDestino` decide pela coluna, não pelas credenciais decifradas: uma sociedade sem `bucket_s3` continua em SFTP sem tocar em nada. O driver assina SigV4 à mão (`node:crypto` + `fetch`) em vez de trazer `@aws-sdk/client-s3` — duas formas de pedido (PUT, HEAD) não pagam o peso da dependência no bundle, a mesma escolha que pôs o `curl` a falar SFTP em vez de uma biblioteca SSH. Este PR não migra nenhum documento existente — instrução direta do dono, verbatim na secção acima —, só prepara o código para a troca ser uma linha de configuração quando a migração acontecer, a semana seguinte | `src/lib/storage/s3.ts` |

## Open decisions

- **A16–A21 and A15** — in `docs/CAMPOS.md`. The most blocking is **A18**: there are no
  screenshots of the Company path, and half of what the brief describes (CAE codes, permanent
  certificate, VAT regime, RCBE, beneficial owners) should live there.
- **D0/A17** — duplicated fields in every screenshot. Assumed to be a bug in the current form.
- **A19** — beneficial owners and RCBE do not exist in the form. It is a legal obligation, not an
  optional feature. A legal decision before a technical one.
- **D4 of the inventory** — no IBAN and no payment terms at step 6. Confirm whether they are to be
  added.
- **7-year retention and purge** — design in `docs/SCHEMA.md`, needs legal validation.
- **Dependencies outside §1**: `uuidv7` (Postgres only has native `uuidv7()` in v18), `dotenv`,
  `tsx` and `server-only` (build utilities). `signature_pad` is no longer needed in the POC.
- **The audit `REVOKE` does not bite on Supabase by default**: the application user is also the
  table owner, and the owner bypasses the `REVOKE`. Only the `RULE`s protect. Creating an
  `app_user` role separate from the owner is the step that closes this when moving to production —
  migration `0002` already applies it if the role exists.
- **shadcn's `form` component**: it does not exist in the installed `radix-nova` preset. In
  Phase 2 a thin wrapper over React Hook Form is written instead of importing it.

## Commands

```bash
pnpm dev                  # development server
pnpm build                # must pass clean at the end of each phase
pnpm test                 # Vitest
pnpm test:e2e             # Playwright
pnpm db:generate          # drizzle-kit generate
pnpm db:migrate           # apply migrations
pnpm db:seed              # only with NODE_ENV=development
pnpm db:validar           # apply the migrations to a Postgres in WASM and verify them
pnpm auditoria:verificar  # revalidate the evento_auditoria hash chain
pnpm email:testar <destination>  # send a test email and record it in email_log
pnpm email:conferir       # confirm delivery of the messages left at «Aceite»
pnpm sociedade:convidar --nome "…" [--email …]  # open a firm's registration and print the link
pnpm utilizador:criar     # create a back-office account directly on the server (D23)
```

`pnpm email:testar` also runs inside the container (`node scripts/testar_email.mjs`), which is
where it matters: it shows whether `RESEND_API_KEY` reaches Node's environment, whether Resend
accepts the sender and whether the server has outbound access to `api.resend.com` — the three
causes of "the client received nothing", which from outside all sound the same. `--sem-bd` runs
the test without touching Postgres.

`pnpm email:conferir` also runs inside the container (`node scripts/conferir_entregas.mjs`).
It asks the provider for the outcome of the messages left at «Aceite» and closes their state.
It exists for the two cases the automatic polling (D51) does not catch: the container restarted
partway through, and the outcome arrived hours later. `--dias N` widens the window (7 by default)
and `--simular` shows what it would do without writing anything.

`pnpm sociedade:convidar` is how a firm enters the platform: it creates the `organizacao` row as
a shell — provisional name, tax number to be confirmed, reference prefix to be defined — plus the
`onboarding_sociedade` that gives it the magic link, and prints the link **once** (the database
keeps only the SHA-256, D4). A script on the server and not a public form, for the same reason as
D23: a system holding PEP declarations and identification documents does not have a door open to
creating organisations.

`pnpm db:validar` needs no server at all: it runs every migration on an ephemeral PGlite and
counts the tables (35, since `0016`), confirms the audit trail really does refuse UPDATE and
DELETE, and that search resolves accents and capitals. It is what guarantees the first
`db:migrate` against the production Postgres does not blow up.

## Conventions

- **Client-facing UI in European Portuguese** — form labels, placeholders, buttons, section
  titles, validation and error messages, confirmations, legal texts and the emails sent to the
  client all stay in Portuguese. The system is integrated with a Portuguese-language customer
  service bot; translating any of this would break that.
- **Code comments, documentation and server-side logs in Portuguese.** The rule used to say
  English; the codebase settled on Portuguese in practice from early on, and this now records
  what actually happens rather than what was originally planned. Domain identifiers stay in
  Portuguese (`processo_onboarding`, `nivel_risco`) because the database, the enums and the audit
  labels depend on them; technical terms in English where idiomatic.
- Commits in Portuguese, small, one per logical unit.
- TypeScript `strict: true`, zero `any`. A clean `pnpm build` is an acceptance criterion.
- Server Actions always revalidate with Zod on the server. Client-side validation is UX.
- Organised by domain in `src/features/`, not by file type.
- Any identifier in the UI (reference, tax number, IBAN, hash, audit timestamp) is rendered in
  `IBM Plex Mono`. A rule, not a suggestion.
- Secrets only in `.env`; `.env.example` documented and committed.
