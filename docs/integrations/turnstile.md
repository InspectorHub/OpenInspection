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

## Who has to solve a challenge

Decided by deployment mode, read as a capability (`botProtectionMandatory`),
never by testing whether someone remembered to set a key:

| | `TURNSTILE_SECRET_KEY` set | unset |
|---|---|---|
| **saas** | enforced against your key | **still enforced**, against Cloudflare's published test key |
| **standalone** | enforced against your key | no challenge |

**SaaS never skips.** The booking form and agent signup are reachable from the
open internet on a platform we operate, so "nobody configured a key" is our
misconfiguration to absorb rather than a reason to leave them open. With no key
the challenge runs on Cloudflare's always-pass test key: the widget still
renders, the token is still required, the server still verifies. That is
permissive, not off — the path stays exercised, and turning on real protection
is a configuration change rather than a code change. There is deliberately no
bypass branch to forget to remove.

It says so, every time: `booking.turnstile.test_key` /
`agent.signup.turnstile.test_key` are logged with the reason, so a deployment
running open is visible in the logs rather than only in someone's memory.

**Standalone leaves it to the operator.** You run your own deployment on your
own domain. A single-company install behind a private URL has a legitimate
reason not to challenge anyone, and we are not in a position to overrule it. If
your booking page is linked from a public website, set the key — an unguarded
booking form is a way to create records in your schedule at no cost.

The site key the page receives tracks the secret exactly. A page that renders no
widget against a server that demands a token is a booking form nobody can
submit, and that is the failure mode of resolving the two apart —
`resolveTurnstileSiteKey` exists so they cannot drift.

`verifyTurnstile` throws when handed an empty secret rather than treating one as
a pass: whether a challenge applies is `resolveTurnstile`'s decision, and
reaching that function with nothing means a caller ignored it.

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
