# Turnstile — bot protection

Cloudflare Turnstile guards the surfaces an anonymous visitor can submit to:
the public booking form, agent self-signup and the request for the signed audit
record of an envelope (`POST /api/public/verify/:envelopeId/export`, which also
asks for an email recorded on the envelope; the property's postal code is accepted only together with an email).

## What you need

| Key | Where |
|---|---|
| `TURNSTILE_SECRET_KEY` | Settings → Security, or the Worker env |
| `TURNSTILE_SITE_KEY` | Worker env — it is public and is served to the booking page |

The committed `wrangler.jsonc` ships Cloudflare's test **site** key. When you set a
real secret, set the matching real site key as well: tokens from the test widget are
rejected by a real secret, so every challenge would fail. The secret is not in the
repository, so no build or lint step can see the pairing; the export request logs
`verify.export.turnstile.key_pair` at runtime when it finds a real secret with the
test site key.

For local development Cloudflare publishes a test secret that always passes:
`1x0000000000000000000000000000000AA`.

## Agent signup is public once agent terms are published

`POST /api/agent-signup` needs no session. It stays closed until the deployment
publishes its agent terms (`scripts/publish-agent-terms.mjs`); from the moment
terms are published, anyone who can reach the deployment can create an agent
account with any email address, with no email verification. An agent account sees
only the agent surface (its own referrals, notices and reports), but account
creation itself is open. On a standalone deployment that publishes agent terms,
configure `TURNSTILE_SECRET_KEY` so signup requires a solved challenge.

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

The `/agent-signup` page renders the widget with the site key that `GET /api/agent-signup/terms` returns
as `turnstileSiteKey` (resolved by the same function as the booking page, so the key and the verifying secret
cannot drift; `null` where the deployment does not challenge signups). The solved token is posted as
`cf-turnstile-response`, an expired or failed challenge is reported on the form, and each answered submit asks
for a fresh token because a token is good for one request.

Signup also writes the acceptance ledger: the `agent_terms_acceptances` row (version, content hash, time, and
IP and country where the request carried them) is inserted in the same `db.batch()` as the new account, so an
account never exists without its record. Accounts created before this change have no ledger row and are not
backfilled; they keep passing the agent-terms gate through the acceptance stored on the account and are asked
again only when the terms change.

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

## The signed audit export request

`POST /api/public/verify/:envelopeId/export` releases the signed audit record to a
caller who supplies an email recorded on the envelope, after the challenge. The
postal code of the inspected property is a second factor and never a first: it is
accepted only together with an email, and when one is supplied it must match as
well. A request without an email is answered 400 and counts for nothing. Its attempt allowance is kept in the
database (`verify_export_attempts`), reserved before the answer is compared, so
parallel requests cannot exceed it:

- 5 wrong emails per 15 minutes for one (envelope, network) pair;
- 3 wrong postal codes per 15 minutes for one (envelope, network) pair;
- 10 postal codes per hour for the envelope, whatever the network;
- 50 attempts of either kind per hour for the envelope, whatever the network.

A postal code is a weaker factor than a signer's email, since it has a small
keyspace and is printed on documents the participants share; that is why its
allowances are smaller and why it also counts toward the envelope-wide ceilings.
A postal attempt is counted only once the email in the same request matched a signer;
a request with a wrong email is counted under the email counters alone. Once a postal
allowance is spent, the postal path answers like every other refusal (the same status
and body, no wait is announced) and reserves nothing more, whether the email was right
or wrong: a distinct answer would tell someone who spent the allowance with one known
email which other guesses are signers. The email alone still works. Accepted residual:
a correct email with a postal code costs one extra counter write before the refusal,
a small timing difference, bounded by the per-network and per-envelope email counters.
The strict limits are per network so a third party cannot lock the signer out
from their own address: an IPv4 address is one network, an IPv6 address counts as
its /64 prefix. The residual risk is a caller who changes network: only the
envelope-wide ceilings stop them, and while one holds the signer's own answers
are refused too until the hour ends. A request with no `CF-Connecting-IP` skips
the per-network counters.

### Write cost

The Workers Free plan allows 100,000 D1 row writes a day for the whole account, so
refusals are write-free. The order is: body check (400), id format, the binding
limiter (per network; a no-op when the binding is
absent), one read for the envelope (an unknown id gets the usual 403), the bot token
(missing where the challenge is enforced: 403), one read-only lock check of the email counters (429 with
`Retry-After`), the token verification (403), and only then the reservation. The postal counters are read
and reserved after the email matched a signer, and a spent postal allowance there answers the uniform 403.

Counts are counter-row writes: one for each reservation (an upsert) and one for each reservation handed back. With a client
address the email-side reservation is two counters (the per-address email counter and the envelope-wide one); without an
address it is one (the envelope-wide counter only), and the figures in brackets apply.

| Request class | Row writes |
|---|---|
| Unknown envelope, no token, failed token, locked out | 0 |
| Wrong email after a passed challenge, with or without a postal code (the postal counters are not touched) | 2 (1) |
| Right email, no postal code: reserved, then handed back | 4 (2) |
| Right email with a wrong postal code: the email-side and postal reservations are both kept | 4 (2) |
| Right email with a right postal code: both reserved, then both handed back | 8 (4) |

A request that loses a race past the lock check releases what it reserved. Each
real envelope is capped by its own envelope-wide counters at 50 kept attempts an
hour, so a caller who knows no answer causes about 100 writes an hour (2,400 a day) per envelope (two per wrong email), and one who
knows a signer's email and guesses postal codes about 120 an hour (2,880 a day): only the first 10 postal guesses an hour reach the
postal counters (4 writes each), and the other 40 attempts write the email side only (2 each). What bounds the number of envelopes
written to depends on the key:

| Configuration | What bounds the writes |
|---|---|
| A real `TURNSTILE_SECRET_KEY` (with its own site key) | Challenges solved: a write needs a token that Cloudflare accepted |
| saas with no secret (the always-pass test key is used and logged as `verify.export.turnstile.test_key`) | The challenge bounds nothing; the binding limiter does |
| standalone with no secret | No challenge; the binding limiter does |

The binding limiter allows about 10 requests a minute per network, so where
the challenge bounds nothing one network can write on the order of 29,000 rows a day across many envelopes (14,400 requests at two
writes each), and more only for a caller who already holds signers' emails. Configure `TURNSTILE_SECRET_KEY`.

The verification page, its key download and its document link share one allowance of the same size (10 a minute per network, counted
apart from the export request), so several people checking from one shared network address (an office behind one NAT, say) can reach it
and be answered `429` for a short while. The document link answers
`302` for any envelope that exists; the renderer behind it then answers `404` unless the envelope is signed, and shows the
document without the drawn signatures.

Residual: the envelope-wide counters bound guessing from many networks, so after enough counted attempts in an hour they refuse every network for the rest
of the hour, the signer's included. A request with no `CF-Connecting-IP` skips the binding limiter.

An unknown envelope id is answered with the same 403 and writes nothing, so
counters exist only for real envelopes. The counters hold a keyed hash of the
network (from `JWT_SECRET`), never an address; rows whose window has ended are
deleted by the scheduled retention sweep (rule `verify_export_attempts`). A token
the verification service rejects is the usual 403; only a failure to reach the
service (a 3-second timeout, a network error, a 429 or 5xx from it) answers 503
`verification_unavailable`, and the form says so in its own words. A store
failure refuses with the ordinary 403 and logs `verify.export.attempts.unavailable`.

After an upgrade, run the database migrations (`npm run db:migrate`) before the
new code serves traffic. Without the `verify_export_attempts` table every export
request is refused with the ordinary 403 and that log line names the cause.

## Where the code lives

- `server/lib/middleware/bot-protection.ts` — the siteverify call
- `server/services/booking/booking-admission.ts` — the booking gate
- `server/api/agent-signup.ts` — the signup gate
- `server/api/public/verify-export.ts` and `server/lib/verify-export-attempts.ts` — the export request and its attempt counters
- `server/api/bookings/profile.ts` — serves `TURNSTILE_SITE_KEY` to the page

## Related

- [Integration adapters](../develop/integration-adapters.md)
