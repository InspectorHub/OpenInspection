# Roles and capabilities

The role model, and how to map a Spectora or ISN setup onto it.

## The five roles

`owner`, `manager`, `inspector`, `staff`, `agent` — defined once in
`server/lib/auth/roles.ts`, which every Zod enum, Drizzle column, guard and UI
label derives from. There is **no "Admin" role**; the administrator tier is
Owner + Manager (`isAdminRole`).

| Role | Who it is for |
|---|---|
| **Owner** | Account holder — everything, plus billing on a `saas` deployment. |
| **Manager** | Back-office: team management, settings, scheduling, all inspections. |
| **Inspector** | Conducts inspections, edits and publishes reports. |
| **Staff** | Office role: books and schedules the order. Creates, copies and re-inspects inspections, reschedules and reassigns them, edits the order fields, cancels an unpaid inspection that has not started, manages contacts and messages, and sends a report that is already published. Does not delete inspections, does not publish or sign, does not write report content, and cannot be assigned as the inspector on a job. May use the native app. |
| **Agent** | External real-estate agent — their own orders, read-only. |

`staff` is evaluated at the inspector tier by `requireRole`, so every gate that
admits an inspector admits staff and every gate that does not keeps staff out;
what differs is expressed as capabilities and as a few explicit refusals.
Staff work the order, never the inspection. Each field an inspection accepts on
update is classified as an order field or an inspection-side field
(`server/lib/inspection/order-fields.ts`; a spec fails when a field is
unclassified). Staff may create, copy and re-inspect an inspection and change
order fields (date, assigned inspector, client and property details, the
agreement and payment requirements). The requirements can be switched on by
staff and never off. Inspection-side fields, unknown fields and any status
change out of `completed` are refused. Once an inspection has started (its
report is past in-progress, the visit is completed, or results have been
entered), staff cannot change its inspector, address or date, through the update
route, the schedule route or the bulk assign action. Writing the order needs
`scheduleOthers` or a place on the job, and is audited as
`inspection.order_updated`. Staff cancel only an unpaid inspection that has not
started (a held deposit or ledger payment also blocks it) and restore one only
when its status before the cancellation is known and was not completed;
owners and managers do the rest. Staff are never offered as an inspector
(booking, availability, the assignee picker, service qualification, pay rules).
Seat accounting is decided in one function, `countsTowardSeatQuota`
(`server/lib/auth/roles.ts`); staff do not hold a seat.

Large or commercial jobs needing more than one inspector are handled by
**assigning multiple inspectors to one inspection** (the assignment axis, `lead`
/ `helper`), not by inventing a role.

## Two capability axes, not one

This is the part that surprises people, so read it before the tables.

**Staff capabilities** answer *"how much of the company may this person
administer?"* They are keyed on the role above. **Contact-role capabilities**
answer *"what may this party to an inspection see and do?"* They are keyed on a
different enum — `RoleKind` (`client` / `agent` / `other`) — and are attached to
a person's role on a specific inspection.

An agent sits on both. As **staff** they administer nothing, which is why every
cell in the next table is a ❌ and why that is pinned rather than merely
defaulted. As a **contact role** they receive the report, can hold an account,
and get a portal. Reading only the staff table makes the agent role look empty;
it is not, it is just scored on the other axis.

### Staff capabilities

Twelve, flippable per person on top of the role default
(`TOGGLEABLE` in `server/lib/auth/capabilities.ts`):

| Capability | Owner | Manager | Inspector | Staff | Agent |
|---|:--:|:--:|:--:|:--:|:--:|
| `publish` — publish a report to the client | ✅ | ✅ | ✅ | ❌ (fixed) | ❌ |
| `scheduleOthers` — book or reassign for other inspectors | ✅ | ✅ | ❌ | ✅ | ❌ |
| `inspectionFees` — the money on one inspection: price, deposit, service lines, cancellation fee | ✅ | ✅ | ✅ | ✅ | ❌ |
| `companyFinance` — company-wide money: invoices and payments, price lists and pay rules, earnings, Stripe, QuickBooks, fee policies | ✅ | ✅ | ❌ | ❌ | ❌ |
| `manageContacts` — add/edit/delete clients and agents | ✅ | ✅ | ❌ | ✅ | ❌ |
| `viewCommunication` — see what was sent to whom | ✅ | ✅ | ✅ | ✅ | ❌ |
| `templateCreate` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `templateEdit` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `templateDelete` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `templateImport` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `deleteInspection` — permanently delete an inspection (an inspector only one they lead) | ✅ | ✅ | ✅ | ❌ | ❌ |
| `editReports` — write report content: results, media, units, compliance and statutory inputs, cost items | ✅ | ✅ | ✅ | ❌ | ❌ |

`editReports` is enforced by one path-scoped guard (`server/lib/inspection/report-authoring-guard.ts`)
that refuses every write to a report-authoring route, the live collaborative
editor and the offline package import without the capability. Reading the same
data, publishing and sending are not affected, so a staff member can still open
a report to send it. A spec fails when a mutating route under an
inspection is neither guarded nor listed as not report content. Withdrawing the
capability does not close a collaborative-editing socket that is already open.

The guard also covers the inspector's signature (`POST /api/inspections/:id/inspector-signature`,
which is stored inside the report's results data and audited as
`inspection.inspector_signature.update`, without the image), submitting a report for
review, the property-facts card (`PATCH` and the autofill `POST`; the `GET` stays readable)
and approving concierge suggestions. Staff, and an inspector whose `editReports` was
withdrawn, are refused all of these.

Staff cannot publish, unpublish or return a report to draft: `publish` is pinned off
for staff and no per-person override can turn it on (only that one switch is pinned).
Publishing with the auto-signature stamps the inspector's stored signature only when
the publisher is that inspector or an owner or manager, and the stored record names
who published it and which inspector it represents. A helper, staff member or other
inspector publishes without a stamp. Any existing staff member who could publish
before loses that access.

The AI helper routes (comment assist, auto summary, suggest comment, comment edit,
reviews) need `editReports` on top of the role.

On the order side staff can still confirm an inspection that is not completed, manage
agreement requests and client documents, send a published report, and request payment
(below), each subject to `scheduleOthers` or a place on the job where the route says so.

Requesting payment (`POST /api/invoices/request-payment`, the hub's "Request payment"
button) needs the `inspectionFees` capability on top of the role. Owners, managers,
inspectors and staff hold it by default, so nothing changes unless it was switched off
for someone, who is then refused. The hub response carries the invoice's tokenized pay
link (`invoice.payUrl`) only for callers who hold `companyFinance`; everyone else gets
`null`, and no link is minted for them.

**Owner is never reducible and Agent is never elevated.** Both columns are
pinned in code (`FIXED`), not merely defaulted — an override row cannot demote
an owner, and it cannot promote a referral agent into staff. That guarantee is
the whole reason the agent column exists here: an outside party holds a login to
your workspace, and this is where the ceiling on that login is nailed down.

### Who can grant what

An owner can give any role and any switch. A manager can give at most what the
manager holds; anything higher needs an owner.

- **Roles.** A manager can invite someone as, or change a member to, manager,
  inspector or staff. Only an owner can create or promote an owner, and only an
  owner can change an owner's role or switches. A manager cannot change their
  own role or their own switches.
- **Switches.** A manager can turn a switch on for someone else only if the
  manager has it too, using the manager's own resolved set (role defaults plus
  that manager's own overrides). This counts what a role gives by default as well
  as the switches set by hand: a manager without Company finance cannot make
  someone a manager, because the manager role carries it. Turning a switch off is
  always allowed, and a member who already holds a switch keeps it when a manager
  edits something else.
- **Refusals.** The server refuses with `403` and the code `CAPABILITY_CEILING`
  (a switch beyond the manager's own; `details.capabilities` names them),
  `ROLE_CEILING` (a role above manager) or `SELF_PERMISSION_CHANGE`. One check
  covers inviting, editing a member and member rows in a bulk import. Each change
  is recorded as `user.update` or `user.invite`, and each refusal as
  `user.grant_refused`.
- **The Team page** shows the same limits: switches a manager cannot grant are
  disabled with "Only an owner can grant this.", and roles that would grant one
  are not selectable.

### Money visibility

Two capabilities cover every place an amount is read or written, not only the
invoice pages. The mechanism is the same everywhere
(`server/lib/auth/money-access.ts`, `server/lib/auth/money-redaction.ts`).

| Capability | What it covers | Default |
|---|---|---|
| `inspectionFees` | The money on an inspection you can open: its price, deposit, service lines, the price list used to price a line, and the cancellation fee. | Owner, manager, inspector and staff on (staff read prices; a staff member does not set service or re-inspection prices and does not record cash deposits); agent off |
| `companyFinance` | Money that spans inspections or belongs to the company: invoices and payment records, writing the price list and pay rules, pay splits and the payroll export, earnings and the metrics aggregates, Stripe and QuickBooks, a contact's lifetime revenue, the cancellation and deposit policies, and the data exports. | Owner and manager on; inspector, staff and agent off |

The rule of thumb: a figure on one inspection you can open is `inspectionFees`;
anything summed across inspections, any price list or rule, the ledger, the
accounting and payment integrations and the company's fee policies are
`companyFinance`. Holding one never grants the other. The owner is pinned on for
both and an agent pinned off for both.

**Reads.** A caller without the capability for a field gets the same response
with that money field **absent**: the key is deleted, never zeroed, because a
zero would read as a true figure. A field counts as money when it is `price` or
ends in `Cents`. A response that mixes the two kinds is projected field by field:
the hub returns the inspection's price lines under `inspectionFees` and its
invoice block under `companyFinance`, and a contact detail returns each
inspection's price under `inspectionFees` and the revenue totals under
`companyFinance`. The service catalogue is readable with `inspectionFees`, as are
event types and their default prices, so a line or a visit can be priced; the
company settings' cancellation and deposit policies, the full JSON export and the inspections CSV export (price column
omitted from header and every row) need `companyFinance`. The unauthenticated
company calendar feed carries no fee for anyone, because one URL cannot tell who
is reading it.

**Writes.** A request body that sets or changes a money field is refused with
`403` and the code `FINANCIAL_REQUIRED`; `details.field` names the first field
refused and `details.capability` the capability it needs (`inspectionFees` or
`companyFinance`). The code keeps its name so clients that match on it keep
working. Prices, deposits and per-line overrides on an inspection need
`inspectionFees`; the catalogue price (`defaultPriceCents`) and the cancellation
and deposit policies need `companyFinance`. A body touching both is refused for
the capability the caller lacks. Only a change is refused: the settings form
forwards every field it holds, so resending the stored price is accepted.
Creating or clearing a value counts as a change. Invoice, payment, payout,
pay-rule, price-list write, discount-code and Stripe Connect routes require
`companyFinance` outright, as does every QuickBooks route; the service lines on
an inspection require `inspectionFees`.

**Cancelling.** A caller without `inspectionFees` can cancel an inspection that
has no payment, fee or refund attached. When money is involved the cancel is
refused with `FINANCIAL_REQUIRED` and the answer carries no amount; the quote
endpoint returns only `requiresFinancial` and a yes/no `moneyInvolved`.

**Overrides saved before the split.** Earlier versions stored one `financial`
override. A stored `financial` value is read as the value of both new keys; a new
key stored beside it wins. The old key is only ever read: the team page and
invitations write the new keys, and no migration rewrites existing rows.

**What is deliberately not hidden.** `paymentStatus` is a status, not an amount,
and stays visible. Repair-estimate figures (cost items, repair requests) belong
to the client's repair request rather than to company revenue and are not
redacted. The client-facing token pages show a client their own invoice and are
out of scope. Which endpoints carry money, and how each protects it, is
registered in `tests/unit/platform/money-surface-registry.ts`, together with the
capability each one needs; a spec walks the OpenAPI document and fails when an
endpoint that can return money is missing from that list or names a capability
its route does not wear.

### Requests without a session, and agent sessions

Every path under `/api/` is refused without a session (`401`), in every deployment mode, unless it is public by design: booking, the token-link tracks (report, agreement, checkout, invoice, repair builder), sign-in and password flows, webhooks, status, and similar. The list lives in `server/lib/auth/public-paths.ts` and `server/lib/auth/api-access-policy.ts`, each exception with a one-line reason, and a spec walks every mounted route to prove a new one is either listed or refused. This matters most for a single-tenant deployment, where the tenant is resolved from configuration rather than from the session.

An agent session is a global account with no company context. It may use only the agent surface (`/api/agent/…`, agent signup, account export and deletion, `/api/auth/me`, `/api/auth/logout` and `/api/session/…`) and receives `403` on every other `/api/` path. The referral leaderboard (`GET /api/agent/leaderboard`, which lists referring agents' names, agencies and emails) is limited to owner and manager.

### Acting on an inspection that is not yours

Several actions on an inspection depend on how the caller works it. "On the inspection" means the roster (lead or helper) or being the inspector named on it. Owner and manager always qualify.

| Action | Who |
|---|---|
| Change the **date** (`PATCH /api/inspections/:id`, `PATCH /api/inspections/:id/schedule`) | anyone on the inspection; otherwise `scheduleOthers` |
| Change **who works it** (assignee, lead or helpers) | `scheduleOthers` |
| **Delete** it | its lead; helpers cannot; otherwise `scheduleOthers` |
| Send the report (`send-report-pdf`), email or mint an agent link (`share-agent`, `agent-token`), change its report-link expiry, send a text (`send-sms`), message its client | anyone on the inspection; otherwise `scheduleOthers` |

Sending or sharing a report additionally requires the report to be published, at most 10 recipients that are people already on the inspection (each listed once), and at most three sends of the same inspection to the same address per hour.

**Reading is not narrowed.** Message threads, the thread list and message attachments remain readable by every staff role across the company, as do inspections themselves; opening a thread clears its unread counts only for the people who work it. Per-inspector read visibility is a separate decision and is not part of these rules.

**The messaging rule is a speed bump, not a boundary.** An inspector can add a contact to an inspection they work and then message that contact, so the rule stops accidental and casual cross-messaging, not a determined colleague. Treat it as a guard against mistakes.

### Contact-role capabilities

Five, keyed on `RoleKind` and overridable per role profile
(`CONTACT_BITS` in `server/lib/people/capabilities.ts`):

| Capability | client | agent | other |
|---|:--:|:--:|:--:|
| `receivesReport` — is sent the report | ✅ | ✅ | ✅ |
| `selfRetrieveReport` — can fetch it back themselves later | ✅ | ✅ | ❌ |
| `canHaveAccount` — may hold a login rather than only a token link | ❌ | ✅ | ❌ |
| `showsInAgentPortal` — the job appears in that agent's own list | ❌ | ✅ | ❌ |
| `canAccessRepairList` — the buyer's repair-request list | off | off\* | off |

\* The stored default is `off`, but the effective value is the **stricter** of
this bit and the tenant's `agentRepairAccess` policy (Settings → Inspection),
which defaults to `readwrite`. So an agent's repair-list access is a company
setting first and a per-person exception second.

An unknown `RoleKind` fails closed — no report, no account — rather than
returning `undefined` and granting by accident.

### What the agent role actually gets

Concretely, from the two tables plus the routes: their own sign-in
(`/agent-login`, password or magic link) and sign-up (`/agent-signup`), their
own chrome, and five pages under the agent layout — `/agent-dashboard`,
`/agent-inspectors`, `/agent-repair-items`, `/agent-settings/profile` and
`/agent-settings/legal` (their own terms-acceptance record) — scoped to the
inspections they are attached to. Referral tracking runs off that attachment.
Two more sit outside that layout on purpose: `/agent-accept-terms`, which the
layout's own loader redirects a gated agent to, and `/agent-logout`, which ends
the session on the agent sign-in page rather than the staff one.

> There are more role-shaped enums in this codebase than these two (assignment
> is `lead`/`helper`, agreement signers are `client`/`co_client`/`agent`/`other`,
> and so on). Before assuming a role means what its name suggests, find the enum
> it comes from.

Template permission is four verbs rather than the single "Add/Edit Template"
switch Spectora ships, because the four are not equally recoverable. `templateEdit`
is the irreversible one — there is no template version history, and the audit
trail records *that* a change happened, not the content to roll back to — yet it
stays on for inspectors so fixing a typo does not need an owner. `templateDelete`
is off by default because its repair cost is rebuild-from-scratch; it also
refuses at every reference.

The same three verbs guard the comment (repair item) library. Adding an entry
needs `templateCreate`, changing one needs `templateEdit`, and deleting one needs
`templateDelete`; reading the library needs only a staff role, because the editor
uses it. With the defaults above, an inspector can add and edit library entries
but cannot delete them unless an owner switches `templateDelete` on for them.

Be precise about which endpoints that covers. Repair items (`/api/recommendations`)
are gated by `templateCreate`, `templateEdit` and `templateDelete`, and the Repair
Items page hides its Add, Edit and Delete controls when the signed-in user lacks the
matching capability. The canned-comment endpoints under `/api/admin/comments`
(create, update, delete) are **not** capability-gated: they stay owner and manager
only, whatever the template capabilities say. Reading either library needs only a
staff role.

Removing a team member asks what becomes of their open inspections (requested,
scheduled or confirmed, with the report not yet published). `DELETE
/api/team/members/:id` takes `reassignTo=<user id>` (an active owner, manager or
inspector of the same company) or `unassign=true`; with neither, and open
inspections present, it answers `409 MEMBER_HAS_OPEN_INSPECTIONS` with
`details.openInspections` and changes nothing. The reassignment and the removal
are applied together or not at all. Completed, cancelled and published
inspections keep their original inspector, and no inspection is ever deleted.
The removal is recorded as a `user.removed` audit entry with the counts.

Pick a role and you are ~90% configured; the toggles cover the rest.

> Gating on "is an admin" when you mean "may manage contacts" is how a per-user
> override gets silently ignored. Reach for the capability whenever one exists
> for what you are guarding.

---

## Coming from Spectora

| Spectora setup | OpenInspection role | Advanced toggles |
|---|---|---|
| Inspector | Inspector | — |
| Inspector + Trainee | Inspector | Publish reports = **off** (requires senior review before delivery) |
| Inspector + Access Financial Data | Inspector | Company finances = **on** |
| Inspector + Schedule All | Inspector | Schedule for others = **on** |
| Support Staff (with or without Admin) | Manager | Company finances = **off** if it was off in Spectora |
| Organization Manager | Owner | — |

---

## Coming from ISN

| ISN setup | OpenInspection role | Advanced toggles |
|---|---|---|
| Inspector | Inspector | Inspection fees = **on** (the inspector default); Company finances = **on** only if "view fees" was enabled in ISN and the person needs the company ledger |
| Standard User / Office Administrator | Manager | Trim with the toggles as needed |
| Account owner | Owner | — |

---

## A Note on Guest / Temporary Access

Neither Spectora nor ISN has a dedicated "guest" or temporary-login role, so there is nothing to migrate in that category. To bring on temporary help, add the person as an Inspector and remove them when the work is done.
