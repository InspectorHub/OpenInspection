import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ItemPreviewPanel } from "~/components/template/ItemPreviewPanel";
import { SideRail } from "~/components/editor/SideRail";

describe("preview parity", () => {
  it("ItemPreviewPanel renders each canned entry title + comment via the shared row", () => {
    const out = renderToStaticMarkup(
      createElement(ItemPreviewPanel, {
        selectedItem: {
          id: "i1",
          label: "Roof",
          type: "rich",
          ratingOptions: ["S", "D"],
          tabs: {
            information: [],
            limitations: [],
            defects: [
              {
                id: "d1",
                title: "Shingles lifted",
                comment: "Lifted at ridge.",
                category: "safety",
              },
            ],
          },
        },
      } as never),
    );
    expect(out).toContain("Shingles lifted");
    expect(out).toContain("Lifted at ridge.");
    // DefectCategoryChip via CannedCommentRow — fails RED before 6b swap
    expect(out).toContain(">safety<");
  });

  it("SideRail preview renders included defect comment + chip via shared row", () => {
    // activeResult.tabs shape: Array<{ name; comments: Array<{ included; text; category; ... }> }>
    // included comments carry text (raw Mustache template) and category; no title field.
    const out = renderToStaticMarkup(
      createElement(SideRail, {
        activeItem: { id: "item1", label: "Roof", type: "rich" },
        activeResult: {
          tabs: [
            {
              name: "defects",
              comments: [
                { id: "c1", text: "Lifted at ridge.", included: true, category: "safety" },
              ],
            },
          ],
        },
        initialOpen: true,
      } as never),
    );
    expect(out).toContain("Lifted at ridge.");
    // DefectCategoryChip via CannedCommentRow — fails RED before 6c swap
    expect(out).toContain(">safety<");
  });
});
