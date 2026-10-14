# QuickBooks customer link: which signal gates it

The contact page's QuickBooks card and the "Match to a QuickBooks customer"
entry points are shown according to **the tenant's QuickBooks connection**, that
is, whether `GET /api/integrations/qbo/status` answers with a connection (the
payload is `QBOConnectionStatus`, or `null` when there is none; there is no
`connected` field to read).

## What the sync path checks

`server/api/contacts.ts` (create and update) and the invoice, payment and
cancellation routes start a QuickBooks sync only when `c.env.QBO_CLIENT_ID` is
set. That variable is not only the deployment's environment binding:
`integrationSecretsMiddleware` merges a tenant's stored integration secrets into
`c.env` for every `/api/*` request, with the Worker env winning and the stored
value as the fallback. So "`QBO_CLIENT_ID` is set" means "an Intuit app is
configured for this tenant, either by the deployment or in Settings".

## Why the UI does not use it

An Intuit app being configured is not the same as a company being connected. The
page needs the second one: the card only has something to show, and a match can
only be written, once a company is linked.

The two signals can disagree in one direction: **credentials configured, no
company connected yet.** In that state a contact save still starts
`upsertCustomer`, which fails with `No QBO connection for tenant …`, and the
failure is recorded as an open sync error for that contact.

## Decision

- The contact card and every match entry point depend on the tenant being
  connected. When no company is connected they are not rendered.
- The sync gate is not changed by the link feature itself.
- The disagreement above is tracked as a known issue: a tenant that saves
  credentials and edits contacts before connecting accumulates sync errors that
  appear on the Books health list after the first connection. The backend
  hardening task for the link feature addresses it by having `upsertCustomer`
  return without recording an error when there is no connection.
