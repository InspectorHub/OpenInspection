# Delivering the report

The client's own portal, and the repair requests they build from the report.

> Part 6 of 7 in the inspection workflow. Illustrated version with a
> screenshot per step: <https://inspectorhub.io/docs/delivering-the-report>

Clients get a magic link into `/portal/<tenant>` — their own view listing their
inspections, with a per-job hub at `/portal/<tenant>/i/<inspectionId>` and
notification settings at `/portal/<tenant>/notifications`. The notification page
works signed out: it asks for an email and mails a one-time link back, without
revealing whether the address is known.

From the report, a client can build a **repair request** at
`/repair-builder/<tenant>/<id>` — picking the items they want addressed. What
they build lands in the Repair Request Log on the inspection, and a contractor
can be given a scoped view at `/repair-request/<shareToken>`.

---

← [Publishing a report](publishing-a-report.md) · [All guides](README.md) · [Invoicing and payments](invoicing-and-payments.md) →
