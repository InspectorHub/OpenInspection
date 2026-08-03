# Multilingual demand signal

`contacts.locale` exists to answer one question: **do clients actually ask to be
addressed in another language, and how often?** Everything else the column
enables — notification rendering, report courtesy translation — is only worth
building if the answer is yes. So the column has to be readable as a number, by
someone who was not there when it was added.

This note is that number's definition. It is written *before* there is data, on
purpose: a threshold picked after seeing the result is not a threshold.

## What a value means

`locale` is nullable and BCP-47, reduced to a language the message catalogue
actually covers (`server/lib/i18n/contact-locale.ts`).

- **A stored value is a choice.** Nothing is pre-selected on the booking form,
  so even a stored `en` means somebody was asked and answered "English".
- **NULL is an absence, not English.** It never means "prefers English"; it
  means no preference was recorded, for any of several reasons — see
  [What the number cannot see](#what-the-number-cannot-see).

That asymmetry is the whole reason the signal works, and it is also the reason
`(not stated)` must never be folded into the English bucket when the number is
quoted.

## The decision rule

Fixed in advance, so the data cannot move it:

> **If fewer than ~2% of live client contacts have stated a non-English
> preference after two full months of collection, report courtesy-translation
> work is not justified.**

The denominator is **all live client contacts**, not just the ones who answered.
That makes the test deliberately one-sided:

- Crossing 2% is **sufficient** evidence of demand — the never-asked rows only
  dilute the ratio, so a number that clears the bar clears it despite them.
- Failing to cross 2% is **not** proof of absence while the answer rate
  (query B) is low. It means either there is no demand or nobody was asked, and
  those two are not distinguishable from this column alone.

Say which of the two you are looking at when you report the result.

## The queries

Run all four together. Query A on its own is a percentage with no error bar,
which is worse than no number at all.

### A. Composition — what was stated

```sql
-- Query A — multilingual demand signal, by stated language. Run monthly.
-- Undercount: only clients who booked themselves are ever asked this
-- question; agent-placed bookings store no language at all and land in
-- '(not stated)'. See docs/developers/multilingual-demand-signal.md.
SELECT COALESCE(locale, '(not stated)') AS stated_language,
       COUNT(*)                         AS contacts
FROM contacts
WHERE archived_at IS NULL
  AND type = 'client'
GROUP BY 1
ORDER BY contacts DESC;
```

### B. Answer rate — how much of the book was ever asked

```sql
-- Query B — how much of the client book has an answer at all.
-- Undercount: agent-placed bookings never offer the question, so a low
-- `stated` here is partly a collection gap, not only a preference for English.
SELECT COUNT(*)                                                        AS live_clients,
       SUM(CASE WHEN locale IS NOT NULL THEN 1 ELSE 0 END)             AS stated,
       SUM(CASE WHEN locale IS NOT NULL AND locale NOT LIKE 'en%'
                THEN 1 ELSE 0 END)                                     AS stated_non_english
FROM contacts
WHERE archived_at IS NULL
  AND type = 'client';
```

`stated_non_english / live_clients` is the ratio the decision rule tests.
`stated / live_clients` is how much you should trust it.

### C. The blind spot, measured

```sql
-- Query C — clients whose booking was placed for them, who therefore were
-- never asked.
-- Undercount: this is the measurable floor of it. Every row here sits in
-- '(not stated)' in query A whatever the client actually speaks.
SELECT COUNT(DISTINCT ip.contact_id) AS agent_booked_clients
FROM inspection_people ip
JOIN inspections i
  ON i.id = ip.inspection_id AND i.tenant_id = ip.tenant_id
JOIN contact_role_profiles crp
  ON crp.id = ip.role_profile_id AND crp.tenant_id = ip.tenant_id
JOIN contacts c
  ON c.id = ip.contact_id AND c.tenant_id = ip.tenant_id
WHERE i.concierge_status IS NOT NULL
  AND crp.kind = 'client'
  AND c.archived_at IS NULL;
```

A floor, not the whole gap: staff-created and imported contacts were not asked
either, and they are not identifiable in SQL.

### D. Is this usage, or is it fixtures?

```sql
-- Query D — seed-data check. Identical counts across tenants, or every row
-- created inside one day, means demo fixtures rather than clients.
-- Undercount: the same collection gap applies per tenant; read with query C.
SELECT tenant_id,
       COUNT(*)                                            AS live_clients,
       SUM(CASE WHEN locale IS NOT NULL THEN 1 ELSE 0 END) AS stated,
       MIN(created_at)                                     AS first_created_ms,
       MAX(created_at)                                     AS last_created_ms,
       COUNT(DISTINCT created_at / 86400000)               AS distinct_days
FROM contacts
WHERE archived_at IS NULL
  AND type = 'client'
GROUP BY tenant_id
ORDER BY live_clients DESC;
```

Seeded rows are not demand. Equal `live_clients` across every tenant, or
`distinct_days = 1`, means you are reading a fixture set — exclude those tenants
before quoting anything from A or B.

## What the number cannot see

**The language question is only asked where the client speaks for themselves.**
It is on the public booking surfaces, and on the staff contact form as a
correction. It is deliberately **absent from the agent-on-behalf booking flow**,
whose request carries no `locale` field at all.

That absence is a choice, not an oversight: an agent's *guess* recorded as a
client's *stated* preference would corrupt exactly the measurement this column
exists to produce. The cost of that choice is that the signal **undercounts by
however much of a deployment's volume is booked by agents** — query C sizes it.

So `(not stated)` is at least three populations mixed together:

| In `(not stated)` | Asked? |
|---|---|
| Booked themselves, skipped the question | yes — a real "no preference" |
| Booked by an agent | no — the form has no such field (query C counts these) |
| Created by staff, or imported | no — unless staff filled it in |

Never report `(not stated)` as "prefers English", and never quote A's percentage
without B's answer rate and C's blind spot beside it.

## Running it

```bash
# Local D1
npx wrangler d1 execute <your-database> --local \
  --command "SELECT COALESCE(locale,'(not stated)') AS stated_language, COUNT(*) AS contacts FROM contacts WHERE archived_at IS NULL AND type='client' GROUP BY 1 ORDER BY contacts DESC"
```

Add `--remote` instead of `--local` to read production; these are all read-only
`SELECT`s. Right after the column ships the expected result is a single
`(not stated)` row — that is the correct baseline, and confirms the query runs
before anyone needs the answer.

Every SQL block above is executed against the real migrated schema by
`tests/unit/contacts/demand-signal-queries.spec.ts`, so a column rename breaks
the test rather than the monthly report.
