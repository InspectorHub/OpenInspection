# What the erasure PII heuristic can and cannot see

`scripts/check-erasure-manifest.mjs` is a CI gate. It walks every Drizzle
schema file, matches column names against a regex, and fails if a matching
column has neither a rule in `ERASURE_MANIFEST` (`erasure-manifest.ts`) nor a
reasoned entry in `ERASURE_OUT_OF_SCOPE` (`erasure-out-of-scope.ts`, split out
when the manifest hit its line cap). The gate concatenates both sources before
parsing either, so the split cannot halve what it sees.

It is green, and prints its two counts side by side when it runs — the rules it
holds and the columns explicitly ruled out of scope. Those numbers are not
quoted here: this document was written when they were `44 rules, 57 out-of-scope
declarations`, and by the time anyone read that sentence they had roughly
doubled. Run `npm run lint:erasure` for the current pair.

This document exists because that sentence is easy to read as "erasure covers
the schema", and it does not mean that. It means no column *whose name the
gate was told to look for* is unruled. Everything else is invisible to it, and
invisible reads exactly like correct.

That misreading has already produced one filed gap: a column holding personal
data under a name the heuristic does not match was read as covered, because the
gate was green. This page is here so it is not the reason for the next one.

---

## The mechanism, exactly

```js
const PII_HEURISTIC = /(email|phone|ip_address|user_agent|signature|client_name|full_name|recipient|address)/;
const isPiiColumn = (col) => PII_HEURISTIC.test(col) || col === "ip";
```

Nine substrings and one exact match. That is the entire model of "this column
might hold personal data".

The gate is honest about what it does — it never claims to find PII, only to
find *unruled columns whose names look like PII*. The gap is between what it
does and what a green run gets read as.

---

## The worked example: `inspections.property_address` — closed

**This example is now resolved.** It is kept because how it hid is the general
lesson, and because the shape of the fix is the behaviour to copy.

`address` was not in the regex. Follow that one omission as it stood:

- `inspections.property_address` is `text('property_address').notNull()`
  (`server/lib/db/schema/inspection/core.ts`), with nine geocoded siblings
  beneath it (place id, street, city, state, zip, county, lat, lng,
  geocoded-at). For a residential inspection ordered by the buyer or the
  homeowner, that is a person's home address, held against a named client
  through `inspection_people`.
- The gate never asked about it, because the name did not match.
- `inspections` therefore had **zero** entries in the manifest: no column rule,
  no out-of-scope entry, no row rule.
- Two tables away, `reports.title` **was** declared — `category: 'user.address'`,
  `action: 'anonymize'`, `legalBasis: 'art_17_3_e'`, `retention: 'P6Y'` — and
  executed, overwritten with `'Inspection Report (details removed)'`.

So a consumer erasure cleared the report title and left the address, and
nothing anywhere said so.

### The failure mode was not an under-report

If the gate merely missed a column, the cost would be a smaller number in a
coverage report. The actual cost was different and worse.

`runErasure` sets `status: 'completed'` whenever no step threw, and writes that
status into the append-only `erasure_log` row. Nothing in that path can know
about a table it was never told to visit, so the absence of `inspections`
produced no warning, no partial status, and no decision entry. The only caller
(`server/services/admin.service.ts`) spreads that summary straight through to
whatever operator surface invoked it, so a DSAR console recorded a completed
erasure over a record that still held the subject's home address — and the
accountability log said so in writing.

A silent gap and a gap recorded as "completed" are not the same defect. The
second one manufactures evidence that the first one was handled.

### How it was closed

The address family now carries `action: 'retain'` rules with
`legalBasis: 'art_17_3_e'` and a `retention: 'P6Y'` hint — one entry per column,
in `ERASURE_MANIFEST`. Declaring the family out of scope as "property data" was
the other option and was rejected: it was the cheapest way back to green, and a
red gate would have pushed a hurried reader straight at it.

Two things about that fix are easy to misread, so both are stated at the rules
themselves:

1. **The window is not a new number.** It is the tenant's existing
   `tenant_configs.agreement_retention_years` (default 6). A second per-tenant
   retention column would be two clocks answering the same question and drifting.
2. **Nothing enforces the window yet.** `retention-sweep.ts` reaches
   `agreement_requests` and `agreement_signers` only. Until it learns about
   `inspections`, a `retain` rule here is a recorded decision that no code acts
   on — and a retain nothing ever expires is the rejected exclusion under a
   different name.

   Three mechanisms hold that open rather than letting it settle:

   - Every one of those rules carries `enforcementStatus: 'pending'`, so the
     manifest — and anything rendering from it — states that the *decision* is
     recorded while the *expiry* is not built. A `retain` that reads as
     implemented is the failure mode.
   - Every one carries `enforcementDeadline: '2027-02-01'`, and **the gate fails
     once that date passes.** A deadline that cannot act is how "pending"
     becomes permanent. The date is two quarters, set by review discipline: the
     sweep needs a purge marker on `inspections` (the agreement pass keys on
     `signedAt` + `purged_at IS NULL`; there is no equivalent here) and a
     decision about which column starts an inspection's clock — a schema change
     and a migration, not a patch. It is deliberately *not* derived from when
     the first address falls due, which is not computable until that clock
     column exists.
   - `PENDING_ENFORCEMENT` in the gate is a checked-in list of the rules allowed
     to be pending. A new one fails; so does a stale entry whose rule is gone.
     For a bounded `retain`, the default is refusal — a rule that declares a
     `retention` and no `enforcementStatus` fails, so "unenforced" cannot be the
     thing that happens when nobody says anything.

   A tripwire in `tests/unit/privacy/erasure-manifest-coverage.spec.ts` also
   fails the day the sweep gains an `inspections` reference, so the "not yet
   enforced" notice cannot quietly become false in the other direction either.

One more thing worth knowing before reading a retain rule as an audit artefact:
a `retain` produces **no per-run entry** in `erasure_log`. The orchestrator's
`step()` records actions it executed, and a retain executes nothing; that is
true of all six retain rules that predate this one. The manifest, with its
stated basis and period, is the record of the decision. The run log is the
record of the writes.

### One correction carried over from when this was open

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

`address` is in the pattern now, so `property_address`, `address_street`,
`address_city` and their siblings are reached. `street`, `city`, `zip`, `lat`,
`lng`, `place_id` as bare names still are not — `company_lat` and
`service_origin_lat` are declared because somebody wrote them down, not because
anything asked.

**Compensator: partial.** The pattern catches the `address_`-prefixed family
this codebase happens to use. A coordinate or locality column named without
that prefix is invisible again.

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
`contacts.phone`, "rides with the contacts row delete (locator = email)". This
one works, because the convention is written down where the rules are.

### 6. A rule that exists but never runs

The inverse failure. `runErasure` is a hand-written sequence, not a manifest
interpreter, so a rule can be added and simply never executed. The gate is
green either way: it validates the manifest against the *schema*, never
against the executor.

**Compensator:** `tests/unit/privacy/erasure-manifest-coverage.spec.ts`, a
drift guard that fails when a rule has no orchestrator wiring. This is the one
blind spot with a real mechanical answer.

It scans more than the orchestrator file — `anonymize-pii.ts` holds the shared
column SETs, and `erase-repair-requests.ts` is a step the orchestrator
delegates because it had run out of line budget. Widening what a guard reads is
how a guard gets weaker, so a companion assertion checks that the orchestrator
still *calls* the delegated step. Without it, a rule whose executor had been
unhooked would satisfy the scan while running nothing — the same failure this
section is about, with the drift guard helping it hide.

Note also what the guard does **not** cover: `retain` rules. They are exempt by
construction, because a retain executes nothing there is anything to bind to.
Whether a retain is honoured is a question about the retention sweep, not the
orchestrator, and today the sweep only reaches the agreement tables.

### 7. False positives

`automations.recipient_kind` matches `recipient` and is an enum.
`comment_usage.comment_id` would match a widened pattern and is a foreign key.

**Compensator:** an out-of-scope entry saying so. This is the gate working
correctly — the cost of a name-based test is that it over-matches, and paying
that cost in written reasons is the intended trade.

---

## The behaviour to copy

`users.service_origin_address` is declared out of scope in
`ERASURE_OUT_OF_SCOPE` with the reason "staff routing origin (may be a
home address) — staff offboarding lifecycle, not consumer-DSAR scope", and the
comment above it says explicitly that it is "declared here so the decision is
recorded rather than inferred from the PII heuristic not matching
`service_origin_address`".

The gate never asked. Nothing would have gone red. Somebody wrote the entry
anyway, and it is correct: an inspector's routing origin genuinely can be a
home address, so it is personal data — it is simply not a *consumer* data
subject's, which is a decision, not an oversight.

Several other entries do the same thing and say so in the same words — the
`reports` column sweep, the `order_payments` ledger, `tenant_legal_versions`,
the `inspection_service_pay_splits` rows, the `repair_request_items` report
snapshots, and `parked_cmd_events`, which notes that "silence here is exactly
how this one hid: `envelope` and `reason` look like nothing".

(Line numbers are deliberately absent here. The earlier drafts of this page
carried them and every one went stale the first time a rule was added above.)

**That is the discipline the heuristic cannot produce.** Deciding on a column
the gate did not flag is the only thing that closes the categories above, and
it depends entirely on somebody deciding to do it.

The practical rule when adding a table: do not ask "will the gate pass". Ask
"what does a column the gate says nothing about look like" — and then write
the entry for each one.

---

## The order the address family was closed in, and why it matters

Widening the regex is not a neutral first step, and doing it last is the part
worth copying.

Adding `address` to `PII_HEURISTIC` turns the gate red on **twelve** columns
(measured 2026-08-07, before the decision existed):

```
inspections.property_address        inspections.address_county
inspections.address_place_id        inspections.address_lat
inspections.address_street          inspections.address_lng
inspections.address_city            inspections.address_geocoded_at
inspections.address_state           inspection_requests.property_address
inspections.address_zip             tenant_configs.company_address
```

A red gate on twelve columns invites the cheapest way back to green, which is
twelve out-of-scope entries. An out-of-scope entry without a real reason is
worse than a missing rule: it converts an open question into a recorded
decision nobody will revisit. So the decision came first and the widening came
second, in the same commit as the twelve declarations — a widening that lands
without them turns the gate red for everyone else in flight.

Not all twelve were the same question, and they did not get the same answer:

- **Ten are retained** — the nine `inspections` address columns and
  `inspection_requests.property_address`. On a residential inspection this is
  where a person lives, and the booking request the inspection converted from
  has already had its name, email and phone cleared in place, which left the
  address as the last part of that record standing. Same question, same answer.
- **`tenant_configs.company_address` is out of scope.** It is a business's own
  published location — the controller's identity, not a data subject's — so it
  follows the `company_lat` / `company_lng` entries beside it, not the
  `inspections` rules. It looks identical to a name-matching gate and is not the
  same question, which is the whole reason a gate cannot make this call.
- **`inspections.address_geocoded_at` is out of scope.** It records when the
  geocode ran, not where the property is.

Read the gate's green output as it is written: *no column whose name suggests
PII is unruled*. Not *no PII is unruled*.

## Still open

The retention **window is declared but not enforced**, deadline **2027-02-01** —
see "How it was closed" above. Nothing expires an inspection address today. That
is the live gap; it is marked on every affected rule, dated, held by a
checked-in list, and the gate turns red if the date passes without the sweep.

The blockers are a purge marker on `inspections` and a decision about which
column starts its retention clock. Both are schema work.

## What this file's prose is worth

On 2026-08-07 two justifications in the manifest were checked against the code
and found false — `reports.title` ("the one free-text column a human writes";
it is machine-written) and `repair_requests.created_by_ref` (documented as an
opaque id; it stores an email address, and a compliance classification was
resting on that). Both rules had survived review because the reasoning read
well.

The general form is worth more than either instance: **the manifest may be
assumption-driven rather than data-driven.** A rule can be correct and still
unprovable, because nobody checked the premise its comment asserts. Before
relying on a paragraph in that file, read what writes the column.
