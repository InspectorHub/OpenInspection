# Integration adapters

How code that talks to somebody else's API is put together here, and the rules
that exist because breaking them cost this project real, shipped defects.

For the user-facing side of each service — which keys, where they go, what
breaks — see [`../integrations/`](../integrations/README.md).

## Why this document exists

The QuickBooks adapter shipped **six code paths that had never once worked in
production**, while its unit suite was green the entire time. Every update was
sent as a `PUT` (v3 has no PUT). Every invoice was sent without a `CustomerRef`
(required). Every invoice from the dashboard was sent with an empty `Line`
(required). The duplicate-name retry matched fault `6140`, a code QuickBooks
never returns. A colon in a customer's name was refused forever. A voided
invoice was read back as paid in full.

They share one cause, and it is not carelessness: **the tests supplied the
upstream's answers.** A fixture that invents the response it asserts on can only
prove the code agrees with itself. Everything below is a consequence.

## Where the pieces go

```
server/services/<service>/
  api-base.ts          auth, token refresh, the HTTP call, error shaping
  <entity>-payload.ts  PURE: our record → their document
  <entity>-sync.ts     the push: lookup, call, map, retry, record
  inbound-*.ts         reading THEIR state and deciding what we believe
```

**Payload shape lives in its own pure module.** Which fields the API requires
and how cents become dollars is a question about shape; answering it should not
mean reading a retry loop. It also has to be reachable from a contract spec
without constructing a service — that reachability is the point, not a
side-effect. `qbo/invoice-payload.ts` and `qbo/customer-payload.ts` are the
pattern.

**Inbound is a separate module from outbound.** `qbo/inbound-reconcile.ts` reads
QuickBooks' state and decides how much of it we are allowed to believe; that is a
different question from "render our invoice as theirs", and keeping them apart
is what makes the answer readable on its own.

## Credentials

Declare every key in `server/lib/secrets-catalog.ts`. The names are
**byte-identical to the Worker env binding names** — that identity is what lets
`integration-secrets.ts` merge a tenant's stored value into `c.env` and have
every downstream reader work unchanged.

Precedence is per-key and stated in one place:

- **Default — env wins**, the tenant's DB value is the self-host fallback. A
  platform-provided key can then be added without hijacking a company that
  brought its own.
- **`TENANT_OWNED_KEYS` — DB wins.** Only Stripe today. A platform env key
  overriding a tenant's own would route their customers' money into the wrong
  account, which is not a precedence question so much as a safety one.

Two rules with teeth:

- **Never write to `c.env` in place.** The runtime reuses one `env` object for
  every request in an isolate, so an in-place write leaves this tenant's secret
  there for the next one. Copy, then merge into the copy.
- **No fallback constants.** A missing key disables the feature and says so. It
  does not fall back to a default endpoint, a shared key, or a guess. `QBO_ENV`
  is the sharpest case: sandbox and production keys authenticate only against
  their own kind, so a guessed host is wrong half the time and fails looking
  exactly like a bad credential.

## Recording failures

**A status code alone is not a record.** When one code covers several causes, it
hides all of them. `Error('QBO 400')` was written to `qbo_sync_errors.error_msg`
for years, and 400 means at once: a missing required field, an invalid
reference, an over-long string, a stale token, an unsupported verb. Two fatal
defects lived behind that string while QuickBooks named them in the response.

- Keep **every** entry the upstream reports, with its field and code. One
  response can carry two problems; reporting the first costs a round trip to
  discover the second.
- A retry loop must keep the **last upstream error** and repeat it on
  exhaustion. The old loop threw `after 3 stale-token retries` — an assertion of
  its own, and wrong for every 400 that was not a stale token, which sent the
  reader to inspect a token that was fine. A wrong diagnosis is worse than none.
- When the failure is OUR missing data, say so before the round trip.
  "Cannot send to QuickBooks: invoice has no contact" names something the
  operator can act on; a validation fault about `CustomerRef` does not.

`qbo/error-detail.ts` (`describeQboError`) is the shape to copy.

## Believing what comes back

Inbound state is a claim, not a fact, and the adapter decides how much of it we
accept.

- **Our ledger is authoritative for money we collected.** When the two
  disagree, RECORD the disagreement with both figures; do not write an adjusting
  entry. An adjustment is money movement nobody performed, and afterwards it is
  indistinguishable from money that really moved.
- **Two identical numbers can mean two different things.** A voided QuickBooks
  invoice reports `TotalAmt` 0 and `Balance` 0 — byte-identical to a fully
  settled one. Reading balance alone marked a voided $555 invoice paid in full
  against a ledger holding nothing, which unlocked the report and counted
  revenue nobody sent. Before trusting a field, ask what else produces that
  value.
- **Do not mirror a destructive state change from a poll.** The void is
  recorded, not applied: voiding here resets the payment gate and can retract a
  published report, and that is a decision rather than a reading.

## Testing an adapter

Four suites can touch one, and they answer different questions. Full rules:
[`testing.md`](testing.md).

| Question | Where |
|---|---|
| Does our code do what we intended? | `tests/unit/<domain>/` |
| Is what we intended what the API accepts? | `tests/contract/<party>/*.contract.spec.ts` |
| What does the API actually answer? | `tests/contract/<party>/*.live.spec.ts` |

The rule that would have caught all six defects: **never fabricate the
upstream's response.** If a spec needs a fault body, a status, or a field, take
it off the wire and say in a comment when it was captured. A fabricated `6140`
passed ten specs while the ladder it gated had never run.

Practical consequences:

- Fixtures must not supply fields production never sets. The QuickBooks specs
  inserted invoice rows carrying `contactId` while no write path in the product
  ever set that column — so the tests ran against data production cannot
  produce, and the push they exercised had never once succeeded.
- Pair every negative claim with a **positive control**. "We send nothing
  undeclared" passes vacuously against a parser returning an empty set.
- **Prove a fix red first.** Remove it, watch the new spec fail, put it back.

## Adding a new integration

1. Enumerate the credentials, add them to `secrets-catalog.ts`, and decide
   whether they are tenant-owned. Write down why.
2. Write the payload module first, pure, and a contract spec against whatever
   the vendor publishes — a schema, a spec file, anything you did not write.
   Vendor it with its provenance (see `tests/contract/qbo/vendor/SOURCES.md`).
3. Ask the API the questions the vendor's documents cannot answer, and pin the
   answers in a live contract spec.
4. Then write the sync path, its failure recording, and its unit specs.
5. Add the page under `docs/integrations/`, including what breaks when the
   credentials are absent.
