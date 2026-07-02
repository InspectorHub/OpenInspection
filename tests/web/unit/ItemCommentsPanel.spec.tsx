// tests/web/unit/ItemCommentsPanel.spec.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ItemCommentsPanel } from "../../../app/components/template/ItemCommentsPanel";
import type { TemplateItem, TemplateSection } from "../../../app/components/template/types";

function makeItem(): TemplateItem {
  return {
    id: "i1", label: "Covering", type: "rich", ratingOptions: ["good"],
    tabs: {
      information: [], limitations: [],
      defects: [
        { id: "d1", title: "First", category: "recommendation", location: "", comment: "c1", photos: [], default: false },
        { id: "d2", title: "Second", category: "recommendation", location: "", comment: "c2", photos: [], default: false },
      ],
    },
  } as TemplateItem;
}

function harness() {
  let sections: TemplateSection[] = [{ id: "s1", title: "Roof", items: [makeItem()] } as TemplateSection];
  const updateSections = vi.fn((fn: (s: TemplateSection[]) => TemplateSection[]) => {
    sections = structuredClone(fn(structuredClone(sections)));
  });
  const rerender = (r: ReturnType<typeof render>) =>
    r.rerender(
      <ItemCommentsPanel
        selectedItem={sections[0].items[0]} activeSection={0} editingItem="i1"
        updateSections={updateSections} addCannedToItem={() => {}} removeCannedFromItem={() => {}}
      />,
    );
  const r = render(
    <ItemCommentsPanel
      selectedItem={sections[0].items[0]} activeSection={0} editingItem="i1"
      updateSections={updateSections} addCannedToItem={() => {}} removeCannedFromItem={() => {}}
    />,
  );
  return { get: () => sections, r, rerender };
}

describe("ItemCommentsPanel reorder + abbrev", () => {
  it("moves a defect down when ▼ is clicked", () => {
    const h = harness();
    const downButtons = screen.getAllByLabelText("Move down");
    fireEvent.click(downButtons[0]); // move "First" below "Second"
    expect(h.get()[0].items[0].tabs!.defects.map((d) => d.id)).toEqual(["d2", "d1"]);
  });
  it("edits the abbrev shortcode", () => {
    const h = harness();
    const abbrevInputs = screen.getAllByPlaceholderText("abbr");
    fireEvent.change(abbrevInputs[0], { target: { value: "shg" } });
    expect(h.get()[0].items[0].tabs!.defects[0].abbrev).toBe("shg");
  });
});
