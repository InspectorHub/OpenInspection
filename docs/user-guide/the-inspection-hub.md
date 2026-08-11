# The inspection hub

Where one job lives: schedule, parties, agreements, report, payment, lifecycle.

> Part 2 of 7 in the inspection workflow. Illustrated version with a
> screenshot per step: <https://inspectorhub.io/docs/the-inspection-hub>

`/inspections/:id` is the hub — the answer to "where does this job stand". It
carries the schedule, the parties, the agreement state, the report card, the
payment state, and the lifecycle actions (cancel, restore).

Two things sit next to it rather than on it:

- `/inspections/:id/edit` — the full-screen editor (below)
- `/inspections/:id/repair-requests` — the Repair Request Log, every request
  built for this job with its items

---

← [Creating an inspection](create-an-inspection.md) · [All guides](README.md) · [Agreements and signatures](agreements-and-signatures.md) →
