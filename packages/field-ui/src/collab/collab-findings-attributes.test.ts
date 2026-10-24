// @vitest-environment node
/**
 * The item-attributes write, through the road the editor actually uses.
 *
 * -- WHAT WENT WRONG --------------------------------------------------------
 * `inspection-edit.tsx` submitted a `set-item-attribute` fetcher intent that NO
 * action ever handled — a leftover from before #181 Phase 5 retired the fetcher
 * write path and made the collab Y.Doc the only one. Every answer fell through
 * the action's final `return { ok }` and was discarded.
 *
 * Measured 2026-08-30 in Chrome on the FL Citizens roof pack: picking a value
 * left the control on "—" and `inspection_results.data` untouched. Writing the
 * same answer straight to D1 by hand made it worse rather than better — the
 * collab Durable Object flushed its own (attribute-less) projection over the
 * row seconds later, so the answer disappeared after a reload.
 *
 * `setItemAttribute` existed on `results-binding` and had no production caller;
 * the fix gives it one, on `CollabFindingsApi`, beside `setRating` and
 * `setItemValue`.
 */
import { describe, it, expect, vi } from "vitest";
import * as Y from "yjs";
import { buildCollabFindingsApi } from "./collab-findings-api";
import { readResultMap } from "./results-binding";

function api(doc: Y.Doc, activeUnitId: string | null = null) {
  return buildCollabFindingsApi(doc, {
    getResult: () => ({}),
    sectionIdForItem: () => "roof",
    setResults: () => {},
    setDirty: vi.fn(),
    setSaveStatus: () => {},
    activeUnitId,
  });
}

describe("collab findings API — setItemAttribute", () => {
  it("writes the answer onto the finding's attributes bag", () => {
    const doc = new Y.Doc();
    api(doc).setItemAttribute("roof", "roof_predominant", "damage_signs", "cupping_curling");

    const map = readResultMap(doc);
    expect(map["_default:roof:roof_predominant"].attributes)
      .toMatchObject({ damage_signs: "cupping_curling" });
  });

  it("MERGES a second attribute instead of replacing the first", () => {
    // An item declares up to twelve of these and two inspectors can answer two
    // at once. A whole-object write would clear the other eleven, and on a
    // statutory form a cleared answer is a blank box that reads as unanswered.
    const doc = new Y.Doc();
    const f = api(doc);
    f.setItemAttribute("roof", "roof_predominant", "damage_signs", "cupping_curling");
    f.setItemAttribute("roof", "roof_predominant", "overall_condition", "satisfactory");

    expect(readResultMap(doc)["_default:roof:roof_predominant"].attributes).toMatchObject({
      damage_signs: "cupping_curling",
      overall_condition: "satisfactory",
    });
  });

  it("keeps a cleared answer as null rather than dropping the key", () => {
    // "—" is an answer of nothing. An absent key and an empty one are different
    // facts on an authority's form — see server/lib/statutory/values.ts.
    const doc = new Y.Doc();
    api(doc).setItemAttribute("roof", "roof_predominant", "damage_signs", null);
    const attrs = readResultMap(doc)["_default:roof:roof_predominant"].attributes as Record<string, unknown>;
    expect("damage_signs" in attrs).toBe(true);
    expect(attrs.damage_signs).toBeNull();
  });

  it("scopes the write to the active unit", () => {
    // Two units share an itemId, so an unscoped write puts one unit's answer
    // where the other's reader looks.
    const doc = new Y.Doc();
    api(doc, "unit-b").setItemAttribute("roof", "roof_predominant", "damage_signs", "cracking");
    const map = readResultMap(doc);
    expect(map["unit-b:roof:roof_predominant"].attributes)
      .toMatchObject({ damage_signs: "cracking" });
    expect(map["_default:roof:roof_predominant"]).toBeUndefined();
  });

  it("marks the editor dirty, so the save indicator is not a lie", () => {
    const doc = new Y.Doc();
    const setDirty = vi.fn();
    buildCollabFindingsApi(doc, {
      getResult: () => ({}),
      sectionIdForItem: () => "roof",
      setResults: () => {},
      setDirty,
      setSaveStatus: () => {},
      activeUnitId: null,
    }).setItemAttribute("roof", "roof_predominant", "damage_signs", "cracking");
    expect(setDirty).toHaveBeenCalledWith(true);
  });
});
