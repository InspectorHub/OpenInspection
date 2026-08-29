import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ItemEditor } from "~/components/editor/ItemEditor";
import { ItemList } from "~/components/editor-shared/ItemList";

describe("item header sites (behavior-preserving)", () => {
  it("ItemEditor still shows the section eyebrow + item label", () => {
    const out = renderToStaticMarkup(createElement(ItemEditor, {
      item: { id: "i1", label: "Roof covering", type: "text" },
      sectionTitle: "Exterior",
      result: {},
      onRating: () => {}, onNotes: () => {}, onNotesBlur: () => {},
    } as never));
    expect(out).toContain("Exterior");
    expect(out).toContain("Roof covering");
    expect(out).toContain("<h2");
  });

  it("ItemList author mode still shows a row marker + item label", () => {
    // The marker used to be a padded array index (`01`, `02`). It is now the
    // outline number derived from the item tree, so a top-level row reads `A`.
    // That is the change, not a regression: an index describes a position in an
    // array and says nothing about which item a nested row belongs to, and the
    // number is the part of a row that survives the 280px column's truncation.
    // What this test is here to protect is that a row still carries a marker
    // AND its label, and that is asserted below.
    const out = renderToStaticMarkup(createElement(ItemList, {
      mode: "author",
      items: [{ id: "i1", label: "Roof covering", type: "text" }],
      sectionId: "s1",
      activeItemId: null,
      onSelect: () => {},
    } as never));
    expect(out).toContain(">A<");
    expect(out).toContain("Roof covering");
  });
});
