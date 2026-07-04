import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ItemEditor } from "~/components/editor/ItemEditor";
import { SectionsList } from "~/components/template/SectionsList";

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

  it("SectionsList still shows the padded index + item label", () => {
    const out = renderToStaticMarkup(createElement(SectionsList, {
      section: { id: "s1", title: "Exterior", items: [{ id: "i1", label: "Roof covering", type: "text" }] },
      activeSection: 0, previewMode: false, editingItem: null,
      renameSection: () => {}, updateSections: () => {}, setEditingItem: () => {},
      setRightRail: () => {}, updateItem: () => {}, moveItem: () => {}, removeItem: () => {}, addItem: () => {},
    } as never));
    expect(out).toContain(">01<");
    expect(out).toContain("Roof covering");
  });
});
