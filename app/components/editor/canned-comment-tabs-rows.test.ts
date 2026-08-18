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

function html(includedIds: string[], extra: Record<string, unknown> = {}) {
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
      customTitle: "", customComment: "", customCategory: "recommendation", customTrade: "",
      saveToLibrary: false, showSaveToLibrary: false,
      onCustomTitleChange: () => {}, onCustomCommentChange: () => {},
      onCustomCategoryChange: () => {}, onCustomTradeChange: () => {},
      onSaveToLibraryChange: () => {},
      onCancelCustomForm: () => {}, onSubmitCustomDefect: () => {},
      ...extra,
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

  it("renders the custom row with its category chip, inspector-added badge, and photo chip", () => {
    const out = html([]);
    expect(out).toContain("Gutter loose");
    expect(out).toContain(">maintenance<");
    expect(out).toContain(">inspector-added<");
    // custom defect is included:true => its photo chip mounts
    expect(out).toContain('data-testid="photo-chip"');
  });

  it("keeps the selected (primary-tint) shell for included rows", () => {
    expect(html(["d1"])).toContain("bg-ih-primary-tint");
  });
});

/**
 * IA-85 — a hand-written defect names its trade from the SAME vocabulary the
 * canned row offers. The form previously had no such control at all, so the
 * contractor-facing repair list showed a trade for library defects and nothing
 * for the ones the inspector actually wrote.
 */
describe("CannedCommentTabs custom-defect form", () => {
  const open = () => html([], { onAddCustomDefect: () => {}, customFormOpen: true });

  it("offers the canned trade vocabulary, plus an explicit none", () => {
    const out = open();
    expect(out).toContain('value="licensed-roofer"');
    expect(out).toContain("licensed roofer");
    // The empty option is what makes "no trade" expressible after a pick. It
    // is asserted by its label, not by `value=""` — every empty text input in
    // the form renders that attribute, so that would pass with no select at
    // all.
    //
    // The label is NOT the canned row's "— select —", and the difference is
    // deliberate. The canned row prints a visible TRADE rail above its select;
    // this compact form has none, so the same words there said nothing about
    // what the control was — and it sat beside a category select whose value
    // doubles as its label ("Recommendation"), which made the asymmetry
    // visible on screen. Found in the browser; no gate can see it.
    expect(out).toContain(">Trade — select<");
    // And it is still the same vocabulary underneath: the canned row's own
    // placeholder must NOT appear here, or the two would have drifted apart
    // into two controls rather than one control with two presentations.
    expect(out).not.toContain(">— select —<");
  });

  it("does not invent a vocabulary of its own", () => {
    const out = open();
    // A trade the canned row would never offer must not appear here either.
    expect(out).not.toContain("plumber-extraordinaire");
  });
});
