# Migrating Roles from Spectora / ISN to OpenInspection

## How OpenInspection Roles Work

OpenInspection uses **4 roles** — Owner, Manager, Inspector, Agent — each acting as a fixed permission template. In addition, there are **4 optional advanced toggles** you can flip per person:

- **Publish reports** — can the person publish a completed report to the client?
- **Schedule for others** — can the person book or reassign inspections for other inspectors?
- **Financial data** — can the person see pricing, invoices, and payment details?
- **Manage contacts** — can the person add, edit, or delete clients and agents?

Pick a role and you are ~90% configured; the toggles cover the remaining edge cases. Large or commercial jobs that require multiple inspectors are handled by **assigning multiple inspectors to one inspection** (the assignment axis), not by creating special roles.

---

## The 4 Roles

| Role | Who it is for |
|---|---|
| **Owner** | Account holder — billing + everything. |
| **Manager** | Back-office: team management, settings, scheduling, all inspections. |
| **Inspector** | Conducts inspections, edits and publishes reports. |
| **Agent** | External real-estate agent — read-only access to their own orders. |

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
