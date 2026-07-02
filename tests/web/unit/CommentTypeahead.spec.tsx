// tests/web/unit/CommentTypeahead.spec.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommentTypeahead } from "../../../app/components/editor/CommentTypeahead";
import type { TypeaheadEntry } from "../../../app/lib/comment-typeahead";

const matches: TypeaheadEntry[] = [
  { id: "a", title: "Shingles Lifted", comment: "Multiple shingles lifted." },
  { id: "b", title: "Flashing Loose", comment: "Flashing is loose." },
];

describe("CommentTypeahead", () => {
  it("renders nothing when closed or no matches", () => {
    const { container, rerender } = render(
      <CommentTypeahead entries={matches} matches={matches} query="s" open={false}
        selectedIndex={0} onHoverIndex={() => {}} onPick={() => {}} onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
    rerender(
      <CommentTypeahead entries={matches} matches={[]} query="zz" open
        selectedIndex={0} onHoverIndex={() => {}} onPick={() => {}} onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
  it("lists matches, highlights selected, inserts comment text on click", () => {
    const onPick = vi.fn();
    render(
      <CommentTypeahead entries={matches} matches={matches} query="s" open
        selectedIndex={1} onHoverIndex={() => {}} onPick={onPick} onClose={() => {}} />,
    );
    expect(screen.getByText("Shingles Lifted")).toBeTruthy();
    const rows = screen.getAllByRole("option");
    expect(rows[1].getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByText("Flashing Loose"));
    expect(onPick).toHaveBeenCalledWith("Flashing is loose.");
  });
});
