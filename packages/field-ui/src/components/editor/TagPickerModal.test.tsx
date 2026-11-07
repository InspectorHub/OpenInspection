// @vitest-environment happy-dom
/**
 * A company with no tags must be told so, not shown an empty box: the editor lists only tags the host can save, and
 * the five made-up names it used to offer would be refused by the server (no tag has those ids).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import { createEmptyEditorData, createFakeDataSource } from "../../testing/fake-data-source";
import { TagPickerModal } from "./TagPickerModal";

afterEach(cleanup);

const renderPicker = (presetTags: Array<{ id: string; name: string; color: string }>) =>
  render(
    <FieldDataSourceProvider dataSource={createFakeDataSource({ data: createEmptyEditorData() })}>
      <TagPickerModal open activeItemId="i" tagsByItem={{}} presetTags={presetTags} onToggle={vi.fn()} onClose={vi.fn()} />
    </FieldDataSourceProvider>,
  );

describe("TagPickerModal with nothing to choose", () => {
  it("says there are no tags yet and where to add them", () => {
    renderPicker([]);
    expect(screen.getByText(/no tags yet/i)).toBeTruthy();
    expect(screen.getByText(/Library/)).toBeTruthy();
  });

  it("shows no such line when there are tags to choose", () => {
    renderPicker([{ id: "t1", name: "Urgent", color: "#f97316" }]);
    expect(screen.queryByText(/no tags yet/i)).toBeNull();
    expect(screen.getByText("Urgent")).toBeTruthy();
  });
});

describe("TagPickerModal when the company has no tags and the host knows the tag library", () => {
  const withHost = (seed: Parameters<typeof createFakeDataSource>[0]) => {
    const fake = createFakeDataSource(seed);
    render(
      <FieldDataSourceProvider dataSource={fake}>
        <TagPickerModal open activeItemId="i" tagsByItem={{}} presetTags={[]} onToggle={vi.fn()} onClose={vi.fn()} />
      </FieldDataSourceProvider>,
    );
    return fake;
  };

  it("offers a button that opens the library address outside the editor", () => {
    const fake = withHost({ data: createEmptyEditorData(), urls: { tagLibrary: () => "/library/tags" } });
    fireEvent.click(screen.getByRole("button", { name: /open the tag library/i }));
    expect(fake.openedUrls).toEqual(["/library/tags"]);
  });

  it("offers nothing to press when the host has no such address", () => {
    withHost({ data: createEmptyEditorData() });
    expect(screen.queryByRole("button", { name: /open the tag library/i })).toBeNull();
  });

  it("offers nothing to press when the host cannot open an address", () => {
    withHost({ data: createEmptyEditorData(), urls: { tagLibrary: () => "/library/tags" }, without: ["openUrl"] });
    expect(screen.queryByRole("button", { name: /open the tag library/i })).toBeNull();
  });
});
