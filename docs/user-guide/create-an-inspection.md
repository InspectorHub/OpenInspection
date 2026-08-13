# Creating an inspection

How a job gets into the system — you create it, or a client books it.

> Part 1 of 7 in the inspection workflow. Illustrated version with a
> screenshot per step: <https://inspectorhub.io/docs/create-an-inspection>

There are two doors, and they produce the same thing: an inspection row that
everything else in this guide series hangs off. Which door was used shows up in
one place only — the appointment status. You create it, it starts `scheduled`;
a client books it, it starts `requested` and waits for you to confirm.

## Creating one yourself

`/inspections` is the workspace list and the place you start from.

<!-- shot: inspections-list | The Inspections list, with the New Inspection button in the header -->

**New Inspection** opens a four-step wizard at `/inspections/new`. It is a
separate page rather than a modal because it is long enough to lose work in,
and a page can be reloaded, linked to, and left.

### 1. Property

Where the inspection happens.

<!-- shot: wizard-property | Step one of the wizard, asking for the property address -->

The address field autocompletes when `GOOGLE_PLACES_API_KEY` is configured. It
is optional: with no key the endpoint returns `{ data: [], reason: 'NO_API_KEY' }`
and the field quietly becomes a plain text box you can type into. Nothing is
blocked, and nothing tells the client they are missing anything.

### 2. People

Who the inspection is for.

<!-- shot: wizard-people | Step two, collecting the client's name and contact details -->

A name is required as soon as an email or a phone number is filled in —
a contact that can be written to but not addressed is not a contact.

### 3. Services

What is being inspected, and against which checklist.

<!-- shot: wizard-services | Step three, choosing the services and the template -->

The template you pick here is snapshotted onto the inspection at creation. Later
edits to the library template do not reach back into a job already created —
that is deliberate, and it is what lets you improve a template without changing
what an inspector is halfway through recording.

### 4. Confirm

The last screen states back everything the first three collected, and only then
offers **Create Inspection**.

<!-- shot: wizard-confirm | The confirmation step, summarising the inspection before it is created -->

Create is guarded against double submission. It matters more here than it looks:
the wizard is four steps long, the button sits at the end of them, and an
impatient second click used to produce a second identical inspection.

## Letting a client book one

Your company has a public booking page at `/book/<company-slug>`.

<!-- shot: public-booking | The public booking page a client sees, with no staff chrome -->

A booking creates the inspection as `requested` and auto-assigns the first
available qualified inspector. You can let the client choose their inspector
instead — Settings → Online Booking → booking policies. Per-inspector deep links
(`/book/<company-slug>/<inspector-slug>`) still work and pre-select that person.

The same page embeds in your own site at `/embed/<company-slug>`, without the
surrounding layout, so it drops into an existing page rather than replacing it.

When `TURNSTILE_SECRET_KEY` is set, `POST /api/book` enforces a Turnstile
challenge. Leave it unset only in local development.

---

Next: the job exists. [The inspection hub](the-inspection-hub.md) is where it
lives from here.

---

[All guides](README.md) · [The inspection hub](the-inspection-hub.md) →
