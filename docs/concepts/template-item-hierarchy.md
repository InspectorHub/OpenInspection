# Template item hierarchy

A template section holds an **ordered, one-dimensional array of items**. An item may
name another item in the same section as its parent. That is the whole model:

```ts
interface TemplateItem {
    id: string;
    label: string;
    // ...
    /** The item this one sits under; absent or null means top level. */
    parentId?: string | null;
}
```

Why it is shaped like that, and where getting it wrong is silent, is the rest of this
page. The item type itself lives in `server/types/template-schema.ts`; every function
that knows the items form a tree lives in one module,
`server/lib/template-hierarchy.ts`.

For the surrounding data model — `templates.schema`, results, report snapshots — see
[`inspection-workflow.md`](inspection-workflow.md).

---

## Nothing new is stored

`parentId` lives inside the existing `templates.schema` JSON column, and inside the
frozen `inspections.template_snapshot` copy. **No table, no column, no migration.**

The field is optional and **absent means top level**, which is what makes every
template written before it existed still correct: read one back and every item is at
depth 0, because every item really was at depth 0. Snapshots are never backfilled. An
inspection created against a flat template was a flat inspection, and reprinting it
with today's structure would be inventing a document the inspector never saw.

## Why a parent pointer and not a nested `children` array

This is the decision worth reading, because the alternative fails in a way nothing in
the build would catch.

Dozens of places in this repository walk `section.items` as a flat array — the report
renderer, the DOCX exporter, progress and analytics counters, photo numbering, the
editor's search index, the findings resolvers, the import preview. Nest the array and
every one of them has to become a recursion.

**A walk that forgets to recurse does not throw. It silently prints less.**

Concretely, one missed `for (const item of section.items)`:

- the report prints the parent row and not the three rows under it;
- the progress meter says 18 of 20 answered when 23 questions exist;
- a defect typed into a nested item cannot be found by editor search;
- photo numbering skips, because the photos hanging off the missed items were counted
  by a different walk that *did* recurse.

Every one of those is a valid object, a successful render, a green test suite and a
2xx response. The failure surfaces when a human holds the PDF next to the form and
counts rows. There is no type error to find, because `TemplateItem[]` still
type-checks when you only read the first level of it.

A parent pointer keeps `items` one-dimensional, so **every existing walk still sees
every item.** Renderers that want to show nesting opt in; renderers that do not print
a flat list, which is incomplete-looking but never *incorrect*. That turns dozens of
mandatory edits into one mandatory edit (the report item card) plus a pile of optional
ones.

Addressing stays flat for the same reason: results are read by item id
(`readItemEntry(resultData, sectionId, itemId)`) and collaborative edits are keyed by
`findingKey(unitId, sectionId, itemId)`. Nesting the array would not change either
key, but it would turn every `items.find(...)` in the editor into a tree search.

## Why not an `indentLevel` number

Both draw the same picture. They differ on the questions that are not about drawing:

| Question | `indentLevel` | `parentId` |
|---|---|---|
| Delete a row — what happens to the rows indented beneath it? | Unanswerable. They are still level 2, indented under nothing. | Its subtree is a set; it travels, or it is deleted, by decision. |
| Move a row — what travels with it? | Unanswerable. "With it" does not exist; you can only guess at "the following run of deeper rows", which is right between two top-level rows and wrong everywhere else. | The subtree. |
| Is this document well formed? | Unanswerable. `[level 1, level 3]` breaks no rule. | Parent must exist, no cycles, depth bounded. |

What `parentId` cannot express is decorative indentation — *visually deeper but not
belonging to the row above*. That is a layout concern, it belongs with things like
`TemplateSection.alwaysPageBreak`, and no product surface asks for it.

A third field distinguishing a sub-component from a qualifier (`relation: 'component'
| 'qualifier'`) was considered and deliberately **not** added: nothing renders or
calculates differently for the two today. The only candidate — how to print the
children of an item rated Not Present — has the same answer for both, which is "not at
all". This repository already carries fields that nothing reads; adding another before
a real divergence exists to point at was not worth it.

## The array order *is* the tree order

> **Invariant: `items` is a pre-order walk.** An item's entire subtree sits
> immediately after it and before its next sibling.

This is the load-bearing half of the design. Because the array is in pre-order, a
renderer that reads the array top to bottom emits `A, A.1, A.1.a, A.2, B` — correct
document order, with no change to the renderer at all.

Documents that violate the invariant (hand-written, imported, or written by some
future bug) are not each renderer's problem: `normalizeItemOrder` in
`server/lib/template-hierarchy.ts` is a pure function that restores pre-order, and it
keeps every item even when the pointers form a cycle.

## Depth is capped at three levels

`MAX_ITEM_DEPTH = 3` — top level is depth 0, so the deepest legal item is depth 2.

Three reasons, in increasing order of how hard they are to argue with:

1. **Bounded walks.** Depth and cycle detection are a walk up the parent chain, with
   no closure table. A small constant bound makes both walks terminate by
   construction. The unit tree (`server/services/unit.service.ts`) has `MAX_DEPTH = 3`
   for exactly this reason; a second depth philosophy in the same codebase would be
   two things to remember.
2. **No observed input is deeper.** The statutory forms that motivated nesting are
   three levels on the printed page. The template formats the import adapters read are
   two.
3. **The item column is 280px wide** and the label is `truncate`d. A drag handle, an
   outline badge and a ⋯ menu are already spent out of that; each indent step costs
   14px. By the fourth level you are identifying structure from a *truncated* label,
   at which point indentation manufactures ambiguity instead of conveying it.

### Who actually refuses a fourth level

| Layer | Behaviour |
|---|---|
| `TemplateSectionSchema.superRefine` (Zod) | The guarantee. 400, naming the offending item id. |
| Editor | Convenience only. "Add sub-item" is **disabled, with a reason** at the cap; the *nest under* picker filters out parents already at the cap, and every item in the selected item's own subtree. |

Depth is refined at the **section** level, not on the item schema, because depth is a
property of the whole array: a single item's schema cannot see its parent.

**The cycle check runs before the depth check, and the order is not interchangeable.**
Computing depth means walking up the parent chain, and a chain on a cycle never ends.
Check depth first and a knotted document either hangs or reports "too deep" — an error
message that sends the author looking for nesting to flatten when what they have is a
loop.

## Reading fails open, never closed

One rule, and it lives inside `itemDepths` so that no caller has to remember it:

> If an item's `parentId` does not resolve to another item **in the same section's
> array**, that item is treated as top level.

Dangling pointers, self-parents and cycles all resolve to depth 0 rather than to a
throw. A crash here is a blank report; a flat render is a truthful one. Nothing is ever
dropped, and nothing is ever rendered under a different section — a parent in another
section is not a parent, because sections are the report's pagination and
table-of-contents unit, and "how many items in this section" is a number that several
surfaces already print.

Pointers that do not resolve arrive from more directions than the write schema can
guard:

- rows written straight to the database (seed content, installed template packs);
- documents already stored before some bug was fixed;
- **and, at render time, from filtering.** The report's `defects` filter removes items
  from the list, so a child can legitimately outlive its parent inside that one
  render. It becomes a top-level card, which is the right outcome.

**An empty string is not an absence.** The Zod field is
`z.string().min(1).nullable().optional()`, not `z.string().nullable().optional()`. A
`parentId: ''` makes "does this have a parent" true while "find the parent" returns
undefined, which is the definition of a dangling node — cheap to refuse at the
boundary, tedious to reason about afterwards.

## The other structural axis: statutory slots

Do not confuse `parentId` with the slot headings derived in
`app/lib/editor/statutory-groups.ts`. They are different axes, and on a three-level
statutory form they coexist:

- **Group / slot** — which items *this statutory form* prints inside one block.
  Derived from a binding key, supplied by the platform, **stores nothing**.
- **`parentId`** — which item is subordinate to which in *this template*. Authored,
  stored in the document.

Slot headings sit *between* rows and take no indentation; nesting applies *within* a
row. An item inside a slot can still have children. In a grouped template both "Add
item" and "Add sub-item" are hidden entirely — not disabled — because a free-standing
item in such a template reaches no binding, so whatever is typed into it never arrives
on the authority's form and nothing would say so.

## Seven declarations of "what keys does an item have"

Before adding any field to `TemplateItem`, know that seven places independently decide
what keys an item has, and **only two of them complain when they disagree**:

| Place | On disagreement |
|---|---|
| `server/types/template-schema.ts` — the authority interface | compile error — loud |
| `server/lib/validations/template.schema.ts` — Zod discriminated union, `.strict()` members | 400 `unrecognized_keys` — loud |
| `app/lib/editor/structure-ops.ts` — the `ITEM_KEYS` runtime allowlist | **silently stripped** |
| `app/lib/editor/serialize-template.ts` — the save serializer | **silently never sent** |
| `app/components/template/types.ts` — the editor's own item type | compiles; the panel simply cannot see the field |
| `app/components/form/FormField.tsx` — the field renderer's own item type | same |
| `server/services/inspection/report-schema-types.ts` — the report projection | **silently never printed** |

This is not hypothetical. `number` was on the authority type, in the Zod base fields,
in `ITEM_KEYS` and in the report projection — and in neither the editor's own type nor
its save serializer. Authoring a display number therefore *lost* it, with no error
anywhere. Several `options` sub-keys went the same way.

`npm run lint:item-key-parity` (`scripts/check-item-key-parity.mjs`, pre-commit rung)
now pins the seven together. It does **not** demand identical key sets, because the
report projection deliberately reads a handful of keys and does not want `attributes`;
demanding equality would be wrong rather than strict. The rule is:

> Every mirror carries an explicit list of the keys it deliberately does not want. Only
> an **undeclared** absence fails. A declared gap is a decision; an undeclared one is a
> bug.

It prints both numbers — authority keys, and mirrors compared — and names every skipped
key per mirror; comparing zero mirrors is a failure, because an empty result set
otherwise reads as green. How gates are registered and which rung pays for them is
[`../develop/gates.md`](../develop/gates.md).

Depth and cycles get **no** gate: they are properties of runtime data, not of source
text, and no source scan can see a document that will be PUT tomorrow. They are refused
at the write boundary instead.

## Traps

Collected because each of these has exactly one correct answer and a plausible wrong
one.

- **Un-nesting writes an explicit `null`, never an omitted key.** Omit it and the
  stored `parentId` survives the patch: the author un-nests, saves, reloads, and finds
  the item nested again.
- **Indentation is a spacer element with an inline `inlineSize`, not a padding
  utility.** The item row is a bare element whose class is built by string
  concatenation — there is no `tailwind-merge` on that path — and it already sets
  `px-3`. Appending `pl-6` puts two classes of *identical* CSS specificity in play, and
  the winner is decided by their order in the generated stylesheet, not by their order
  in the attribute. An inline style cannot collide with a class at all. `ItemRowIndent`
  uses `inlineSize` and `border-inline-start` (not `width` / `border-left`) so RTL is
  correct without a second code path.
  **Assert computed width, not the presence of a class**: "the row has `pl-6`" is green
  for an implementation whose `pl-6` is being overridden.
- **Outline numbers (`A`, `A.1`, `A.1.a`) are derived and never stored.**
  `TemplateItem.number` is a separate, author-written field, and the two must not
  compete. The derived badge is suppressed when a label *already prints that exact
  enumerator* — a statutory item's text is the authority's printed wording and is not
  ours to edit, so a derived `A` beside `A. Foundations` would read `AA. Foundations` on
  every row at once. Suppression is conditional on equality, so a label whose own
  numbering disagrees with its position keeps both, which is the case worth seeing.
- **Duplicating a section must remap parent ids.** A `{ ...item, id: newId() }` clone
  carries the *old* `parentId` into the new section, where that id does not exist.
  Nothing crashes — the fail-open read rule turns them all into top-level items — so the
  author simply gets a copy that quietly lost its structure. `remapParentIds` is the
  fix, and it has to land in the same change as any new id-bearing field.
- **Moving a row is "move the subtree among its siblings", not "swap with the
  neighbour".** An adjacent swap between a parent and its own first child puts the
  parent underneath its own child, breaking pre-order and producing a document in which
  a parent follows its own descendant.
- **Dragging an item into its own subtree is the one gesture that can mint a cycle**, so
  it is refused. The drag plumbing itself needs no change for nesting: the sortable hook
  only translates a DOM index into `(fromId, toId)`, and parents and children live in
  the same container. What changes is the reducer that receives those ids.
- **Deleting a parent deletes its subtree.** Promoting the orphans to the parent's level
  was considered and rejected: a qualifier that has lost the thing it qualifies is a
  sentence with no subject, and it is *worse* than a deletion because it looks like an
  ordinary item and nothing marks it as broken. Deleting an item that has children
  therefore confirms first — through the existing modal component, never
  `window.confirm` — stating how many rows go. Deleting a leaf is unchanged.
- **Controls at the cap are disabled and say why, not hidden.** Silently omitting a menu
  entry leaves the author comparing one row's menu against another's to infer a rule
  that nothing states.
- **Pair every negative assertion with a positive control.** A test proving four levels
  are rejected is equally green against an implementation that rejects *every* template.
  The companion assertion is that a template exactly three levels deep saves, and reads
  back with its structure intact.
- **Import adapters needed no change.** Because `parentId` is optional and absent means
  top level, an adapter whose source format is two levels deep emits items that are all
  top level — byte-identical output to before. That is the payoff for an optional field
  over a required one. One reader does flatten genuinely nested input; the open work
  there is to make it *say so* in its warnings, not to reconstruct the depth.
- **Adding a key to the item schema regenerates the OpenAPI snapshot.**
  `server/lib/mcp/openapi-snapshot.json` is produced by `npm run mcp:snapshot`; one new
  base field lands in it dozens of times. It is generated, not hand-edited.
