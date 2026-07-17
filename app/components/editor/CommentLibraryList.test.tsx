import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommentLibraryList } from "../../../app/components/editor/CommentLibraryList";

const rows = [
  { id: "1", text: "Roof covering serviceable." },
  { id: "2", text: "Flashing is loose." },
];

const NOW = Date.UTC(2026, 7, 3, 12, 0, 0);
const DAY = 86_400_000;

describe("CommentLibraryList", () => {
  it("renders rows and inserts text + id on click", () => {
    const onInsertText = vi.fn();
    render(<CommentLibraryList serverComments={rows} selectedIndex={0} sort="relevance" onInsertText={onInsertText} locale="en-US" />);
    fireEvent.click(screen.getByText("Flashing is loose."));
    expect(onInsertText).toHaveBeenCalledWith("Flashing is loose.", "2");
  });
  it("shows an empty state when there are no comments", () => {
    render(<CommentLibraryList serverComments={[]} selectedIndex={0} sort="relevance" onInsertText={() => {}} locale="en-US" />);
    expect(screen.getByText(/No comments/i)).toBeTruthy();
  });

  it("renders lastUsedAt in the shape the server actually sends", () => {
    // admin-comments serializes last_used_at with toISOString(), and the Zod
    // schema types it as a string — not the epoch number the props once claimed.
    const lastUsedAt = new Date(NOW - 3 * DAY).toISOString();
    render(
      <CommentLibraryList
        serverComments={[{ id: "1", text: "Roof covering serviceable.", lastUsedAt }]}
        selectedIndex={0}
        sort="recent"
        onInsertText={() => {}}
        locale="en-US"
        now={NOW}
      />,
    );
    expect(screen.getByText("3 days ago")).toBeTruthy();
  });

  it("never renders NaN for a recent timestamp", () => {
    const { container } = render(
      <CommentLibraryList
        serverComments={[
          { id: "1", text: "A", lastUsedAt: new Date(NOW - 2 * 3_600_000).toISOString() },
          { id: "2", text: "B", lastUsedAt: new Date(NOW - 40 * DAY).toISOString() },
        ]}
        selectedIndex={0}
        sort="recent"
        onInsertText={() => {}}
        locale="en-US"
        now={NOW}
      />,
    );
    expect(container.textContent).not.toContain("NaN");
  });

  it("localizes the relative time", () => {
    const lastUsedAt = new Date(NOW - 3 * DAY).toISOString();
    const { container } = render(
      <CommentLibraryList
        serverComments={[{ id: "1", text: "A", lastUsedAt }]}
        selectedIndex={0}
        sort="recent"
        onInsertText={() => {}}
        locale="es-419"
        now={NOW}
      />,
    );
    expect(container.textContent).toContain("hace 3 días");
  });

  it("renders no timestamp when the comment was never used", () => {
    const { container } = render(
      <CommentLibraryList
        serverComments={[{ id: "1", text: "A", lastUsedAt: null }]}
        selectedIndex={0}
        sort="recent"
        onInsertText={() => {}}
        locale="en-US"
        now={NOW}
      />,
    );
    expect(container.textContent).toContain("A");
    expect(container.textContent).not.toContain("ago");
  });
});
