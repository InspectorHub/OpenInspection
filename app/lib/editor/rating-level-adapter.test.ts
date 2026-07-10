import { describe, it, expect } from "vitest";
import { toEditorLevel, fromEditorLevel } from "~/lib/editor/rating-level-adapter";
import type { RatingLevel } from "~/components/template/types";

describe("rating-level-adapter round-trip", () => {
  it("preserves pausesAdvance through the editor shape (both directions)", () => {
    const lvl: RatingLevel = {
      id: "l1", label: "Defect", abbreviation: "D", color: "#ef4444",
      severity: "significant", isDefect: true, pausesAdvance: true,
    };
    const editor = toEditorLevel(lvl);
    expect(editor.pausesAdvance).toBe(true);
    const back = fromEditorLevel(editor, 0);
    expect(back.pausesAdvance).toBe(true);
  });

  it("carries id / abbreviation / severity / isDefect across the round-trip", () => {
    const lvl: RatingLevel = {
      id: "l2", label: "Satisfactory", abbreviation: "S", color: "#22c55e",
      severity: "good", isDefect: false,
    };
    const back = fromEditorLevel(toEditorLevel(lvl), 0);
    expect(back).toMatchObject({ id: "l2", abbreviation: "S", severity: "good", isDefect: false });
  });

  it("defaults abbreviation from the label and severity to minor when absent", () => {
    const editor = toEditorLevel({ id: "l3", label: "Unknown" });
    expect(editor.abbreviation).toBe("UNK");
    expect(editor.severity).toBe("minor");
  });
});
