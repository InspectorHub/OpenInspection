import { describe, it, expect } from "vitest";
import {
  isSubsequence,
  rankTypeaheadMatches,
  exactAbbrevMatch,
  flattenItemTabs,
  fragmentBeforeCaret,
  replaceFragmentBeforeCaret,
  type TypeaheadEntry,
} from "~/lib/comment-typeahead";

const E = (p: Partial<TypeaheadEntry> & { id: string }): TypeaheadEntry => ({
  title: "", comment: "", ...p,
});

describe("isSubsequence", () => {
  it("matches in-order chars", () => {
    expect(isSubsequence("shglft", "shingles lifted")).toBe(true);
    expect(isSubsequence("rfl", "Roof Flashing Loose")).toBe(true);
    expect(isSubsequence("xyz", "shingles lifted")).toBe(false);
  });
  it("empty needle matches", () => expect(isSubsequence("", "abc")).toBe(true));
});

describe("rankTypeaheadMatches", () => {
  const entries: TypeaheadEntry[] = [
    E({ id: "a", title: "Shingles Lifted", comment: "Multiple shingles lifted.", abbrev: "shg" }),
    E({ id: "b", title: "Roof Flashing Loose", comment: "Flashing is loose." }),
    E({ id: "c", title: "General", comment: "Recommend a qualified roofing contractor." }),
  ];
  it("returns all entries for empty query", () => {
    expect(rankTypeaheadMatches(entries, "").map((e) => e.id)).toEqual(["a", "b", "c"]);
  });
  it("ranks exact abbrev first", () => {
    expect(rankTypeaheadMatches(entries, "shg")[0].id).toBe("a");
  });
  it("ranks title prefix over subsequence over body", () => {
    // "roof" prefixes b's title; also a subsequence of nothing else; body of c has "roofing"
    const ids = rankTypeaheadMatches(entries, "roof").map((e) => e.id);
    expect(ids[0]).toBe("b");
    expect(ids).toContain("c");
  });
  it("subsequence matches title when no prefix", () => {
    expect(rankTypeaheadMatches(entries, "rfl").map((e) => e.id)).toContain("b");
  });
  it("drops non-matches", () => {
    expect(rankTypeaheadMatches(entries, "zzzz")).toEqual([]);
  });
});

describe("exactAbbrevMatch", () => {
  const entries = [E({ id: "a", title: "X", comment: "", abbrev: "shg" })];
  it("returns the unique abbrev hit", () => {
    expect(exactAbbrevMatch(entries, "shg")?.id).toBe("a");
  });
  it("returns null when none or ambiguous", () => {
    expect(exactAbbrevMatch(entries, "nope")).toBeNull();
    const dup = [E({ id: "a", title: "", comment: "", abbrev: "x" }), E({ id: "b", title: "", comment: "", abbrev: "x" })];
    expect(exactAbbrevMatch(dup, "x")).toBeNull();
  });
});

describe("flattenItemTabs", () => {
  it("orders defects, information, limitations and tags kind", () => {
    const out = flattenItemTabs({
      defects: [{ id: "d", title: "D", comment: "" }],
      information: [{ id: "i", title: "I", comment: "" }],
      limitations: [{ id: "l", title: "L", comment: "" }],
    });
    expect(out.map((e) => [e.id, e.kind])).toEqual([
      ["d", "defect"], ["i", "information"], ["l", "limitations"],
    ]);
  });
  it("handles undefined", () => expect(flattenItemTabs(undefined)).toEqual([]));
});

describe("caret fragment ops", () => {
  it("fragmentBeforeCaret returns the current line up to caret", () => {
    expect(fragmentBeforeCaret("first line\nshglft", 17)).toBe("shglft");
    expect(fragmentBeforeCaret("roof fla", 8)).toBe("roof fla");
  });
  it("replaceFragmentBeforeCaret swaps the current line fragment", () => {
    const r = replaceFragmentBeforeCaret("first\nshglft", 12, "Shingles are lifted.");
    expect(r.value).toBe("first\nShingles are lifted.");
    expect(r.caret).toBe(r.value.length);
  });
  it("preserves leading whitespace on the line", () => {
    const r = replaceFragmentBeforeCaret("  rfl", 5, "Roof flashing loose.");
    expect(r.value).toBe("  Roof flashing loose.");
  });
});
