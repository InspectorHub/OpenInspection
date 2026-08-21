# OpenInspection documentation

Start here. Pick the section that matches what you are trying to do.

| I want to… | Go to |
|---|---|
| Get something running for the first time, today | [`quickstart.md`](quickstart.md) |
| Run OpenInspection for my own inspection business | [`operate/`](#operating-a-deployment) |
| Use the product day to day | [inspectorhub.io/docs](#using-the-product) |
| Change the code or send a pull request | [`develop/`](#developing) |
| Connect it to QuickBooks, Stripe, a calendar, email or SMS | [`integrations/`](#integrations) |
| Look up an endpoint, a table, a role | [`reference/`](#reference) |
| Understand why something works the way it does | [`concepts/`](#concepts) |
| Review how personal data is handled | [`compliance/`](#compliance) |

---

## Operating a deployment

Running the engine on your own Cloudflare account. Start at the quickstart if you
have never deployed it; it is the same path with every deferrable decision
deferred.

| Doc | Topic |
|---|---|
| [`quickstart.md`](quickstart.md) | Empty Cloudflare account to a workspace you can log into, in about 20 minutes |
| [`operate/deploy.md`](operate/deploy.md) | First-time production deploy — one-click, CLI, and what gets provisioned |
| [`operate/upgrade.md`](operate/upgrade.md) | Move an existing deployment to a newer release (forward-only) — including the one-time reconcile a rebuilt baseline needs |
| [`operate/sms-compliance.md`](operate/sms-compliance.md) | Privacy/Terms pages, carrier registration, TCPA/CTIA wording |
| [`operate/rotate-jwt-keyring.md`](operate/rotate-jwt-keyring.md) | Rotating the ES256 JWT keyring without invalidating live sessions |

## Using the product

**Not here.** The user guide lives at <https://inspectorhub.io/docs> — the
inspection workflow end to end: create, inspect, publish, deliver, get paid.

It is not in this repository because it is not about this repository. A page
explaining how to record a finding or send a report describes the product, and
the product is the same product whether you run it yourself or somebody runs it
for you — so one copy serves both, illustrated with screenshots taken from the
software in this repository (`tests/docs-shots/`). Splitting it would give
self-hosters the worse of two guides.

Where a screen genuinely differs by deployment mode, the hosted page says so
inline. Capability by capability, the difference is
[`reference/deployment-modes.md`](reference/deployment-modes.md).

## Integrations

One page per external service: what it does, which credentials, which direction
data flows, and what breaks when it is not configured. Full index and the
conventions common to all of them: [`integrations/README.md`](integrations/README.md).

| Doc | Topic |
|---|---|
| [`integrations/quickbooks.md`](integrations/quickbooks.md) | Registering your own Intuit app, the four settings, what ends a connection |
| [`integrations/stripe.md`](integrations/stripe.md) | Bring-your-own Stripe account; why a platform key must never win here |
| [`integrations/email.md`](integrations/email.md) | Resend / SendGrid / Postmark / Mailgun, platform-vs-own credentials (no SMTP) |
| [`integrations/sms.md`](integrations/sms.md) | Twilio and Telnyx, and the single gate every outbound message passes |
| [`integrations/google-calendar.md`](integrations/google-calendar.md) | Per-inspector two-way sync over OAuth |
| [`integrations/apple-calendar.md`](integrations/apple-calendar.md) | The same over CalDAV — all-or-nothing, no read-only |
| [`integrations/video.md`](integrations/video.md) | R2 (default, free) vs Cloudflare Stream |
| [`integrations/ai.md`](integrations/ai.md) | Tenant key vs managed key, and why `AI_MODEL` has no default |
| [`integrations/turnstile.md`](integrations/turnstile.md) | Bot protection on booking and agent signup |
| [`integrations/google-places.md`](integrations/google-places.md) | Address autocomplete; the key never reaches the browser |
| [`integrations/estated.md`](integrations/estated.md) | Property facts by address, on an explicit button |
| [`integrations/mcp.md`](integrations/mcp.md) | **Inbound** — connecting Claude or another MCP client over OAuth 2.1 |

## Developing

| Doc | Topic |
|---|---|
| [`develop/setup.md`](develop/setup.md) | Run it locally, the command table, how to add a page or an endpoint |
| [`develop/architecture.md`](develop/architecture.md) | Single-worker architecture, request flow, module map, cost model |
| [`develop/testing.md`](develop/testing.md) | Five suites, where a spec lives, how to run each one |
| [`develop/integration-adapters.md`](develop/integration-adapters.md) | Writing code that talks to somebody else's API — shape, credentials, failure recording, contract tests |
| [`develop/design-system.md`](develop/design-system.md) | Tokens, `packages/shared-ui`, dark mode, the `lint:ds` gate |
| [`develop/logo-design.md`](develop/logo-design.md) | Logo construction and brand asset spec |
| [`develop/conventions/route-metadata.md`](develop/conventions/route-metadata.md) | Metadata every `createRoute()` must declare, and the gate that enforces it |
| [`develop/conventions/i18n-glossary.md`](develop/conventions/i18n-glossary.md) | One es-419 equivalent per term, enforced by `lint:i18n-glossary` |
| [`develop/verification-copy-policy.md`](develop/verification-copy-policy.md) | What a verification surface may say about what it checked, enforced by `lint:verification-copy` |
| [`develop/conventions/mcp-oauth-notes.md`](develop/conventions/mcp-oauth-notes.md) | MCP + OAuth server internals and pinned package symbols |
| [`develop/spikes/`](develop/spikes/) | GO/FALLBACK decision records for questions answered by throwaway code — the code is gone, the write-up is the deliverable |

Also read [`CONTRIBUTING.md`](../CONTRIBUTING.md) (code conventions, PR process,
versioning policy) and [`CLAUDE.md`](../CLAUDE.md) (the enforced house rules —
auth, validation, logging, tenancy, schema).

## Reference

| Doc | Topic |
|---|---|
| [`reference/api.md`](reference/api.md) | REST endpoints and auth patterns. Live OpenAPI at `/doc`, Swagger UI at `/ui` |
| [`reference/database.md`](reference/database.md) | D1 schema, drizzle-kit schema-first migration flow |
| [`reference/database-schema.md`](reference/database-schema.md) | Every table and column, generated from the schema (`npm run docs:schema`) |
| [`reference/roles.md`](reference/roles.md) | The four roles, the nine capability toggles, mapping from Spectora / ISN |
| [`reference/deployment-modes.md`](reference/deployment-modes.md) | What differs between `standalone` and `saas`, capability by capability (generated) |

## Concepts

Why things are built the way they are. Read these when the reference told you
*what* and you need *why*.

| Doc | Topic |
|---|---|
| [`concepts/inspection-workflow.md`](concepts/inspection-workflow.md) | Template-driven JSON schema, results, versioned report snapshots |
| [`concepts/collab-editing.md`](concepts/collab-editing.md) | Yjs CRDT in a Durable Object; what happens when the binding is absent |
| [`concepts/kv-cache.md`](concepts/kv-cache.md) | What `TENANT_CACHE` holds and when it is invalidated |
| [`concepts/multilingual-demand-signal.md`](concepts/multilingual-demand-signal.md) | Reading `contacts.locale` as a number, and what it cannot see |

## Compliance

Written for auditors and review, not for engineers.

| Doc | Topic |
|---|---|
| [`compliance/ai-data-flow.md`](compliance/ai-data-flow.md) | Field by field, what leaves the process when an AI feature runs |
| [`compliance/destruction-evidence.md`](compliance/destruction-evidence.md) | What proves a workspace was destroyed, how it is written, and the 3-year retention |
| [`compliance/erasure-heuristic-limits.md`](compliance/erasure-heuristic-limits.md) | What the erasure PII gate can and cannot see |
| [`compliance/report-view-lia.md`](compliance/report-view-lia.md) | Legitimate Interests Assessment for report delivery confirmation |

---

## Editing these docs

Two of the pages here are checked by gates rather than by eyes:

- **Every relative link must resolve.** `npm run lint:doclinks` walks every
  tracked markdown file and fails on a link to a file that does not exist. It
  runs inside `npm run lint`, so CI enforces it. (It was written because three
  links in `CONTRIBUTING.md` had been dead for months — one pointed at a file
  that has never existed in this repository.)
- **`reference/deployment-modes.md` is generated.** Edit the profile constants
  in `server/lib/deployment-profile.ts` and the descriptions in
  `scripts/gen-deployment-modes-doc.ts`, then run `npm run docs:modes`.
  `tests/unit/platform/deployment-modes-doc.spec.ts` fails if the checked-in
  table disagrees with the constants, or if a capability has no description.

Everything else is ordinary prose — but prefer stating the invariant over
recounting the history, same as in code comments.

**No number prefixes on filenames** (`01_setup.md`, `02_deploy.md`, …), in this
directory or its subdirectories. A number prefix encodes reading order into
the filename itself, so inserting a doc in the middle means renaming every
file after it — and every link, cross-reference, and bookmark to those files
breaks at the same time. The table above already carries reading order *and*
the reason for it, which a bare number never does. Name files after what they
cover.

---

## Community

[`community.md`](community.md) — Discussions categories and where to ask what.
