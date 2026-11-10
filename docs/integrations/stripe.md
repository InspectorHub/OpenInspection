# Stripe — taking card payments

Each inspection company connects **its own** Stripe account. The platform never
holds the money and never sits in the payment path, which is why this is the one
integration whose credentials invert the usual precedence.

## What you need

| Key | Where it goes | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | Settings → Integrations → Stripe | `sk_live_…` or `sk_test_…`. The mode is inferred from the prefix and shown back to you |
| `STRIPE_PUBLISHABLE_KEY` | same | `pk_…`, used by the client-side payment element |
| `STRIPE_WEBHOOK_SECRET` | same | `whsec_…`, verifies inbound events |

## The precedence inversion, and why

For every other integration a Worker env binding beats the tenant's stored
value, so a deployment can provide a shared credential. Stripe is in
`TENANT_OWNED_KEYS` (`server/lib/middleware/integration-secrets.ts`): **the
tenant's stored key always wins.**

A platform key overriding a company's own would route their customers' card
payments into somebody else's Stripe account. That is not a configuration
preference; it is the failure mode the rule exists to make impossible.

## What flows where

**Outbound:** payment intents for an inspection's invoice, and deposits taken at
booking. The invoice total comes from the invoice, which is authoritative over the
denormalized `inspections.price` cache — see the money authority chain in
`CLAUDE.md`. What a card is charged on an invoice is the **outstanding balance**:
the total minus everything the payment ledger has received against it (a booking
deposit, an offline payment, a part-payment), plus any refunds. The pay page is
shown that same figure. When nothing is outstanding no payment intent is created,
and the page says the invoice is already paid. A payment request that would ask
for nothing is refused with a clear message instead of emailing the client.

**Charging at booking.** Settings → Booking → *Collect payment when clients book*
turns it on: **Charge the full fee when booking** stores a 100% deposit, and
**Charge a deposit** takes a percent or a fixed amount. The section shows whether
Stripe is connected (all three keys saved) beside whether payment at booking is
on. Turning it on before Stripe is connected is allowed: the booking is still
accepted and the amount shows as unpaid, but the client cannot pay until the keys
are in, and until then the public booking page quotes no deposit and shows no Pay
button; the confirmation says the company will contact the client about it. A
service can set its own deposit, or none, under Services & catalog.

**Inbound:** the webhook at `POST /webhooks/stripe`, verified against
`STRIPE_WEBHOOK_SECRET` — the workspace's secret saved under Settings →
Integrations is honoured on this path exactly as it is on the API. A successful
payment is recorded in the ledger for exactly the amount Stripe reports it took
(the payment intent id makes a redelivery a no-op) and marks the invoice paid once
the ledger covers its total, which is what releases the report pay-gate. A booking
deposit alone never releases the report unless it covers the full total.

Card payments need all three keys (publishable, secret and webhook secret). With the
webhook secret missing, a payment could be taken and never recorded, so the booking
page offers no Pay button and the payment endpoints answer `503`. Repeated clicks on
Pay return the same Stripe payment intent while the balance is unchanged; a changed
balance gets a new one. If that earlier intent has already ended (it succeeded and was later refunded, or it was cancelled), a fresh intent is created instead, so a client is never handed a payment form that cannot be confirmed.

**Overpayments are refunded in the Stripe dashboard.** If a client's card is charged
after another payment already covered the invoice (a payment page left open while an
offline payment was recorded), the charge is recorded in full and the invoice shows
the excess. The payments screen can record offline payments and correct a mistyped
amount; it does not issue a refund through Stripe. Refund the excess in the Stripe
dashboard.

The webhook refuses a body larger than 1 MB with `413` and, where the `STRIPE_WEBHOOK_RATE_LIMITER` binding is configured (`wrangler.jsonc`, 300 requests per minute per workspace and source address), a burst beyond it with `429`. Both are answered before any workspace or secret lookup and logged without the payload; Stripe retries a non-2xx delivery.

Point your Stripe webhook endpoint at:

```
https://<your-host>/webhooks/stripe
```

Inbound webhooks are mounted at the **top level**, not under `/api/`: the
producer owns the body, the headers and the signature, and none of the `/api/*`
middleware applies to them.

A second, workspace-scoped mount exists at `/webhooks/stripe/<workspace-slug>`.
A standalone deployment does not need it — the bare path resolves the one fixed
workspace — but a multi-workspace deployment does, because the verifier secret
is per workspace and has to be resolved before the signature can be checked.

## Testing it

Settings → Integrations → Stripe has a **Test connection** button. It calls
Stripe's account endpoint with the stored key and reports the account name plus
whether the key is live or test mode. The result is written to the integration
test log, so a later reader can see when it last worked rather than guess.

Three distinct outcomes, deliberately not collapsed:

| What you see | What it means |
|---|---|
| `No Stripe secret key is configured` (503) | Nothing stored, nothing attempted |
| `Stripe rejected the stored secret key` (502) | A key is stored and Stripe refused it |
| `Connected to <name> (test mode)` | Working, and you can see which account |

## When it is not configured

Card payment is unavailable. The invoice still exists, can still be marked paid
manually ("Mark paid" records an offline payment — check, cash, transfer), and
the report pay-gate still releases on that. Nothing is silently skipped.

## Where the code lives

- `server/api/stripe-webhook.ts` — inbound verification and handling
- `server/services/stripe.service.ts` — the outbound client
- `server/api/public/deposit-intent.ts` — booking deposits
- `server/api/integrations.ts` — the connection test

## Related

- [Invoicing and payments](https://inspectorhub.io/docs/invoicing-and-payments) — the user's view
- [Rotate the JWT keyring](../operate/rotate-jwt-keyring.md)
- [Integration adapters](../develop/integration-adapters.md) — for changing this code
