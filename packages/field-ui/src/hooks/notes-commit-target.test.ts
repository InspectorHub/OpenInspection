import { describe, expect, it } from "vitest";
import { notesCommitTarget } from "./notes-commit-target";

const sections: Record<string, string> = { a: "s1", b: "s2" };
const base = { activeItemId: "b" as string | null, currentSectionId: "s2" as string | undefined, sectionIdForItem: (id: string) => sections[id] ?? null };

describe("notesCommitTarget", () => {
  it("sends a named item to its own section, not the open one", () => {
    expect(notesCommitTarget({ ...base, itemId: "a" })).toEqual({ sectionId: "s1", itemId: "a" });
  });

  it("drops a named item that is gone, and does not fall back to the open section", () => {
    expect(notesCommitTarget({ ...base, itemId: "removed" })).toBeNull();
  });

  it("drops a named item whose section is gone", () => {
    expect(notesCommitTarget({ ...base, itemId: "a", sectionIdForItem: () => undefined })).toBeNull();
  });

  it("CONTROL - a commit naming no item takes the open item and the open section", () => {
    expect(notesCommitTarget({ ...base, itemId: undefined })).toEqual({ sectionId: "s2", itemId: "b" });
    expect(notesCommitTarget({ ...base, itemId: undefined, activeItemId: null })).toBeNull();
    expect(notesCommitTarget({ ...base, itemId: undefined, currentSectionId: undefined })).toBeNull();
  });
});
