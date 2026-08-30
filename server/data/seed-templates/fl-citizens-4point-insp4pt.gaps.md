# FL Citizens 4-Point Inspection Form (Insp4pt 03 25) — what this template does not fill in

`fl-citizens-4point-insp4pt.json` binds **94 of the 95 blanks** the published field map
(`server/lib/statutory/forms/fl-citizens-4point.ts`) names. This file is the other one, and
the smaller gaps that sit behind the ones that ARE bound.

**It exists because a blank box cannot explain itself.** On a printed statutory form,
"we left this empty deliberately" and "we forgot" are the same picture. Every entry below
says which it is, and what would have to exist before it could be filled.

Measured 2026-08-30, against the authority's own PDF
(sha256 `5d3327663ea58cf1f073b43967004cce3205d29973aa407e200c5be1f44cc294`) and the signed
candidate beside it (`checkedBy: Nathan`).

| | count |
|---|---:|
| blanks the field map names | 95 |
| bound by this template | 94 |
| **left unbound** | **1** |
| bindings naming a blank the form does not print | 0 |
| choice questions, and how many store the map's own value byte for byte | 44 / 44 |
| answers the form requires of every submission (`requiredFields`) | 23 |

---

## 1. The one unbound blank

### `inspector_title` — page 3, the box printed `Title`

**No source anywhere in this repository.** `StatutoryInspectionField`'s own comment names
this box as one it deliberately excludes: a member that can never resolve is a blank on an
authority's form, which reads as an inspector who did not answer, so it is left out of the
closed list rather than added and hardwired to null.

It is the same box, for the same reason, as §1 of
`fl-citizens-roof-rcf-1.gaps.md` — the two Citizens forms print an identical seven-blank
signature block, and this is the blank neither of them can fill.

**To close it:** a column holding the inspector's job title, then a new member on
`StatutoryInspectionField`, then `{ from: 'inspection', field: … }` here.

⚠️ **`inspector_license_type` is NOT this box** and must not be bound to a job title. The
form prints both, side by side, and page 4 says what the licence type means: *A general,
residential, or building contractor* · *A building code inspector* · *A home inspector*.
That reads from `users.statutory_license_type`, a column of its own.

---

## 2. Gaps behind blanks that ARE bound

### 2.1 The four-point form's roof block is NOT the roof form's, and the wording differs

Both Citizens forms print a Roof block with the same twelve questions, and the printed
wording is **not identical**. Read off the two PDFs on 2026-08-30:

| | RCF-1 03 25 | Insp4pt 03 25 |
|---|---|---|
| remaining useful life | `Remaining useful life (years)` | `Remaining useful life (years):` |
| overall condition | `Overall condition` | `Overall condition:` |
| leaks | `(If "yes", explain below)` | `(If "yes" explain below)` |

This template carries the four-point form's own spelling, which is why the two seed files
do not share a block of text. Copying either into the other would put a publisher's
punctuation onto a page that never printed it.

The **stored values** are the same on both forms — `cracking`, `full_replacement`,
`satisfactory` — and that is deliberate and load-bearing: an inspection whose template
feeds both forms must not need two vocabularies for one answer.

### 2.2 Two questions the form prints as one printed heading over several blanks

`Age of Piping Supply System:` and `Age of Piping Drain System:` each print **three**
blanks — *Original to home*, *Completely re-piped*, *Partially re-piped* — and the form
gives no instruction about which to fill. This template asks all six and the item's
description says to fill the one that describes the house, because they are alternatives:
a house is repiped or it is not.

Their attribute names carry the printed heading AND the printed row (`Age of Piping Supply
System: Original to home`) rather than the row alone. The row labels repeat between the two
blocks, and an inspector shown six boxes labelled `Original to home` twice cannot tell which
is which.

⚠️ These six blanks are **19.1 pt** wide at 8pt — about four characters. A year fits.

### 2.3 The "(explain)" answers, and where the explanation actually goes

Six answers on this form are printed with an explicit instruction to explain, and the page
gives a blank for only two of them:

| printed | blank on the page? | where this template puts it |
|---|---|---|
| `Other (explain)` — electrical hazards | **yes**, 190.6 pt | `electrical.hazard_other_explain` |
| `Other` — wiring types | **yes**, 48.4 pt | `electrical.wiring_type_other_specify` |
| `Other (specify)` — pipe types | **yes**, 58.0 pt | `plumbing.pipe_type_other_specify` |
| `No (explain)` — amperage sufficient, HVAC in good working order | no | Additional Comments/Observations |
| `Unsatisfactory (explain)` — electrical general condition | no | Additional Comments/Observations |
| `Unsatisfactory (explain below)` — roof overall condition | no | Additional Comments/Observations |

The first two used to be recorded as having no blank either; they were re-measured on
2026-08-30 and both have one. The publisher's own answer for the rest is the comments box:
page 4 prints that Additional Comments or Observations *must be completed with full
details/descriptions* when a system is not in good working order.

### 2.4 The plumbing detail box is not the comments box

The form prints **two** free-text areas and they ask different things. Page 2 prints
*If unsatisfactory, please provide comments/details (leaks, wet/soft spots, mold, corrosion,
grout/caulk, etc.)* under the fixtures grid; page 3 prints *Additional Comments/Observations
(use additional pages if needed)*. Thirteen answers on this form can be `unsatisfactory`, so
the first box has real work to do and is bound separately
(`plumbing_fixtures_unsatisfactory_detail`, an attribute of the fixtures item so it sits
beside the ten judgements it explains).

### 2.5 `Wiring Type(s)` is one answer for the dwelling, not one per panel

It is printed as the third column of the Supplemental information table, beside *Main Panel*
and *Second Panel*, and a reader could take it for a third panel column. It is not: the
table draws no vertical rule through it and the form prints exactly one set of eight boxes
however many panels the house has. So it is bound to `electrical.wiring_types`, outside the
`electrical_panel` group, and it lives on an item of its own rather than on either panel.

⚠️ The consequence is worth stating rather than hiding: **this form cannot express two
panels wired differently.** That is the form's limit, not the template's, and the place to
say so is Additional Comments/Observations.

### 2.6 The `electrical_panel` and `roof` groups declare no `overflowTo`

`groups` is copied verbatim from the signed candidate, including the absence of
`overflowTo`. A house with three electrical panels or three roof surfaces therefore refuses
at `refuseOverCapacity` with both counts named, rather than routing the third into the
comments box.

The form is eligible for a destination — it prints *(use additional pages if needed)* on
Additional Comments/Observations, which is the publisher's own answer to where an
overflowing answer goes. The candidate's notes flag it as a decision for a reviewer and it
has not been ruled on. **Declaring it is a one-line change here and should be made together
with the same decision on the roof form**, which shares the roof block and also declares
none.

### 2.7 Photographs are answers to a checklist, not blanks

`photo_requirements_included` is six real printed checkboxes, and they say WHICH KINDS of
photograph accompany the submission — never how many. "Dwelling: Each side" is one box on a
four-sided house and one box on an L-shaped one. Each system's item is a `photo_only` item so
the pictures are captured beside the answers, but nothing in the map counts them and nothing
here should.

⚠️ The form prints its photo list **twice**, on page 1 and again on page 4, and four of the
six lines are worded differently. The boxes are on page 1, so page 1's wording is what this
template carries.

---

## 3. What is deliberately NOT a gap

- **Page 4.** Instructions to agents and inspectors: no box and no blank on the whole page,
  confirmed by rasterising it rather than inferred from the map stopping at page 3.
- **A second HVAC system.** The form prints one set of HVAC questions and no second column,
  no second label and no dividing rule — checked three ways in the candidate's notes. A house
  with two air handlers is recorded in the comments box. Adding a `capacity: 2` group would
  render onto coordinates that do not exist.
- **No `ratingSystem`.** Forty-four choice questions over fifty-five distinct values, with no
  single judgement axis between them. TREC gets one embedded rating system because all 41 of
  its items ask the same question; here one rating system per question would be the mechanism
  used backwards, and the values live on `item_attribute`, which is what it is for.
- **Trade-specific signing.** Page 4 says a trade-specific licensee *may sign off only on the
  inspection form section for their trade*, and the form prints ONE signature block, at the
  end, with nowhere to record which section it covers. The rule is expressible and the page
  is not, so nothing here models it.
