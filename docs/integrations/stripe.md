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
booking. The amount comes from the invoice, which is authoritative over the
denormalized `inspections.price` cache — see the money authority chain in
`CLAUDE.md`.

**Inbound:** the webhook at `POST /api/stripe/webhook`, verified against
`STRIPE_WEBHOOK_SECRET`. A successful payment marks the invoice paid, which is
what releases the report pay-gate.

Point your Stripe webhook endpoint at:

```
https://<your-host>/api/stripe/webhook
```

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

- [Invoicing and payments](../user-guide/invoicing-and-payments.md) — the user's view
- [Rotate secrets](../self-host/rotate-secrets.md)
- [Integration adapters](../develop/integration-adapters.md) — for changing this code
