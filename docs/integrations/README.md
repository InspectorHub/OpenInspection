# Integrations

Everything OpenInspection talks to that is not OpenInspection. One page per
service: what it is for, which credentials it needs and where they go, which
direction data actually flows, and what happens when it is not configured.

These pages were split out of `operate/` because they answer a different
question. `operate/deploy.md` and `upgrade.md` are about running the engine;
these are about connecting it to somebody else's system, which is a job you do
once per service and then forget until it breaks.

## The services

| Service | What it does | Credentials | Configurable per tenant |
|---|---|---|---|
| [QuickBooks Online](quickbooks.md) | Push customers, invoices, payments and credit memos; read payment status back | `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_WEBHOOK_SECRET`, `QBO_ENV` | yes |
| [Stripe](stripe.md) | Take card payments for inspections. Each company connects its OWN Stripe account — the platform never holds the money | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | yes |
| [Email](email.md) | Every transactional message. Four providers: Resend, SendGrid, Postmark, Mailgun | `RESEND_API_KEY` (+ the other three, + per-provider webhook secrets) | yes |
| [SMS](sms.md) | Appointment and report notifications. Twilio or Telnyx | `TWILIO_*`, `TELNYX_*` | yes |
| [Google Calendar](google-calendar.md) | Two-way availability and event sync for an inspector's own calendar | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | yes |
| [Apple Calendar (CalDAV)](apple-calendar.md) | The same, over CalDAV, with an app-specific password | none — per-inspector, entered in the app | n/a |
| [Video](video.md) | Where inspection video lives: R2 (default) or Cloudflare Stream | `STREAM` binding, `STREAM_CUSTOMER_SUBDOMAIN` | yes (self-host) |
| [AI](ai.md) | Translation and drafting assistance | `AI_MODEL`, plus a tenant key or `AI_MANAGED_API_KEY` | yes |
| [Turnstile](turnstile.md) | Bot protection on the public booking form | `TURNSTILE_SECRET_KEY` | yes |
| [Google Places](google-places.md) | Address autocomplete on the booking form and the new-inspection wizard | `GOOGLE_PLACES_API_KEY` | yes |
| [Estated](estated.md) | Property facts (year built, sqft, foundation) by address | `ESTATED_API_KEY` | yes |
| [MCP](mcp.md) | **Inbound.** Lets Claude or another MCP client drive this deployment over OAuth 2.1 | `MCP_ENABLED` | n/a |

Every one of these is optional. The engine runs with none of them configured;
what you lose is stated on each page under "When it is not configured".

## Conventions that hold for all of them

**Credentials resolve env-first, then the tenant's own.** A key present in the
Worker environment wins over one stored in the database. That order is what
makes a platform-provided credential safe to add without hijacking a company
that brought its own — except for Stripe, which inverts it deliberately, because
a platform key winning there would route somebody else's customers' money into
the wrong account. The catalogue of which keys a tenant may set is
`server/lib/secrets-catalog.ts`, and the key names are byte-identical to the
Worker binding names, which is what lets the middleware merge them transparently.

**Tenant-stored credentials are encrypted at rest** and never returned to the
browser — the settings forms show a masked placeholder and send a value only
when you actually type a new one. Rotation is
[`operate/rotate-jwt-keyring.md`](../operate/rotate-jwt-keyring.md).

**Absent credentials fail closed, not silently.** A missing key disables the
feature it belongs to and says so on the settings page; it does not fall back to
a default endpoint or a shared key. `QBO_ENV` is the sharpest example and has
its own note on the QuickBooks page: it has no default because guessing between
sandbox and production is wrong half the time and fails in a way that reads like
a bad credential.

**What a failure looks like is part of the integration.** Each page has a
"When it breaks" section naming where the error surfaces. This is not
boilerplate: for QuickBooks, six code paths had never once worked in production
precisely because every refusal was recorded as the string `QBO 400` and nobody
could tell the reasons apart.

## Adding or changing one

Read [`../develop/integration-adapters.md`](../develop/integration-adapters.md)
first. It covers where payload shape lives, how credentials are resolved and
encrypted, how failures must be recorded, and the contract test lane that keeps
our idea of a third-party API honest against the third party's own.
