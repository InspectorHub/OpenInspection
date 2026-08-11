# User guide

How to run inspections in OpenInspection, from the booking request to the paid
invoice. Written for the people doing the work — inspectors, schedulers, and
whoever administers the company.

This page describes a **standalone** (self-hosted, single-tenant) install, which
is the default. A few capabilities exist only on a `saas` deployment; they are
called out inline and listed in
[`reference/deployment-modes.md`](../reference/deployment-modes.md).

> Illustrated versions of these walkthroughs, with a screenshot per step, are at
> <https://inspectorhub.io/docs>. Everything here is complete without them.

---

## First run

After deploying (see [`self-host/deploy.md`](../self-host/deploy.md)), open
`/setup` and enter your `SETUP_CODE` to create the first account. That account
gets the **Owner** role.

`/setup` is gated on the `SETUP_CODE` secret alone. If the secret is unset the
endpoint refuses to proceed, so a freshly deployed Worker cannot be claimed by
whoever finds the URL first. The CLI deploy prints a generated code if you did
not set one; the one-click wizard asks for it as a secret field.

Once an account exists, `/setup` returns `already_initialized`. Everyone else
joins by invitation (Settings → Team), which sends them to `/join/<token>`.

---

## The three status axes

An inspection carries three independent statuses. Most confusion about "where is
this job" comes from conflating them, so they are worth learning first.

| Axis | Column | Values |
|---|---|---|
| **Appointment** — is it on the calendar, did it happen | `status` | `requested` → `scheduled` → `confirmed` → `completed`, plus `cancelled` |
| **Report** — how far the write-up has got | `report_status` | `in_progress` → `submitted` → `published` |
| **Payment** — how much of the money arrived | `payment_status` | `unpaid` → `partial` → `paid` |

They move independently: a `completed` inspection can still be `in_progress` and
`unpaid`, and a report can be `published` before payment if you have not gated it.

---

## The core workflow

### 1. The job arrives

Two ways in:

- **You create it** — `/inspections` → **New Inspection**, or go straight to
  `/inspections/new`. Enter the address, the client, the services, the
  template, the inspector, and the date.
- **A client books it** — your public booking page at `/book/<company-slug>`
  creates the inspection as `requested`. Bookings auto-assign the first
  available qualified inspector; you can optionally let the client pick one
  (Settings → Online Booking → booking policies). The same page is embeddable
  in your own site at `/embed/<company-slug>`, and is protected by Turnstile
  when `TURNSTILE_SECRET_KEY` is set.

Address autocomplete on both surfaces needs `GOOGLE_PLACES_API_KEY`. Without it
the field degrades to plain text and the client can still type an address.

### 2. Everything about one job lives on its hub

`/inspections/:id` is the hub — the answer to "where does this job stand". It
carries the schedule, the parties, the agreement state, the report card, the
payment state, and the lifecycle actions (cancel, restore).

Two things sit next to it rather than on it:

- `/inspections/:id/edit` — the full-screen editor (below)
- `/inspections/:id/repair-requests` — the Repair Request Log, every request
  built for this job with its items

### 3. Agreements get signed before the work

Agreement templates live in the library (`/library/agreements`). An inspection
can carry more than one agreement and more than one signer per agreement —
signer roles are `client`, `co_client`, `agent`, `other`.

The client signs at `/agreements/sign/<tenant>/<token>` from a link you send.
Each signature is recorded in a hash-chained Ed25519 audit log (ESIGN Act +
UETA), and produces a server-rendered signed PDF plus a Certificate of
Completion. Anyone can check a signature at `/v/<token>` (the QR code printed on
the PDF), or offline at `/verify` — the offline verifier deliberately does not
call your server, so a signature stays checkable independently of you.

Inspectors can optionally pre-sign.

### 4. Inspecting — the editor

`/inspections/:id/edit` is a full-screen three-pane editor: sections on the left,
items in the middle, the item's detail on the right. It is built to be driven
from the keyboard.

| Key | Does |
|---|---|
| `1`–`5` | Rate the current item |
| `0` | Clear the rating |
| `N` | Mark N/A |
| `J` / `K`, `↓` / `↑`, `Enter` / `Shift+Enter` | Next / previous item |
| `/` | Open the canned-comment library |
| `;` | Open snippets |
| `T` | Tag picker |
| `P` | Add a photo |
| `R` | Clone the last entry |
| `F` | Toggle item fullscreen |
| `G` then a digit | Jump to that section |
| `G` then `S` | Section picker |
| `Z` | Toggle speed mode |
| `?` | Show the shortcut cheatsheet |
| `⌘S` / `Ctrl+S` | Save |
| `⌘D` / `Ctrl+D` | Save the current text as a snippet |
| `⌘⇧P` / `Ctrl+Shift+P` | Publish |

Single-key shortcuts only fire when you are not typing in a field.

The `⌘K` command palette belongs to the workspace chrome (the sidebar layout),
not to the editor — inside the editor `K` moves to the previous item.

Other editor facts worth knowing:

- **Photos** upload to R2 and attach to the item you are on.
- **Offline** — the app is a PWA. Edits and photo uploads queue in the browser
  and sync when the connection returns.
- **Simultaneous editing** — inspection results are a Yjs CRDT hosted in a
  Durable Object, so two inspectors can work the same job at once and the edits
  merge. If the `INSPECTION_DOC` binding is absent the collab routes return 501
  and you fall back to single-client editing with no realtime sync. See
  [`concepts/collab-editing.md`](../concepts/collab-editing.md).
- **AI assistance** needs `AI_MODEL` plus a credential. On a standalone install
  the credential is the one you store in Settings → Advanced → AI; there is no
  platform-provided key. With no model set, AI features fail closed with a 503
  rather than guessing a model.

### 5. Publishing

Publish creates a **versioned report snapshot** — the report the client sees is
that snapshot, not the live editing state, so later edits cannot silently
rewrite what someone already read. Publishing needs the `publish` capability
(Owner, Manager, and Inspector have it by default; Agent never does).

The published report is at `/report/<tenant>/<id>`. `/report-view/<tenant>/<id>`
is the card-stack reading view, and `/version-diff/:id` shows what changed
between two versions.

You can require payment or a signed agreement before the report opens — that
gate lives at `/report-gate/<tenant>/<id>`.

### 6. Delivery and the client's own portal

Clients get a magic link into `/portal/<tenant>` — their own view listing their
inspections, with a per-job hub at `/portal/<tenant>/i/<inspectionId>` and
notification settings at `/portal/<tenant>/notifications`. The notification page
works signed out: it asks for an email and mails a one-time link back, without
revealing whether the address is known.

From the report, a client can build a **repair request** at
`/repair-builder/<tenant>/<id>` — picking the items they want addressed. What
they build lands in the Repair Request Log on the inspection, and a contractor
can be given a scoped view at `/repair-request/<shareToken>`.

### 7. Getting paid

Invoices are at `/invoices`; the client pays at `/invoice/:id` or through
`/checkout/<tenant>/<token>`.

Payments run on **your own Stripe account** — a tenant's stored key always beats
any deployment-level key, so a platform binding can never intercept your money.
QuickBooks Online sync is optional (Settings → Integrations → QuickBooks) and
requires `QBO_ENV` to be set explicitly: there is no default, because a guessed
Intuit host fails in a way that reads like a bad credential.

---

## Where everything lives

### Workspace

| Page | Path |
|---|---|
| Inspections (list, stats, filters) | `/inspections` |
| New inspection wizard | `/inspections/new` |
| Inspection hub | `/inspections/:id` |
| Editor (full screen) | `/inspections/:id/edit` |
| Repair Request Log | `/inspections/:id/repair-requests` |
| Calendar | `/calendar` |
| Dispatch board (day-centric) | `/calendar/dispatch` |
| Contacts | `/contacts`, `/contacts/:id` |
| Invoices | `/invoices` |
| Messages | `/messages` |
| Notifications | `/notifications` |
| Metrics | `/metrics` |
| Team | `/team` |

The dispatch board needs the `scheduleOthers` capability, enforced server-side.

### Library

`/library` is the hub for everything reusable across inspections.

| Page | Path |
|---|---|
| Templates | `/library/templates` |
| Canned comments | `/library/comments` |
| Repair items | `/library/repair-items` |
| Tags | `/library/tags` |
| Agreements | `/library/agreements` |
| Rating systems | `/library/rating-systems` |
| Defect categories | `/library/defect-categories` |
| Marketplace | `/library/marketplace` — **`saas` only**; returns 404 on a standalone install |

### Settings

`/settings` is the hub. The pages: profile, inspection, workspace, services,
communication (+ templates, and per-trigger template editing), automations,
data, compliance, account, advanced, integrations (+ QuickBooks), event types,
contractor types, inspection types, inspection roles, schedule, online booking,
billing, usage, security, connected apps.

**Billing** and **usage** are `saas` surfaces. A standalone install has no
billing and no seat or usage quota — you are the platform.

### Agent portal

Referral agents get their own account track and their own chrome:
`/agent-dashboard`, `/agent-inspectors`, `/agent-repair-items`,
`/agent-settings/profile`. They sign in at `/agent-login` (password or magic
link) and sign up at `/agent-signup`.

---

## Templates

An inspection form is a template, not a database table. Templates are edited at
`/templates/:id/edit`.

- **Nine item types** — `rich` (a rated item with three canned-comment tabs)
  plus `boolean`, `text`, `textarea`, `number`, `select`, `multi_select`,
  `date`, and `photo_only` for data points that are not rated. A rich item
  stores its rating on `result.rating`; the others store `result.value`.
- **Rating systems** are configurable (`/library/rating-systems`) — you are not
  stuck with 1–5.
- **Importing from Spectora** — paste a Spectora export into the Import
  Spectora action on the templates page. The importer maps Spectora's four
  buckets onto the three comment tabs and preserves identifiers, creating the
  template in one shot.

Template permissions are four separate capabilities, not one switch — see below.

---

## Roles and permissions

There are **four roles**: **Owner**, **Manager**, **Inspector**, **Agent**.
(There is no "Admin" role; the administrator tier is Owner + Manager.)

Layered on top are **nine capability toggles** you can flip per person:

| Capability | Owner | Manager | Inspector | Agent |
|---|:--:|:--:|:--:|:--:|
| `publish` — publish a report | ✅ | ✅ | ✅ | ❌ |
| `scheduleOthers` — schedule other people | ✅ | ✅ | ❌ | ❌ |
| `financial` — see and act on money | ✅ | ✅ | ❌ | ❌ |
| `manageContacts` — edit the contact book | ✅ | ✅ | ❌ | ❌ |
| `viewCommunication` — see what was sent to whom | ✅ | ✅ | ✅ | ❌ |
| `templateCreate` | ✅ | ✅ | ✅ | ❌ |
| `templateEdit` | ✅ | ✅ | ✅ | ❌ |
| `templateDelete` | ✅ | ✅ | ❌ | ❌ |
| `templateImport` | ✅ | ✅ | ✅ | ❌ |

The columns are defaults; every cell except the Owner and Agent columns can be
overridden per person. **Owner is never reducible and Agent is never elevated** —
those two are pinned in code, not merely defaulted.

The Agent column is all ❌ because this table is about administering *your
company*, and a referral agent administers none of it. What an agent can
actually do — receive the report, retrieve it later, hold a login, see their own
jobs, reach the repair list — is a second, separate capability set attached to
their role on each inspection. See [`reference/roles.md`](../reference/roles.md)
for both axes side by side.

Why template permissions are four verbs rather than one switch: they are not
equally recoverable. `templateEdit` stays on for inspectors so fixing a typo does
not need an owner, even though it is the irreversible one (there is no template
version history to roll back to — the audit trail records *that* a change
happened, not its content). `templateDelete` is off by default because its repair
cost is rebuild-from-scratch, and it refuses at every reference anyway.

Full mapping from Spectora / ISN roles: [`reference/roles.md`](../reference/roles.md).

---

## What a standalone install does not have

Not disabled — absent. There is no platform behind a self-hosted deploy.

| Not present | Why |
|---|---|
| Billing, seat quota, usage quota | You run the deployment; there is nobody to bill you |
| Managed AI credentials | Use your own key in Settings → Advanced → AI |
| Managed SMS compliance (10DLC brand/campaign filing) | Nobody can file on your behalf — see [`self-host/sms-compliance.md`](../self-host/sms-compliance.md) |
| Content marketplace | The catalogue is curated first-party; the route 404s rather than showing an empty shelf |
| Workspace switching | One fixed tenant holds all your data |

Conversely, standalone has things `saas` does not: the `/setup` wizard, a local
login form, and env-driven branding (`APP_NAME`, `PRIMARY_COLOR`) instead of
per-tenant branding config.

Capability-by-capability: [`reference/deployment-modes.md`](../reference/deployment-modes.md).
