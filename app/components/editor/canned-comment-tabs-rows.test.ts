import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { CannedCommentTabs } from "~/components/editor/CannedCommentTabs";

const cannedDefect = {
  id: "d1", title: "Roof shingles lifted", category: "safety",
  location: "", comment: "Shingles lifted near {{location}}.", photos: [], default: false,
};
const customDefect = {
  id: "c1", title: "Gutter loose", category: "maintenance",
  comment: "Gutter pulling away.", included: true, photos: [] as Array<{ key: string }>,
};

function html(includedIds: string[]) {
  return renderToStaticMarkup(
    createElement(CannedCommentTabs, {
      visibleTabs: [{ id: "defects", label: "Defects" }],
      activeTab: "defects", onChangeTab: () => {},
      rawTabEntries: [cannedDefect], currentTabEntries: [cannedDefect],
      includedSet: new Set(includedIds),
      defectQuery: "", onDefectQueryChange: () => {},
      resultAttributes: { location: "the ridge" },
      onToggleCanned: () => {},
      defectStates: new Map([["d1", { location: "the ridge" }]]),
      locationSuggestions: [], onDefectFields: () => {},
      missingFields: new Map(), requiredDefectFields: { location: false, trade: false },
      defectPhotoChip: () => createElement("button", { "data-testid": "photo-chip" }, "Add photo"),
      cannedDefectPhotoCount: () => 0,
      libraryMatches: [], onSeedFromLibrary: () => {},
      customDefects: [customDefect], onToggleCustomDefect: () => {},
      onAddCustomDefect: undefined, customFormOpen: false, onOpenCustomForm: () => {},
      customTitle: "", customComment: "", customCategory: "recommendation",
      saveToLibrary: false, showSaveToLibrary: false,
      onCustomTitleChange: () => {}, onCustomCommentChange: () => {},
      onCustomCategoryChange: () => {}, onSaveToLibraryChange: () => {},
      onCancelCustomForm: () => {}, onSubmitCustomDefect: () => {},
    } as never),
  );
}

describe("CannedCommentTabs rows (behavior-preserving swap)", () => {
  it("renders a toggle checkbox per canned + custom row", () => {
    const out = html([]);
    expect((out.match(/type="checkbox"/g) || []).length).toBe(2);
  });

  it("shows the canned title and chip regardless of inclusion", () => {
    const out = html([]);
    expect(out).toContain("Roof shingles lifted");
    expect(out).toContain(">safety<");
  });

  it("renders the Mustache-rendered body when the defect is included (vars only built for isDefectIncluded)", () => {
    // When included, st is set from defectStates and vars are built
    const included = html(["d1"]);
    expect(included).toContain("Shingles lifted near the ridge.");
  });

  it("mounts DefectFieldsRow + the per-defect photo chip only when the defect is included", () => {
    const notIncluded = html([]);
    // DefectFieldsRow location input has this placeholder — absent when d1 not included
    expect(notIncluded).not.toContain("master bathroom");
    // custom defect (included:true) still contributes exactly one photo chip
    expect((notIncluded.match(/data-testid="photo-chip"/g) || []).length).toBe(1);
    const included = html(["d1"]);
    // DefectFieldsRow now renders — location input placeholder present
    expect(included).toContain("master bathroom");
    // canned d1 + custom c1 => two photo chips
    expect((included.match(/data-testid="photo-chip"/g) || []).length).toBe(2);
  });

  it("renders the custom row with its category chip, custom badge, and photo chip", () => {
    const out = html([]);
    expect(out).toContain("Gutter loose");
    expect(out).toContain(">maintenance<");
    expect(out).toContain(">custom<");
    // custom defect is included:true => its photo chip mounts
    expect(out).toContain('data-testid="photo-chip"');
  });

  it("keeps the selected (primary-tint) shell for included rows", () => {
    expect(html(["d1"])).toContain("bg-ih-primary-tint");
  });
});
