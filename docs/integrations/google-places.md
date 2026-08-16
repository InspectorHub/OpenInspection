# Google Places — address autocomplete

Suggests addresses as someone types, on the public booking page and the
dashboard's new-inspection wizard. A convenience, never a requirement.

## What you need

| Key | Where |
|---|---|
| `GOOGLE_PLACES_API_KEY` | Settings → Advanced, or the Worker env |

Enable the Places API on the Google Cloud project the key belongs to, and
restrict the key — it is used server-side only, so an IP or API restriction
costs nothing and limits the damage if it leaks.

## The key never reaches the browser

Both surfaces call our own `/api/places/*` and `/public/geocode`, which proxy to
Google server-side. The browser never sees the key, which is also why the
restriction advice above is worth following: the key is only ever used from your
Worker.

## When it is not configured

Both endpoints return `{ data: [], reason: 'NO_API_KEY' }` and the address
inputs degrade to plain text. The customer can still type a free-form address
and submit; the booking completes. Nothing is disabled and no error is shown for
a feature that was never promised.

The explicit `reason` is the point: an empty suggestion list means "no key" or
"no match", and a caller that could not tell them apart would report a
misconfiguration as a spelling problem.

## What is stored

The picked address is written to the inspection's address fields, including the
Places short-form state and the raw county component. Two columns — `address_lat`
and `address_lng` — are written and, at the time of writing, read by nothing:
the wizard's map draws from the live Places pick held in component state. They
are noted in `server/lib/db/schema/inspection/core.ts` rather than quietly
carried.

## Where the code lives

- `server/api/places.ts` — the autocomplete proxy
- `server/api/bookings/geocode.ts` — the public geocode proxy

## Related

- [Estated](estated.md) — the other address-driven lookup
- [Integration adapters](../develop/integration-adapters.md)
