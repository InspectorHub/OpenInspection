import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ItemCommentsPanel } from "~/components/template/ItemCommentsPanel";

const item = {
  id: "i1",
  label: "Roof",
  type: "rich",
  tabs: {
    information: [] as unknown[],
    limitations: [] as unknown[],
    defects: [{ id: "d1", title: "Shingles lifted", comment: "Lifted at ridge.", abbrev: "shglft" }],
  },
};

function html() {
  return renderToStaticMarkup(
    createElement(ItemCommentsPanel, {
      selectedItem: item,
      activeSection: 0,
      editingItem: "i1",
      updateSections: () => {},
      addCannedToItem: () => {},
      removeCannedFromItem: () => {},
    } as never),
  );
}

describe("ItemCommentsPanel (behavior-preserving swap)", () => {
  it("renders the three tab groups with an + Add control each", () => {
    const out = html();
    for (const tab of ["information", "limitations", "defects"]) expect(out).toContain(tab);
    expect((out.match(/\+ Add/g) || []).length).toBe(3);
  });

  it("renders an editable title input and a comment textarea for the defect entry", () => {
    const out = html();
    expect(out).toContain('value="Shingles lifted"');
    expect(out).toContain("<textarea");
    expect(out).toContain("Lifted at ridge.");
  });

  it("keeps the delete control per entry", () => {
    const out = html();
    // '×' delete button (renders as the literal char in static markup)
    expect(out).toContain("×");
    expect(out).toContain("hover:text-ih-bad-fg");
  });

  it("keeps the reorder controls and abbrev input added by the comment-UX plan", () => {
    const out = html();
    // reorder handles (▲▼) rendered with aria-labels
    expect(out).toContain('aria-label="Move up"');
    expect(out).toContain('aria-label="Move down"');
    // abbrev round-trips into its input value
    expect(out).toContain('value="shglft"');
  });

  it("keeps the comment textarea + its text after the CannedCommentRow swap", () => {
    // Guard: the CommentTypeahead wiring must not remove the editable textarea.
    const out = html();
    expect(out).toContain("<textarea");
    expect(out).toContain("Lifted at ridge.");
  });
});
