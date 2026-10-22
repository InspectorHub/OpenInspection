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
