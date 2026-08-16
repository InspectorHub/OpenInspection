# Estated — property facts

Fills in year built, square footage, foundation type, lot size, bedrooms and
bathrooms from public records, given an address. Saves an inspector typing what
the county already knows.

## What you need

| Key | Where |
|---|---|
| `ESTATED_API_KEY` | Settings → Advanced, or the Worker env |

## How it is used

One endpoint, invoked explicitly:

```
POST /api/inspections/:id/property-facts/autofill
```

It is a button the inspector presses, not a background lookup on every address.
Public-records data is frequently wrong or stale, so the inspector sees what it
returned and decides — the Property Facts card is editable either way, and
what they leave is what goes in the report.

## When it is not configured

Returns `{ data: null, reason: 'NO_API_KEY' }` and the Property Facts card shows
a short "auto-fill not configured" hint while still accepting manual entry. The
same graceful-degrade shape as [Google Places](google-places.md), and for the
same reason: a missing optional key must be distinguishable from a lookup that
found nothing.

## When it breaks

A failed lookup leaves the fields as they were. Nothing is cleared and nothing
is half-written — an autofill that partially applied would be worse than one
that did not run, because the inspector would have no way to tell which fields
came from the county and which they typed.

## Where the code lives

- The autofill route, under `server/api/inspections/`
- `server/lib/db/schema/inspection/core.ts` — the columns it writes

## Related

- [Google Places](google-places.md)
- [Integration adapters](../develop/integration-adapters.md)
