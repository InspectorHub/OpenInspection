# What the erasure PII heuristic can and cannot see

`scripts/check-erasure-manifest.mjs` is a CI gate. It walks every Drizzle
schema file, matches column names against a regex, and fails if a matching
column has neither a rule in `ERASURE_MANIFEST` nor a reasoned entry in
`ERASURE_OUT_OF_SCOPE`.

It is green today: `31 rules, 48 out-of-scope declarations`, exit 0.

This document exists because that sentence is easy to read as "erasure covers
the schema", and it does not mean that. It means no column *whose name the
gate was told to look for* is unruled. Everything else is invisible to it, and
invisible reads exactly like correct.

That misreading is the reason portal #88 was filed. This page is here so it is
not the reason for the next one.

---

## The mechanism, exactly

```js
// scripts/check-erasure-manifest.mjs:52
const PII_HEURISTIC = /(email|phone|ip_address|user_agent|signature|client_name|full_name|recipient)/;
const isPiiColumn = (col) => PII_HEURISTIC.test(col) || col === "ip";
```

Eight substrings and one exact match. That is the entire model of "this column
might hold personal data".

The gate is honest about what it does — it never claims to find PII, only to
find *unruled columns whose names look like PII*. The gap is between what it
does and what a green run gets read as.

---

## The worked example: `inspections.property_address`

`address` is not in the regex.

Follow that one omission:

- `inspections.property_address` is `text('property_address').notNull()`
  (`server/lib/db/schema/inspection/core.ts:13`), with nine geocoded siblings
  beneath it (`:15`-`:24`: place id, street, city, state, zip, county, lat,
  lng, geocoded-at). For a residential inspection ordered by the buyer or the
  homeowner, that is a person's home address, held against a named client
  through `inspection_people`.
- The gate never asks about it, because the name does not match.
- `inspections` therefore has **zero** entries in the manifest: no column rule
  (`grep "table: 'inspections'"` in `server/lib/compliance/` returns nothing),
  no out-of-scope entry, and no row rule.
- `runErasure` has fourteen hand-written per-table steps
  (`server/lib/compliance/erasure-orchestrator.ts:232`, `:250`, `:270`,
  `:276`, `:310`, `:324`, `:336`, `:345`, `:354`, `:372`, `:392`, `:417`,
  `:433`, `:445`). None of them is `inspections`.
- Two tables away, `reports.title` **is** declared — `category: 'user.address'`,
  `action: 'anonymize'`, `legalBasis: 'art_17_3_e'`, `retention: 'P6Y'`
  (`erasure-manifest.ts:168`) — and executed, overwritten with
  `'Inspection Report (details removed)'` (`erasure-orchestrator.ts:68`,
  step at `:372`).

So a consumer erasure today clears the report title and leaves the address.

### The failure mode is not an under-report

If the gate merely missed a column, the cost would be a smaller number in a
coverage report. The actual cost is different and worse.

`runErasure` sets `status: 'completed'` whenever no step threw
(`erasure-orchestrator.ts:453`) and writes that status into the append-only
`erasure_log` row (`:461`). Nothing in that path can know about a table it was
never told to visit, so the absence of `inspections` produces no warning, no
partial status, and no decision entry. The only caller
(`server/services/admin.service.ts:227`) spreads that summary straight through
to whatever operator surface invoked it, so a DSAR console records a completed
erasure over a record that still holds the subject's home address — and the
accountability log now says so in writing.

A silent gap and a gap recorded as "completed" are not the same defect. The
second one manufactures evidence that the first one was handled.

### One correction while we are here

The manifest's own comment above the `reports.title` rule
(`erasure-manifest.ts:162`-`:167`) says `title` is "the one free-text column a
human writes" and "routinely carries the address (`123 Oak St — Radon`)".
That is not true of the current code. There is no API that edits
`reports.title`; it is written machine-side, either as the literal
`'Inspection Report'` (`server/lib/inspection/reports.ts:96`) or as the
service line's `nameSnapshot` (`server/lib/inspection/report-generation.ts:123`,
written at `:158` and `:177`) — a string out of the tenant's own service
catalogue.

Which sharpens the example rather than softening it. The column the manifest
anonymises under an Art. 17(3)(e) legal basis currently holds a tenant
catalogue name. The column holding the client's home address holds no rule at
all. The rule that got written is the one whose *justification* someone
imagined; the one that was needed is the one nobody was prompted to think
about.

---

## Categories structurally out of reach

Not "not covered yet" — out of reach of *any* name-matching gate. For each,
what compensates.

### 1. Free prose in a column whose name does not announce prose

`data`, `payload`, `meta`, `details`, `body`, `snapshot`. A person typed into
it; the name does not say so.

**Compensator:** a manifest rule, when a human thinks of it. `audit_logs.metadata`
is the case where one did — rule at `erasure-manifest.ts:181`, plus write-time
stripping of machine-detectable identifiers in the audit writer, plus a
wholesale scrub on erasure because prose is not detectable at all and historical
rows predate the redactor. That is three mechanisms for one column, and none of
them was prompted by the gate.

### 2. Addresses, and location generally

Covered above. `street`, `city`, `zip`, `lat`, `lng`, `place_id` — none match.

**Compensator: none.** See "Open and unowned" below.

### 3. Sensitivity that is contextual rather than lexical

A column can be innocuous in isolation and personal in combination.
`inspections.date` is a date. `inspections.date` joined to a property address
and a named client is a record of where a specific person was living on a
specific day. No lexical test reaches that, because the sensitivity is not in
either column — it is in the join.

**Compensator: none mechanical.** Only a human reading the schema as a whole,
which is what an out-of-scope entry with a real reason forces someone to do
once.

### 4. PII inside a JSON blob

The gate reads column *names* out of the schema source. It never reads a row.
A JSON TEXT column holding `{"clientName": "..."}` is one column called
`payload` as far as the gate is concerned.

**Compensator:** per-column, by hand. `audit_logs.metadata` again; nothing
generic.

### 5. Row-level semantics

The gate is per-column. It cannot see that an entire row is a record about a
person, or that a column is a locator rather than content.

**Compensator:** the manifest's row-delete convention — `action: 'delete'`
with the `column` naming the locator, documented at `erasure-manifest.ts:47`-`:54`
— plus explicit out-of-scope entries for columns that ride along, e.g.
`contacts.phone`, "rides with the contacts row delete (locator = email)"
(`:207`). This one works, because the convention is written down where the
rules are.

### 6. A rule that exists but never runs

The inverse failure. `runErasure` is a hand-written sequence, not a manifest
interpreter, so a rule can be added and simply never executed. The gate is
green either way: it validates the manifest against the *schema*, never
against the executor.

**Compensator:** `tests/unit/privacy/erasure-manifest-coverage.spec.ts`, a
drift guard that fails when a rule has no orchestrator wiring. This is the one
blind spot with a real mechanical answer.

### 7. False positives

`automations.recipient_kind` matches `recipient` and is an enum.
`comment_usage.comment_id` would match a widened pattern and is a foreign key.

**Compensator:** an out-of-scope entry saying so. This is the gate working
correctly — the cost of a name-based test is that it over-matches, and paying
that cost in written reasons is the intended trade.

---

## The behaviour to copy

`users.service_origin_address` is declared out of scope
(`erasure-manifest.ts:221`) with the reason "staff routing origin (may be a
home address) — staff offboarding lifecycle, not consumer-DSAR scope", and the
comment above it says explicitly that it is "declared here so the decision is
recorded rather than inferred from the PII heuristic not matching
`service_origin_address`".

The gate never asked. Nothing would have gone red. Somebody wrote the entry
anyway, and it is correct: an inspector's routing origin genuinely can be a
home address, so it is personal data — it is simply not a *consumer* data
subject's, which is a decision, not an oversight.

Several other entries do the same thing and say so in the same words — the
`reports` column sweep (`:252`-`:262`), the payment ledger (`:273`-`:278`),
`tenant_legal_versions` (`:279`-`:280`), the pay-split rows (`:286`-`:291`),
and `parked_cmd_events` (`:295`-`:298`), which notes that "silence here is
exactly how this one hid: `envelope` and `reason` look like nothing".

**That is the discipline the heuristic cannot produce.** Ruling on a column
the gate did not flag is the only thing that closes the categories above, and
it depends entirely on somebody deciding to do it.

The practical rule when adding a table: do not ask "will the gate pass". Ask
"what does a column the gate says nothing about look like" — and then write
the entry for each one.

---

## Open and unowned

The address gap described above is **not fixed, and nobody owns it.** This
document makes it legible; it does not close it.

Two reasons it is left open deliberately rather than patched here:

1. **It is a compliance decision, not an engineering one.** Mirroring the
   `reports.title` treatment — anonymise with an Art. 17(3)(e) basis and a
   bounded retention period — is the obvious call, and it changes what erasure
   does to production data on every future request. A property address may be
   personal data of the client where it is linked to the client relationship,
   and it may also be the thing a professional record has to keep in order to
   identify which property a report describes. Which of those wins, and for
   how long, is a question for a human with authority to answer it.

2. **Widening the regex is not a neutral first step.** Adding `address` to
   `PII_HEURISTIC` today turns the gate red on **twelve** columns, measured
   2026-08-07:

   ```
   inspections.property_address        inspections.address_county
   inspections.address_place_id        inspections.address_lat
   inspections.address_street          inspections.address_lng
   inspections.address_city            inspections.address_geocoded_at
   inspections.address_state           inspection_requests.property_address
   inspections.address_zip             tenant_configs.company_address
   ```

   A red gate on twelve columns invites the cheapest way back to green, which
   is twelve out-of-scope entries. An out-of-scope entry without a real reason
   is worse than a missing rule: it converts an open question into a recorded
   decision nobody will revisit. Widening the pattern is the *last* step, once
   the ruling exists — not the first.

Not all twelve are the same question. `tenant_configs.company_address` is the
controller's own business address and mirrors the `company_lat`/`company_lng`
entries already at `erasure-manifest.ts:233`-`:234`.
`inspection_requests.property_address` sits on a table whose identity columns
already carry rules (`:135`-`:137`), so it is the odd one out on a table that
was otherwise ruled on. The `inspections` family is the substantive one.

Until that decision is made, read the gate's green output as it is written:
*no column whose name suggests PII is unruled*. Not *no PII is unruled*.
