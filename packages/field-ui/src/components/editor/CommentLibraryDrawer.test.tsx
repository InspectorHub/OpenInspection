// @vitest-environment happy-dom
/**
 * The library drawer reads the viewer's display language off the data source's session (it used the host's
 * display-locale hook), and hands library picks to the editor.
 */
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { FieldDataSourceProvider } from "../../context";
import { formatRelativeTime } from "../../shared/format";
import { createEmptyEditorData, createFakeDataSource } from "../../testing/fake-data-source";
import { CommentLibraryDrawer, type CommentLibraryDrawerProps } from "./CommentLibraryDrawer";

afterEach(cleanup);

const DAY = 24 * 60 * 60 * 1000;
const lastUsedAt = new Date(Date.now() - 2 * DAY).toISOString();

function props(over: Partial<CommentLibraryDrawerProps> = {}): CommentLibraryDrawerProps {
  return {
    open: true,
    onClose: vi.fn(),
    comments: { filterMode: "all", setFilterMode: vi.fn(), sort: "recent", setSort: vi.fn(), touchSnippet: vi.fn() },
    state: {
      activeItem: null,
      currentSection: { id: "s1", title: "Roof" },
      activeItemId: "i1",
      getResult: () => ({}),
      commentLibraryFilter: "all",
      setCommentLibraryFilter: vi.fn(),
      setCommentLibrarySelectedIdx: vi.fn(),
      commentLibrarySearch: "",
      setCommentLibrarySearch: vi.fn(),
      commentLibrarySelectedIdx: 0,
      setShowCommentLibrary: vi.fn(),
    },
    serverComments: [{ id: "c1", text: "Flashing is lifted.", useCount: 3, lastUsedAt }],
    onInsert: vi.fn(),
    ...over,
  };
}

function mount(locale: string, p: CommentLibraryDrawerProps) {
  const fake = createFakeDataSource({ data: createEmptyEditorData(), session: { locale } });
  render(
    <FieldDataSourceProvider dataSource={fake}>
      <CommentLibraryDrawer {...p} />
    </FieldDataSourceProvider>,
  );
}

test("formats a row's last-used time in the session's locale", () => {
  mount("es-419", props());
  const expected = formatRelativeTime(lastUsedAt, { locale: "es-419" });
  expect(expected).not.toBe(formatRelativeTime(lastUsedAt, { locale: "en-US" }));
  expect(screen.getByText(expected)).toBeTruthy();
});

test("inserting a library row hands the text to the editor, records the use and closes the picker", () => {
  const p = props();
  mount("en-US", p);
  fireEvent.click(screen.getByText("Flashing is lifted."));
  expect(p.onInsert).toHaveBeenCalledWith("s1", "i1", "Flashing is lifted.");
  expect(p.comments.touchSnippet).toHaveBeenCalledWith("c1");
  expect(p.state.setShowCommentLibrary).toHaveBeenCalledWith(false);
});

test("as a phone sheet: a bottom dialog with the search first, and one tap inserts and closes", () => {
  const p = { ...props(), sheet: true };
  mount("en-US", p);
  const sheet = screen.getByRole("dialog", { name: "Comment Library" });
  // A bottom sheet, not the right-hand drawer.
  expect(sheet.className).toContain("bottom-0");
  expect(sheet.className).not.toContain("inset-y-0");
  // The search field leads the fields (sort and filter come after it), and the list is padded for the home indicator.
  const fields = [...sheet.querySelectorAll<HTMLElement>("input,select")];
  expect(fields[0].getAttribute("id")).toBe("comment-library-search");
  expect(sheet.innerHTML).toContain("pb-[calc(0.5rem+env(safe-area-inset-bottom))]");
  fireEvent.click(screen.getByText("Flashing is lifted."));
  expect(p.onInsert).toHaveBeenCalledWith("s1", "i1", "Flashing is lifted.");
  expect(p.state.setShowCommentLibrary).toHaveBeenCalledWith(false);
});

test("without the sheet flag it stays the right-hand drawer", () => {
  mount("en-US", props());
  expect(screen.getByRole("dialog", { name: "Comment Library" }).className).not.toContain("bottom-0");
});

test("opening the sheet focuses its Close button, never the search field, so no soft keyboard rises", () => {
  const p = { ...props(), sheet: true };
  mount("en-US", p);
  const sheet = screen.getByRole("dialog", { name: "Comment Library" });
  expect(document.activeElement).not.toBe(sheet.querySelector("#comment-library-search"));
  expect((document.activeElement as HTMLElement).textContent).toBe("Close");
  fireEvent.click(document.activeElement as HTMLElement);
  expect(p.onClose).toHaveBeenCalled();
});

test("as the right-hand drawer the search field still takes focus", () => {
  mount("en-US", props());
  expect(document.activeElement?.getAttribute("id")).toBe("comment-library-search");
});
