# The commercial PCA report

A Property Condition Assessment is a different deliverable from a residential
home inspection, and the engine models it as one rather than as a residential
report with extra fields. This page covers the model and the vocabulary, because
both were got wrong on the first attempt and the corrections are easy to
reintroduce.

The authorities are **ASTM E2018** for a full PCA and **CCPIA ComSOP** for a
light commercial inspection. Where this page states a rule, it is theirs.

## Two tiers, one engine

There are genuinely two deliverables, and a single on/off switch was not enough
to express them. Tier is a first-class concept.

| | Light commercial | Full PCA |
|---|---|---|
| Authority | CCPIA ComSOP | ASTM E2018 |
| Organised by | system / room | ASTM section order |
| Costs | mostly none | two cost tables |
| Photos | inline | centralised appendix with back-references |
| Sign-off | inspector | inspector **and** a reviewer |

## Vocabulary, and the words that were wrong

These corrections apply across the whole feature. The left column is what an
early draft used; it reads plausibly and is wrong.

| Avoid | Use |
|---|---|
| "Replacement Reserves", a `reserve` cost bucket | **Long-Term Costs**. A reserve *schedule* is a separate, opt-in thing |
| "Opinion of Probable Costs" as the concept | **Opinions of Cost**. A table may still be titled "Opinion of Probable Costs" |
| "Material Deficiency" as two different ideas | **material physical deficiency**, one idea, with the de minimis and routine-maintenance exclusions |
| a `maintain` cost action | drop it — routine maintenance is excluded. Add `further_study` |
| "Methodology" as its own report section | it belongs inside Scope of Work |
| a twelve-year term as "the ASTM default" | the term is user-defined. Twelve years is an industry convention, not a standard |

## The cost model

⚠️ **The reserve schedule is an opt-in add-on, not the ASTM baseline.** This is
the structural mistake worth remembering: the baseline is Immediate and
Short-Term costs only. The multi-year Capital Replacement Reserve Schedule is a
layer that real reports commonly carry and that ASTM explicitly marks
non-baseline. Building it into the baseline model makes every light commercial
report carry machinery it has no use for.

So the engine has two tables:

- **Deferred Maintenance** — the two baseline buckets.
- **Capital Replacement Reserve Schedule** — opt-in, carrying effective age,
  expected and remaining useful life, inflation, a cumulative column and a
  per-square-foot column.

A cost threshold and a lump-sum option sit on top, with a suggested remedy and
the exclusions the standard requires.

⚠️ **The platform publishes no repair price of its own.** Estimate columns that
once lived on a defect comment were deliberately removed, because a number the
platform generated reached the client's report as though the inspection company
had written it. A gate refuses to let those columns come back. Cost figures in a
PCA are authored by the assessor, which is a different thing.

## What the report model rests on

The parts that had to exist before any of the report work was sound:

- a **multi-building hierarchy**, so a site with several structures is one
  assessment rather than several;
- **multi-instance systems**, because a property has more than one of most things;
- **representative sampling**, which is how the standards expect a large property
  to be covered;
- **per-section metadata** — access, method, limitation — because a PCA has to say
  how each system was reached and what stopped it being reached.

The condition rating is two axes, `severity` plus a defect `category`, and it
already existed for residential work. The PCA delta was smaller than expected as
a result: distinguishing not-inspected from not-present, recording a reason for
not-inspected, and rolling categories up.

## Per-unit mode

A per-unit assessment reuses the existing unit tree rather than introducing a
parallel table. Each unit behaves as a full sub-inspection, and whether a finding
belongs to the building or to a unit is expressed through the finding key.

`unit_inspection_mode` selects between a tagged mode and a per-unit mode.

⚠️ Reclassifying a per-unit inspection back to residential is currently a
one-way door in the editor: the report keeps printing the per-unit conclusions,
because that output is gated on `unit_inspection_mode`, while the editor's unit
switcher disappears, because that is gated on the property type. The state is
disclosed to the operator in the reclassification dialog rather than hidden.

## Editor surfaces are dimensions, not forks

Anything in the PCA feature that touches the editor builds on the shared,
mode-aware editor components and expresses its addition as a **dimension** of
them. Per-unit work is a unit/scope dimension; structured location tagging is a
location dimension. Forking an editor for PCA was tried and retired; see
[architecture.md](../develop/architecture.md).

PCA template authoring uses the same template editor, with a commercial property
type as its identity. There are no bespoke PCA editors.

## Out of scope, deliberately

- **Word round-trip.** Export is one way.
- **ADA, Phase I environmental, and seismic loss assessments** are not in-scope
  assessments — ASTM and ComSOP both place them outside. They are optional add-on
  modules if they are ever built, not part of a PCA.
- **Replacing the residential path.** Residential is untouched apart from shared
  model upgrades, which stay backward compatible.
