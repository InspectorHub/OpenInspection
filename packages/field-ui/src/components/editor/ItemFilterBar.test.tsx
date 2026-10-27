// @vitest-environment happy-dom
/** The filter strip must fit a 280px pane: it takes its own row, its segments may shrink, and a long label truncates. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import { createEmptyEditorData, createFakeDataSource } from "../../testing/fake-data-source";
import { ItemFilterBar } from "./ItemFilterBar";

afterEach(cleanup);

function mount() {
  const state = { itemFilter: "all", setItemFilter: vi.fn(), filterCounts: { unrated: 3, issues: 0, flagged: 0 }, batchMode: false, setBatchMode: vi.fn(), setBatchSelected: vi.fn() };
  return render(
    <FieldDataSourceProvider dataSource={createFakeDataSource({ data: createEmptyEditorData() })}>
      <ItemFilterBar state={state as never} formProgress={null} isMobile />
    </FieldDataSourceProvider>,
  );
}

describe("ItemFilterBar", () => {
  it("gives the segmented control its own full-width row whose segments, and the label wrapper inside each, can shrink", () => {
    mount();
    const group = screen.getByRole("radiogroup");
    expect(group.className.split(/\s+/)).toEqual(expect.arrayContaining([
      "w-full", "min-w-0", "[&>button]:min-w-0", "[&>button]:px-1.5", "[&>button>span:last-child]:min-w-0",
    ]));
  });

  it("truncates the LABEL at the segment's edge and keeps the COUNT whole beside it", () => {
    mount();
    const label = screen.getByText("Unrated", { selector: "span" });
    expect(label.className.split(/\s+/)).toEqual(expect.arrayContaining(["min-w-0", "truncate"]));
    const count = screen.getByText("3", { selector: "span" });
    expect(count.className.split(/\s+/)).toEqual(expect.arrayContaining(["shrink-0", "tabular-nums"]));
    expect(label.contains(count)).toBe(false);
    expect(label.parentElement?.className.split(/\s+/)).toEqual(expect.arrayContaining(["flex", "min-w-0", "gap-1"]));
  });

  it("names each segment in full for the case where its label is cut", () => {
    mount();
    expect(screen.getByRole("radio", { name: /Unrated/ }).getAttribute("title")).toBe("Unrated 3");
    expect(screen.getByRole("radio", { name: /All/ }).getAttribute("title")).toBe("All");
  });
});
