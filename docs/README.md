# OpenInspection documentation

Start here. Pick the section that matches what you are trying to do.

| I want to… | Go to |
|---|---|
| Run OpenInspection for my own inspection business | [`self-host/`](#self-hosting) |
| Use the product day to day | [`user-guide/`](#using-the-product) |
| Change the code or send a pull request | [`develop/`](#developing) |
| Look up an endpoint, a table, a role | [`reference/`](#reference) |
| Understand why something works the way it does | [`concepts/`](#concepts) |
| Review how personal data is handled | [`compliance/`](#compliance) |

---

## Self-hosting

Running the engine on your own Cloudflare account.

| Doc | Topic |
|---|---|
| [`self-host/deploy.md`](self-host/deploy.md) | First-time production deploy — one-click, CLI, and what gets provisioned |
| [`self-host/upgrade.md`](self-host/upgrade.md) | Move an existing deployment to a newer release (forward-only) — including the one-time reconcile a rebuilt baseline needs |
| [`self-host/email-providers.md`](self-host/email-providers.md) | Transactional email adapters, platform-vs-own credentials (no SMTP) |
| [`self-host/sms-compliance.md`](self-host/sms-compliance.md) | Privacy/Terms pages, carrier registration, TCPA/CTIA wording |
| [`self-host/video-backend.md`](self-host/video-backend.md) | R2 (default, free) vs Cloudflare Stream |
| [`self-host/rotate-secrets.md`](self-host/rotate-secrets.md) | Rotating the ES256 JWT keyring without invalidating live sessions |
| [`self-host/connecting-claude-mcp.md`](self-host/connecting-claude-mcp.md) | Connecting Claude or another MCP client over OAuth 2.1 |

## Using the product

| Doc | Topic |
|---|---|
| [`user-guide/README.md`](user-guide/README.md) | The inspection workflow end to end — create, inspect, publish, deliver, get paid |

> Illustrated, step-by-step versions of these walkthroughs (with screenshots)
> live at <https://inspectorhub.io/docs>. The text here is complete on its own;
> the hosted copy adds the pictures.

## Developing

| Doc | Topic |
|---|---|
| [`develop/setup.md`](develop/setup.md) | Run it locally, the command table, how to add a page or an endpoint |
| [`develop/architecture.md`](develop/architecture.md) | Single-worker architecture, request flow, module map, cost model |
| [`develop/testing.md`](develop/testing.md) | Four suites, where a spec lives, how to run each one |
| [`develop/design-system.md`](develop/design-system.md) | Tokens, `packages/shared-ui`, dark mode, the `lint:ds` gate |
| [`develop/logo-design.md`](develop/logo-design.md) | Logo construction and brand asset spec |
| [`develop/conventions/route-metadata.md`](develop/conventions/route-metadata.md) | Metadata every `createRoute()` must declare, and the gate that enforces it |
| [`develop/conventions/i18n-glossary.md`](develop/conventions/i18n-glossary.md) | One es-419 equivalent per term, enforced by `lint:i18n-glossary` |
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
