# Creating an inspection

How a job gets into the system — you create it, or a client books it.

> Part 1 of 7 in the inspection workflow. Illustrated version with a
> screenshot per step: <https://inspectorhub.io/docs/create-an-inspection>

Two ways in:

- **You create it** — `/inspections` → **New Inspection**, or go straight to
  `/inspections/new`. Enter the address, the client, the services, the
  template, the inspector, and the date.
- **A client books it** — your public booking page at `/book/<company-slug>`
  creates the inspection as `requested`. Bookings auto-assign the first
  available qualified inspector; you can optionally let the client pick one
  (Settings → Online Booking → booking policies). The same page is embeddable
  in your own site at `/embed/<company-slug>`, and is protected by Turnstile
  when `TURNSTILE_SECRET_KEY` is set.

Address autocomplete on both surfaces needs `GOOGLE_PLACES_API_KEY`. Without it
the field degrades to plain text and the client can still type an address.

---

[All guides](README.md) · [The inspection hub](the-inspection-hub.md) →
