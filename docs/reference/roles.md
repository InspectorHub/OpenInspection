# Roles and capabilities

The role model, and how to map a Spectora or ISN setup onto it.

## The four roles

`owner`, `manager`, `inspector`, `agent` — defined once in
`server/lib/auth/roles.ts`, which every Zod enum, Drizzle column, guard and UI
label derives from. There is **no "Admin" role**; the administrator tier is
Owner + Manager (`isAdminRole`).

| Role | Who it is for |
|---|---|
| **Owner** | Account holder — everything, plus billing on a `saas` deployment. |
| **Manager** | Back-office: team management, settings, scheduling, all inspections. |
| **Inspector** | Conducts inspections, edits and publishes reports. |
| **Agent** | External real-estate agent — their own orders, read-only. |

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

Nine, flippable per person on top of the role default
(`TOGGLEABLE` in `server/lib/auth/capabilities.ts`):

| Capability | Owner | Manager | Inspector | Agent |
|---|:--:|:--:|:--:|:--:|
| `publish` — publish a report to the client | ✅ | ✅ | ✅ | ❌ |
| `scheduleOthers` — book or reassign for other inspectors | ✅ | ✅ | ❌ | ❌ |
| `financial` — pricing, invoices, payment detail | ✅ | ✅ | ❌ | ❌ |
| `manageContacts` — add/edit/delete clients and agents | ✅ | ✅ | ❌ | ❌ |
| `viewCommunication` — see what was sent to whom | ✅ | ✅ | ✅ | ❌ |
| `templateCreate` | ✅ | ✅ | ✅ | ❌ |
| `templateEdit` | ✅ | ✅ | ✅ | ❌ |
| `templateDelete` | ✅ | ✅ | ❌ | ❌ |
| `templateImport` | ✅ | ✅ | ✅ | ❌ |

**Owner is never reducible and Agent is never elevated.** Both columns are
pinned in code (`FIXED`), not merely defaulted — an override row cannot demote
an owner, and it cannot promote a referral agent into staff. That guarantee is
the whole reason the agent column exists here: an outside party holds a login to
your workspace, and this is where the ceiling on that login is nailed down.

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
own chrome, and four pages — `/agent-dashboard`, `/agent-inspectors`,
`/agent-repair-items`, `/agent-settings/profile` — scoped to the inspections
they are attached to. Referral tracking runs off that attachment.

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
| Inspector + Access Financial Data | Inspector | Financial data = **on** |
| Inspector + Schedule All | Inspector | Schedule for others = **on** |
| Support Staff (with or without Admin) | Manager | Financial data = **off** if it was off in Spectora |
| Organization Manager | Owner | — |

---

## Coming from ISN

| ISN setup | OpenInspection role | Advanced toggles |
|---|---|---|
| Inspector | Inspector | Financial data = **on** if "view fees" was enabled in ISN |
| Standard User / Office Administrator | Manager | Trim with the toggles as needed |
| Account owner | Owner | — |

---

## A Note on Guest / Temporary Access

Neither Spectora nor ISN has a dedicated "guest" or temporary-login role, so there is nothing to migrate in that category. To bring on temporary help, add the person as an Inspector and remove them when the work is done.
