import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommentLibraryList } from "../../../app/components/editor/CommentLibraryList";

const rows = [
  { id: "1", text: "Roof covering serviceable." },
  { id: "2", text: "Flashing is loose." },
];

describe("CommentLibraryList", () => {
  it("renders rows and inserts text + id on click", () => {
    const onInsertText = vi.fn();
    render(<CommentLibraryList serverComments={rows} selectedIndex={0} sort="relevance" onInsertText={onInsertText} />);
    fireEvent.click(screen.getByText("Flashing is loose."));
    expect(onInsertText).toHaveBeenCalledWith("Flashing is loose.", "2");
  });
  it("shows an empty state when there are no comments", () => {
    render(<CommentLibraryList serverComments={[]} selectedIndex={0} sort="relevance" onInsertText={() => {}} />);
    expect(screen.getByText(/No comments/i)).toBeTruthy();
  });
});
