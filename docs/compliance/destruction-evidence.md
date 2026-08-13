# Destruction evidence

What this deployment can produce when someone asks it to prove a workspace's
data was destroyed, how that evidence is created, and how long it is kept.

## The obligation

A deletion nobody can evidence is, to an auditor, a deletion that did not
happen. Four instruments say so in different words:

| Source | What it requires |
|---|---|
| **EU SCCs (2021/914), Clause 8.5** | On end of services the data importer deletes the personal data and **certifies** to the data exporter that it has done so. This is a contractual obligation, and it is the one that bites first — any customer on a DPA with SCCs can ask. |
| **GDPR Art. 5(2)** | The controller must be *able to demonstrate* compliance, not merely comply. |
| **GDPR Art. 28(3)(g)** | The processor deletes or returns personal data at end of services, **including existing copies** — which is why the record counts R2 objects and KV keys, not only database rows. |
| **SOC 2, Privacy criterion P4.3** | The entity disposes of personal information to meet its objectives. A Type II report samples disposal events across the period; a sampled event with no evidence is an exception in the report. |

ISO/IEC 27001:2022 A.8.10 (information deletion) and NIST SP 800-88 Rev. 1
(which templates a Certificate of Sanitization) are the usual supporting
citations. Nothing here is legal advice; counsel signs off on the posture, and
this document records what the system actually does so that sign-off is about
facts rather than intentions.

## What the evidence is

One row in `tenant_destruction_records` per purge. It is a **platform-level**
table: no foreign key to `tenants`, and explicitly excluded from
`tenantScopedTables()`, because the tenant row it names is deleted in the same
pass. A record that cascades with its subject is not a record.

It holds only non-personal aggregates — a tenant id snapshot, a slug, counts of
rows / R2 objects / R2 bytes / KV keys, and two timestamps. A destruction record
containing personal data would defeat the erasure it certifies.

## Two-phase, and why

The row is opened **before** the cascade with `status = 'started'`, and closed
**after** every step with the counts and `status = 'completed'`.

Written last — as it originally was — the record was lost by exactly the
failures worth recording. A crash between the cascade and the insert left a
workspace permanently destroyed with nothing on file saying so, and the only
trace was a `logger.error` on a platform whose logs are retained for days
against an audit window retained for years.

Letting that final write throw does not fix it. By the time it runs the data is
already gone, so failing there undoes nothing; it returns an error to a caller
who may retry, and the retry deletes nothing and files a record reading
`rowsDeleted: 0` — a **false certificate**, which is worse than a missing one.

Opening the record first inverts the failure mode:

- The opening insert is **not** guarded. Throwing there is correct and free:
  nothing has been destroyed yet, so refusing to begin a destruction we cannot
  evidence leaves the workspace exactly as it was.
- The closing update **is** best-effort. Everything is already destroyed, so
  throwing would report failure for work that succeeded. A row stuck at
  `'started'` understates what happened — the safe direction. It asks a human to
  look rather than certifying something false.

A row still at `'started'` therefore means one of two things, and both need a
person: the purge died partway, or it finished and could not say so. Neither may
be certified. `completed_at` is the field a Clause 8.5 certification is read off.

## Retention: 3 years

Destruction records are kept for **3 years** from `destroyed_at`.

GDPR sets no figure; the driver is how long someone can still ask. Three years
covers the ordinary contractual limitation period in which a former customer or
their counsel may request certification, and spans at least two annual SOC 2
audit periods, so any sampled purge remains evidenced for the report that covers
it and the one after.

The records are non-personal, so retaining them is not itself a processing risk
— which is why the number is set by when the evidence stops being *useful*
rather than by minimisation.

⚠️ **No sweep enforces this yet.** Nothing deletes destruction records at three
years; the number above is the stated policy and the specification for the sweep
that will implement it. Recorded here rather than left implicit, because a
retention period that exists only in someone's head is not a retention period.

## Who can read it

The reader is `readDestructionRecords` in
`server/lib/compliance/assurance-records.ts`. It is deliberately **not**
tenant-scoped: the workspace it describes no longer exists, so a query deriving
its tenant from a session could never reach the row. The filter is an argument,
and the audience is the platform operator over the portal M2M seam.

Being able to *produce* the record is the whole obligation. A certification
requirement is not met by a row nobody can retrieve.
