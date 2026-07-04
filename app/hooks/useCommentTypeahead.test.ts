import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCommentTypeahead } from "~/hooks/useCommentTypeahead";
import type { TypeaheadEntry } from "~/lib/comment-typeahead";

const entries: TypeaheadEntry[] = [
  { id: "a", title: "Alpha", comment: "" },
  { id: "b", title: "Alps", comment: "" },
  { id: "c", title: "Beta", comment: "" },
];

describe("useCommentTypeahead", () => {
  it("filters + ranks by query and caps at max", () => {
    const { result } = renderHook(() => useCommentTypeahead(entries, "al", { max: 1 }));
    expect(result.current.matches).toHaveLength(1);
    expect(result.current.matches[0].id).toBe("a");
  });
  it("move wraps and clamps selectedIndex within matches", () => {
    const { result } = renderHook(() => useCommentTypeahead(entries, "al"));
    expect(result.current.selectedIndex).toBe(0);
    act(() => result.current.move(1));
    expect(result.current.selectedIndex).toBe(1);
    act(() => result.current.move(1));   // wrap to 0 (2 matches)
    expect(result.current.selectedIndex).toBe(0);
    act(() => result.current.move(-1));  // wrap to last
    expect(result.current.selectedIndex).toBe(1);
  });
  it("current() returns the highlighted entry", () => {
    const { result } = renderHook(() => useCommentTypeahead(entries, "al"));
    expect(result.current.current()?.id).toBe("a");
  });
  it("resets selection to 0 when the query changes", () => {
    const { result, rerender } = renderHook(
      ({ q }: { q: string }) => useCommentTypeahead(entries, q),
      { initialProps: { q: "al" } },
    );
    act(() => result.current.move(1));
    expect(result.current.selectedIndex).toBe(1);
    rerender({ q: "bet" });
    expect(result.current.selectedIndex).toBe(0);
  });
});
