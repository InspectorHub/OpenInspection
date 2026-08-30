# FL Citizens Roof Inspection Form (RCF-1 03 25) — what this template does not fill in

`fl-citizens-roof-rcf-1.json` binds **33 of the 36 blanks** the published field map
(`server/lib/statutory/forms/fl-citizens-roof.ts`) names. This file is the other three,
and the four smaller gaps that sit behind the ones that ARE bound.

**It exists because a blank box cannot explain itself.** On a printed statutory form,
"we left this empty deliberately" and "we forgot" are the same picture. Every entry below
says which it is, and what would have to exist before it could be filled.

Measured 2026-08-30, against the authority's own PDF
(sha256 `96e1ad368c80915732bc8c6147839e1eff0828424c142566fde8a4ca22427025`) and the signed
candidate beside it (`checkedBy: Nathan`).

| | count |
|---|---:|
| blanks the field map names | 36 |
| bound by this template | 33 |
| **left unbound** | **3** |
| bindings naming a blank the form does not print | 0 |

---

## 1. The three unbound blanks

### `inspector_title` — page 2, the box printed `Title`

**No source anywhere in this repository.** `StatutoryInspectionField`'s own comment names
this box as one of two it deliberately excludes: a member that can never resolve is a
blank on an authority's form, which reads as an inspector who did not answer, so it is
left out of the closed list rather than added and hardwired to null.

**To close it:** a column holding the inspector's job title, then a new member on
`StatutoryInspectionField`, then `{ from: 'inspection', field: … }` here.

### `inspector_license_type` — page 2, the box printed `License Type`

**No source, and the nearest column is the wrong fact.** The form asks for a state licence
class; page 1 prints the three it accepts — *General, residential, building or roofing
contractor* · *Building code inspector* · *Florida-licensed home inspector*. The nearest
column this product has is an inspector credential's label, which holds an **association
certification** ("InterNACHI CPI"). Those are not the same thing, and answering a statutory
licence-type box from one would print something that looks right and is wrong.

`inspector_license_number` beside it IS bound, to `inspector_license`, because a licence
NUMBER is the fact that column actually holds.

**To close it:** a licence-class column distinct from the credential label.

### `inspector_signature_date` — page 2, the box printed `Date`

🔴 **No source, and the obvious substitute is wrong.** `inspection_date` is already on the
form, in page 1's *Date of Inspection*. Signing commonly happens days after the fieldwork,
so binding both boxes to one column would make one of the two dates false with nothing on
the page to say which. The candidate's own notes record that this field was RENAMED from
`inspection_date` to `inspector_signature_date` on 2026-08-30 to keep the two apart; binding
them back together would undo that rename in effect while leaving its name in place.

This box is not decorative. Page 1 prints the condition of acceptance verbatim:

> The form will not be accepted without the **dated** signature of one of the following
> appropriately licensed inspectors:

**To close it:** a signed-at timestamp on whatever records the inspector's signature for a
statutory form. See §2.1 — the same absence blocks the box beside it.

---

## 2. Gaps behind blanks that ARE bound

### 2.1 🔴 `inspector_signature` is bound, and this form still cannot be produced

`inspector_signature` binds `{ from: 'signature', scope: 'whole_form' }`, which is the only
route `binding-policy.ts` permits for a signature and the one `StatutoryValueSource`
documents: a signature resolves by reference at render time and never enters the collected
values.

**Nothing resolves that reference.** Measured 2026-08-30 by running the produce path
(`collectStatutoryValues` → `renderStatutoryForm`) over this template with a full set of
answers:

```
collector: 32 value(s) produced for 36 mapped field(s)
render: REFUSED
  statutory render: 2 required field(s) were never supplied: inspector_signature,
  inspector_signature_date.
```

Both halves of the map's `requiredFields` are unsuppliable — one because a signature
binding deliberately emits no key and no later step fills it in, the other for the reason
in §1. `placeSignature` / `refuseUnreadableSignature` in
`server/lib/statutory/signature-image.ts` exist and are complete; **no production code
calls either**, and `produce.service.ts` has no signature step between collecting the
values and rendering.

So this pack installs, the template asks every question the form asks, 32 answers reach the
page correctly — and the PDF endpoint refuses. That refusal is the right behaviour for the
state the product is in (a form nobody signed must not come out looking signed); what is
missing is the step that lets somebody sign it.

**Verified separately:** rendering the same 32 values with those two fields supplied by
hand produces a correct document. Both pages were rasterised and read against the published
form on 2026-08-30 — every value in its own blank, every mark inside its own printed box.
The two boxes that came out empty were `Title` and `License Type`, which is §1.

### 2.1a 🔴 The twelve questions in each roof column cannot be ANSWERED in the editor

Found by pressing the button, on 2026-08-30, and it is not this template's mistake — it is
the whole `item_attribute` route, which TREC's 15 attribute bindings share.

The inspection editor does not read the template snapshot for its items. It reads
`GET /api/inspections/:id/report-data`, whose projection type
(`server/services/inspection/report-schema-types.ts`) deliberately carries a handful of
keys and **not** `attributes` or `description` — a decision that is correct for a report
and is declared to `lint:item-key-parity` as such. `ItemAttributesPanel` renders only when
`item.attributes` is non-empty, and its `onItemAttribute` handler is wired in
`inspection-edit.tsx`, so the control is complete and simply never receives data.

Measured in Chrome on a real inspection created from this pack: the *Predominant Roof*
item shows its label, a Notes box and a Photos strip, and none of the twelve questions.
Its `description` — which carries the form's own "(check all that apply and explain
below)" and the narrow-blank warning — does not render either, on any item.

So the 24 roof values reach the form correctly once they are in
`inspection_results.data`, and today nothing in the product can put them there.

**To close it:** carry `attributes` (and `description`) from the template snapshot into
the editor's item objects. The loader already fetches the raw snapshot as
`templateSnapshot` for structural edits, so the data is present on that page.

### 2.1b 🔴 Both statutory endpoints 500 on an inspection the wizard created

Also found by pressing the button, and also not this template's mistake.

`inspections.date` is documented as a calendar day and the statutory subsystem asserts it:
`utcMidnightOf` in the offer route, and `calendarDayForForm` inside `gatherStatutoryInputs`.
The New Inspection wizard writes a **full ISO timestamp**. Measured on this deployment: seed
rows hold `2026-06-01`, and an inspection created through the wizard today held
`2026-08-30T09:00:00.000Z`. Both endpoints then threw:

```
GET …/statutory-form      500  statutory inspection date: "2026-08-30T09:00:00.000Z"
                                is not a YYYY-MM-DD calendar day
GET …/statutory-form.pdf  500  statutory render: "inspection_date" is drawn as a date and
                                received "2026-08-30T09:00:00.000Z", …
```

The offer route failing is the quieter half: it is caught and degrades to
`available: false`, so the control simply does not render and the inspector is told
nothing at all. With the date corrected to `2026-08-30` the control appeared, the notice
named `fl_citizens_roof` / `RCF-1 03 25` / effective 2025-03-20, and the render was reached.

⚠️ And when it was reached, the refusal in §2.1 came back to the browser as
`{"error":{"message":"Internal server error"}}`. The produce service's refusals are written
to be read by the person holding the form; on this route they reach the log and nothing
else. The 409s the route raises itself do reach the user, which is what makes the
difference easy to miss.

### 2.2 `damage_signs` asks for every sign that applies and can carry one

The form prints, in both roof columns:

> Any visible signs of damage / deterioration? **(check all that apply and explain below)**

with eight boxes. The renderer supports it — `render.ts` marks every box a list names — but
nothing upstream can deliver a list. `collectStatutoryValues` returns
`Record<string, string>` and `asValue` stringifies, so a multi-valued attribute would arrive
as `"cracking,cupping_curling"`, which matches no `whenValue` and is refused by name. The
attribute-editor's `multi_select` type is worse: it falls through to a plain text input, so
the inspector would type a value the form has no box for.

So each roof surface records **one** damage sign, and the item's description says so and
sends the rest to Additional Comments/Observations — which is where the form itself sends
every "(explain below)".

**To close it:** a value pipeline that can carry a list end to end (a `string | string[]`
value type through `collectStatutoryValues`, and a real multi-select control in
`ItemAttributesPanel`).

### 2.3 The choice questions show the inspector a slug, not the form's wording

An attribute's `choices` are its stored values, and `ItemAttributesPanel` renders each one
as both the option's value and its label. The stored value must equal the field map's
`whenValue` byte for byte — `render.ts` compares with `===` and nothing normalises — so the
dropdown reads `full_replacement`, not *Full replacement*.

The authority's own wording is not lost: it is the attribute's `name` and the item's
`description`, both transcribed from the printed page. But the option list is our
vocabulary showing through, and it is the one place on this screen where an inspector does
not read what Citizens printed.

**To close it:** a label/value split on `ItemAttribute.choices`. ⚠️ Whatever shape that
takes, the VALUE must stay the map's `whenValue`; a change that stores the label produces a
completely blank official form with every gate green.

### 2.4 The roof column blanks refuse a four-digit year

The twelve printed rules in each roof column are about 41.5pt wide, and every overlay on
this form declares both a `maxWidth` and a `maxHeight`, so `fit.ts` measures each value and
**refuses** rather than wrapping it down over the row beneath. No `minSize` is declared, so
nothing shrinks first.

Measured in Helvetica 9pt, the size the map draws at: `03/09/20` is 35.0pt and fits;
`03/09/2026` is 45.0pt and does not; `Asphalt shingle` is 61.0pt and does not. The two
roof-item descriptions say this in the editor, because the alternative is an inspector
meeting an opaque refusal at the end.

This is a property of the form, not a defect: Citizens printed a 41.5pt rule. It is
recorded because "the software refused my date" and "the software is broken" look identical
from the outside.

### 2.5 The `roof` group declares no `overflowTo`, so a third roof surface refuses

`groups` in this template is copied verbatim from the signed candidate, including the
absence of `overflowTo`. A house with three roof surfaces therefore refuses at
`refuseOverCapacity` with both counts named, rather than routing the third into the comments
box.

The form is eligible for a destination — it prints *(use additional pages as needed)* on
Additional Comments/Observations, which is the publisher's own answer to where an
overflowing answer goes, and `groups.ts` cites exactly that sentence pattern. The
candidate's notes (§7 F) flag it as a decision for a reviewer and it has not been ruled on.
**Declaring it is a one-line change here and should be made together with the same decision
on the four-point form**, which shares the block and also declares none.

---

## 3. What is deliberately NOT a gap

- **Photographs.** The form requires *Roof: Each slope* and *All hazards or deficiencies*.
  They are attachments, not blanks: no `ourField` on the map names one. Each roof item is a
  `photo_only` item so the photos are captured beside the answers.
- **`Predominant` / `Secondary` slot order.** Slot 0 is Predominant because the form prints
  that name over the left column, and the candidate's notes establish the column boundary
  geometrically. It is not "the first roof recorded".
- **No `ratingSystem`.** This form has twelve different questions over fourteen values and
  no single judgement axis. One rating system per question would be the mechanism used
  backwards; the values live on `item_attribute`, which is what it is for.
