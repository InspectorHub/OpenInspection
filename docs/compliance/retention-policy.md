# Retention policy — versions, and why each number is the number

The retention catalogue lives in code: `server/lib/compliance/retention-manifest.ts`
holds WHICH tables and WHAT action, `retention-windows.ts` holds HOW LONG and
why, and `retention-policy.ts` carries the version header and a digest of the
operative fields. `npm run lint:retention-policy` refuses a build where the
rules moved and the header did not — a window edited on its own, shipped, and
noticed by nobody is the case that gate exists to remove.

This file is the other half: every period has to be answerable with one page
saying why this number and not another, and a digest cannot say that.

> **Where this file lives.** The gate's failure message points at `[redacted]`,
> which is the private review archive in the parent repository. This is the
> open-source engine, so the record lives here beside
> [`destruction-evidence.md`](destruction-evidence.md). Nothing in this file is
> privileged; it states which periods apply and the public basis for each.

## Status

`interim`. No period here has been approved by review as final. `approvedBy`
and `approvedAt` in the header are null, and that is a fact about the policy
rather than a gap in the paperwork: an unapproved policy that says so is
honest, and one that says nothing reads as approved.

---

## 2026-08-17.3 — one table declared out of scope, and nothing deleted

**What changed.** `deployment_legal_versions` is declared `RETENTION_OUT_OF_SCOPE`.
The table is new in the same change: it holds the deployment's own legal documents
— the agent terms — which have no tenant, because an agent account is global and
its counterparty is whoever operates the deployment (review review).

**Why out of scope rather than a window.** The row is the ONLY copy of the text an
acceptance points at. `users.terms_accepted` stores a version and a content hash,
not the body, so deleting a row here does not shrink a record — it makes an
existing one unverifiable, and the signer can no longer be shown what they agreed
to. review review endorsed the version+hash design specifically because the
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

**Why the old name had to go.** External review, review, decision. What
the action does is overwrite identifier columns with a sentinel in a row that
survives. That is not CCPA deidentification — which carries substantive
conditions we do not meet — and it is not GDPR anonymisation either. Calling it
`anonymize` invited a future reader, or a future legal document, to cite the
label as evidence that we had produced legally deidentified data. It is the same
failure mode review named: an internal classification read downstream as an
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
final disposition of a qualifying judicial proceeding. External review rejected
it (review, decision): the Illinois period is five years **or** two years
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
disclosure would reasonably assume our number is required of them, so review
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
