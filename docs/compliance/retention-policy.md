# Retention policy — versions, and why each number is the number

The retention catalogue lives in code: `server/lib/compliance/retention-manifest.ts`
holds WHICH tables and WHAT action, `retention-windows.ts` holds HOW LONG and
why, and `retention-policy.ts` carries the version header and a digest of the
operative fields. `npm run lint:retention-policy` refuses a build where the
rules moved and the header did not — a window edited on its own, shipped, and
noticed by nobody is the case that gate exists to remove.

This file is the other half: every period has to be answerable with one page
saying why this number and not another, and a digest cannot say that.

> **Where this file lives.** The gate's failure message points at `docs/legal/`,
> which is the private counsel archive in the parent repository. This is the
> open-source engine, so the record lives here beside
> [`destruction-evidence.md`](destruction-evidence.md). Nothing in this file is
> privileged; it states which periods apply and the public basis for each.

## Status

`interim`. No period here has been approved by counsel as final. `approvedBy`
and `approvedAt` in the header are null, and that is a fact about the policy
rather than a gap in the paperwork: an unapproved policy that says so is
honest, and one that says nothing reads as approved.

---

## 2026-08-19.1 — counsel ruled, and it is APPROVED WITH CONDITIONS

**What changed.** Round 33 reviewed all 15 rules: 8 approved as written, 4 windows
changed, 2 tables removed from the fixed sweep entirely.

| Rule | Was | Now | Why |
|---|---|---|---|
| `audit_logs` | 24m | **36m** | Two years creates an evidence discontinuity: the report survives, the acceptance survives, and the proof of who did what to them is gone |
| `report_versions` | 36m | **84m** | Hash-chained snapshots are part of the report's evidence chain. Seven years of PDF backed by three years of provenance is not a coherent horizon |
| `tenant_marketplace_import_history` | 36m | **12m** | Operational history. Three years needs a purpose this table does not have |
| `tenant_slug_history` | 36m | **12m** | The purpose is stopping a retired slug being reissued; that risk does not run three years. Disputes are legal hold's job |
| `sms_disclosure_versions` | 36m | **removed from sweep** | See below |
| `tenant_legal_versions` | 36m | **removed from sweep** | See below |

**The defect we reported, and the half of it that was not real.** We told counsel
that a consent record could outlive the text it names, and asked for both tables to
leave the sweep. Counsel agreed and generalised it into a rule. Then implementing it
meant reading the executors, and they did not say what the manifest said:

- `sms_disclosure_versions` **was already reference-preserving**. Its executor
  deletes only a version that is superseded AND cited by no `sms_consent_log` row,
  and it keeps the current version. Our report was wrong about this table. We had
  read the manifest — a table and a number — and not the executor, which is what
  the number actually does.
- `tenant_legal_versions` **was genuinely exposed**, and became so in this same
  session: its executor checks only that a newer version exists, which was correct
  until `account_acceptances` arrived — a ledger that is never swept and that
  stores the version and content hash of the text a person was shown.

So the rule stands and the framing was half wrong. Both tables stay IN the sweep
with reference-preserving executors, rather than being removed from it — counsel
was explicit that the ruling is retain-while-referenced, not keep-forever: *"这并不
意味着所有 SMS disclosure versions 永久保存"*. Removing them would have let rows
accumulate indefinitely, which is not what was asked for. The missing
`notExists(account_acceptances)` check is now in the tenant executor, so both tables
implement the same rule.

**Why this version is `approved_with_conditions` and not `approved`.** Counsel
asked for that distinction in terms: *"我建议把 Round 33 标成 APPROVED WITH
CONDITIONS，而不是 APPROVED"*. Three of the five conditions are unmet — the
dependency-aware sweep, the `legal_hold` override (**zero occurrences in the
codebase**), and the customer ToS re-accept change summary. A reader who sees
`approved` stops asking what is left.

**And a scope limit that belongs here rather than in a plan.** This covers
DATABASE retention only. Object storage, Durable Objects, KV and queues were never
in the compliance register (round 20). A green retention gate does not mean the
data lifecycle has been reviewed.

## 2026-08-18.1 — the acceptance ledger declared out of scope, and nothing deleted

**What changed.** `account_acceptances` is declared `RETENTION_OUT_OF_SCOPE`. The
table is new: one row per document a staff member accepted, written in the same
`db.batch()` as the `users` row it belongs to.

**Why out of scope rather than a window.** Expiring a row here does not shrink a
record — it destroys one, and it destroys it in a specific direction. The account
survives; the proof that its holder accepted anything does not. That is the state
`account = EXISTS, acceptance_ledger = ABSENT` which counsel round 24 ruling 24D
refused, and which this table was created to make unreachable. A retention sweep
would reach it deliberately, on a timer, for every account old enough — the one
mechanism guaranteed to produce it.

**The clock this row already has.** Its natural lifetime is the ACCOUNT's, not the
calendar's: it should die when the `users` row it belongs to does. That happens on
the tenant purge and in the staff offboarding lifecycle, and both already destroy
it. Adding a second, shorter clock would not bound anything that is not already
bounded; it would only guarantee that some accounts outlive their own evidence.

**Volume.** Growth is bounded by accounts × published document versions, not by
usage — an account accepts each version once, and the unique index on
`(user, doc, version)` is what makes that true rather than conventional.

**Declared although nothing went red.** `LEDGER_NAME` in
`scripts/check-retention-manifest.mjs` matches no part of `account_acceptances`,
so this table could have shipped with `lint:retention` green. That is the same
silence that let `tenant_destruction_records` go a year without a decision, and
the reason the entry exists is that somebody read the table, not that a gate
asked.

**What did not change.** No period, no table in `RETENTION_MANIFEST`, no anchor
column, no `decideBy` date, and nothing new is deleted or erased anywhere. The
digest moved because the gate hashes the exclusion list too.

## 2026-08-17.3 — one table declared out of scope, and nothing deleted

**What changed.** `deployment_legal_versions` is declared `RETENTION_OUT_OF_SCOPE`.
The table is new in the same change: it holds the deployment's own legal documents
— the agent terms — which have no tenant, because an agent account is global and
its counterparty is whoever operates the deployment (counsel round 29).

**Why out of scope rather than a window.** The row is the ONLY copy of the text an
acceptance points at. `users.terms_accepted` stores a version and a content hash,
not the body, so deleting a row here does not shrink a record — it makes an
existing one unverifiable, and the signer can no longer be shown what they agreed
to. Counsel round 29 endorsed the version+hash design specifically because the
accepted version can be reconstructed later, and a sweep over this table is the one
thing that would make that claim false.

The usual argument for a window does not apply either: the table grows with
PUBLICATIONS, not with usage — a handful of rows over the life of a deployment.

**What did not change.** No period, no table, no anchor column, no `decideBy` date,
and nothing new is deleted or erased anywhere. The digest moved because the gate
hashes the exclusion list too, which is the point: adding a table that production
will never sweep is a decision, and it should not be possible to make it silently.

**Not `tenant_legal_versions`' rule, deliberately.** That table's rule deletes a
version once a NEWER one exists for the same `(tenant, doc)`. Copying it here would
delete exactly the superseded bodies that older acceptances still name.

## 2026-08-17.2 — a rename, and nothing else

**What changed.** One word. The retention action formerly written `anonymize` is
now written `erase_in_place`, in this catalogue and in the erasure manifest that
shares the verb.

**What did not change.** No period. No table. No anchor column. No exclusion, no
open question, no `decideBy` date. Every row still expires exactly when it did
before this version, and the executor still performs exactly the same SQL. The
digest moved because the action string is one of the operative fields it hashes —
which is the gate working as designed: it cannot tell a rename from a
re-decision, so it refuses both until a human says which one this is. This one is
a rename.

**Why the old name had to go.** External counsel, round 27, ruling CA-08. What
the action does is overwrite identifier columns with a sentinel in a row that
survives. That is not CCPA deidentification — which carries substantive
conditions we do not meet — and it is not GDPR anonymisation either. Calling it
`anonymize` invited a future reader, or a future legal document, to cite the
label as evidence that we had produced legally deidentified data. It is the same
failure mode round 16 named: an internal classification read downstream as an
established fact. `erase_in_place` describes the operation and asserts nothing
about its legal effect.

**Also renamed in the same change**, for the same reason and recorded here
because it is the other half of one decision: the erasure manifest's data
category `user.biometric.signature` became `user.signature.rendered_image`, and
the rule carries `biometricStatus: 'not_assessed_as_biometric'`. Not
`biometric: false` — a boolean answer is itself a legal conclusion, which is the
mistake being fixed. That category is not an operative field of this policy and
does not affect the digest.

---

## 2026-08-17.1 — report PDFs get a window

**What changed.** `report_pdfs` gained a retention rule. It had none: the
tenant purge destroys these objects when a workspace is destroyed, but nothing
expired one while the tenant lived, so a rendered PDF of a property — the
address, the photographs, the defects found there — was kept for as long as the
company existed with no decision behind it.

**The period.** Seven years by default, and each tenant may set their own in
Settings → Compliance. Zero means indefinite.

**Why seven, and what seven is NOT.** This is a **platform-selected default for
the tenant-silent case**. It is not a statutory retention period, and not a
representation that seven years is the maximum legally required period.

That distinction is the whole reason this entry exists. An earlier derivation in
this repository read seven as "five plus two" — five years from Illinois for
home-inspection contracts, reports and supporting data, plus two years past
final disposition of a qualifying judicial proceeding. External counsel rejected
it (round 24, ruling 24A): the Illinois period is five years **or** two years
past final disposition, **whichever is longer**, so the second figure is an
event-dependent tail rather than a fixed cap. A proceeding ending in year six
extends the statutory period past seven. Seven years therefore cannot be
presented as "the longest statutory period", and a register row reading
`P7Y — legal basis = Illinois law` would invite the next reader to conclude that
a California tenant is legally required to keep seven years.

The default is informed **primarily by defence of legal claims** and
**secondarily by regulatory record retention**. The jurisdiction facts behind it,
each with the date it was checked, are in
`server/lib/compliance/report-pdf-retention.ts` — including that Washington
completed a home-inspector rules revision in July 2026, which is why every fact
carries an as-of date rather than a bare citation.

**Tenant override is not absolute.** The effective period is
`jurisdictional minimum + tenant instruction + platform constraints`, never
`tenant choice > law`. Indefinite retention is a tenant OPTION, not a tenant
entitlement, and seven years is a default rather than a ceiling. The resolver in
code answers only the middle term — what the tenant asked for, or the default
when they have not asked. A jurisdictional floor, once one can be determined per
tenant, is applied above it and deliberately not folded in: one function
silently responsible for a legal determination it has no facts for is how a
wrong answer gets an authoritative shape.

**Why the disclosure sits next to the control.** The dominant competitor stores
reports indefinitely, including after cancellation. A customer who never opens a
disclosure would reasonably assume our number is required of them, so counsel's
wording renders plainly beside the field rather than behind a disclosure control
or on a policy page.

**Mechanically.** This is the first rule that reaches outside D1. The row points
at an R2 object, so the executor deletes the object first and the row second,
and **refuses to run at all without a bucket** rather than deleting rows that
point at objects nothing else could ever reach — the row is the only thing that
knows the key.

---

## 2026-08-15.1 — the catalogue's first versioned state

The state the versioning began from: fourteen rules, seven declared
out-of-scope with reasons, and two parked as open questions with dates by which
they must be answered. See `retention-manifest.ts` for each, and
`retention-windows.ts` for the reasoning behind every period.
