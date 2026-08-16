# Turnstile — bot protection

Cloudflare Turnstile guards the two surfaces an anonymous visitor can submit to:
the public booking form and agent self-signup.

## What you need

| Key | Where |
|---|---|
| `TURNSTILE_SECRET_KEY` | Settings → Security, or the Worker env |
| `TURNSTILE_SITE_KEY` | Worker env — it is public and is served to the booking page |

For local development Cloudflare publishes a test secret that always passes:
`1x0000000000000000000000000000000AA`.

## Enforcement is conditional on the secret being set

Both call sites are guarded by `if (c.env.TURNSTILE_SECRET_KEY)`. **With no
secret configured, no challenge is required and none is verified.** With one
configured, a submission missing its token is refused before anything else
happens, and a token the siteverify endpoint rejects is refused too.

Stated plainly because the two states differ in kind, not degree:

| `TURNSTILE_SECRET_KEY` | Booking form | Agent signup |
|---|---|---|
| unset | open, no challenge | open, no challenge |
| set | token required, verified server-side | token required, verified server-side |

A self-hosted single-company deployment behind a private URL may reasonably run
without it. A deployment whose booking page is linked from a public website
should not: an unguarded booking form is a way to create records in someone's
schedule at no cost.

`verifyTurnstile` itself throws when handed an empty secret — it never treats a
missing secret as a pass. The skip is a decision made by the caller, in the
open, one line above.

## When it breaks

A verification failure is a `403` naming which of the two happened —
"Security verification token missing" against "Security verification failed" —
rather than one message for both. Agent signup additionally logs
`agent.signup.turnstile.failed` with the underlying error, so a siteverify
outage is distinguishable from a real bot.

## Where the code lives

- `server/lib/middleware/bot-protection.ts` — the siteverify call
- `server/services/booking/booking-admission.ts` — the booking gate
- `server/api/agent-signup.ts` — the signup gate
- `server/api/bookings/profile.ts` — serves `TURNSTILE_SITE_KEY` to the page

## Related

- [Integration adapters](../develop/integration-adapters.md)
