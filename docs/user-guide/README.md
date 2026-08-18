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

After deploying (see [`operate/deploy.md`](../operate/deploy.md)), open
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

## The inspection workflow

Seven pages, in the order a job moves through them. Each one is complete on its
own; each has an illustrated copy at <https://inspectorhub.io/docs>.

| # | Guide | What it covers |
|---|---|---|
| 1 | [Creating an inspection](create-an-inspection.md) | You create it, or a client books it |
| 2 | [The inspection hub](the-inspection-hub.md) | Where one job lives |
| 3 | [Agreements and signatures](agreements-and-signatures.md) | Signing, and independently verifying |
| 4 | [The inspection editor](the-inspection-editor.md) | Recording the inspection |
| 5 | [Publishing a report](publishing-a-report.md) | The versioned snapshot |
| 6 | [Delivering the report](delivering-the-report.md) | The client portal and repair requests |
| 7 | [Invoicing and payments](invoicing-and-payments.md) | Getting paid |

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
| Managed SMS compliance (10DLC brand/campaign filing) | Nobody can file on your behalf — see [`operate/sms-compliance.md`](../operate/sms-compliance.md) |
| Content marketplace | The catalogue is curated first-party; the route 404s rather than showing an empty shelf |
| Workspace switching | One fixed tenant holds all your data |

Conversely, standalone has things `saas` does not: the `/setup` wizard, a local
login form, and env-driven branding (`APP_NAME`, `PRIMARY_COLOR`) instead of
per-tenant branding config.

Capability-by-capability: [`reference/deployment-modes.md`](../reference/deployment-modes.md).
