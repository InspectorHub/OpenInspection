# Invoicing and payments

Invoices, checkout, your own Stripe account, and optional QuickBooks sync.

> Part 7 of 7 in the inspection workflow. Illustrated version with a
> screenshot per step: <https://inspectorhub.io/docs/invoicing-and-payments>

Invoices are at `/invoices`; the client pays at `/invoice/:id` or through
`/checkout/<tenant>/<token>`.

Payments run on **your own Stripe account** — a tenant's stored key always beats
any deployment-level key, so a platform binding can never intercept your money.
QuickBooks Online sync is optional (Settings → Integrations → QuickBooks) and
requires `QBO_ENV` to be set explicitly: there is no default, because a guessed
Intuit host fails in a way that reads like a bad credential.

---

---

← [Delivering the report](delivering-the-report.md) · [All guides](README.md)
