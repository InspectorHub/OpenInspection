// @vitest-environment happy-dom
/**
 * The settings sheet's template picker on a fake data source: it seeds from the templates it was given, searches
 * through `resources.templateSearch` after the debounce, pages with "Load more", and never shows an answer to a
 * request that a newer one replaced.
 */
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FieldDataSourceProvider } from "../context";
import type { FieldResources } from "../data-source";
import type { TemplateSearchResult } from "../data-source-types";
import { createEmptyEditorData, createFakeDataSource, createFakeTemplateSearch } from "../testing/fake-data-source";
import { TemplateCombobox } from "./TemplateCombobox";

afterEach(cleanup);

const page = (names: string[], over: Partial<TemplateSearchResult> = {}): TemplateSearchResult => ({
  templates: names.map((name) => ({ id: `id-${name}`, name })),
  hasMore: false,
  page: 1,
  totalPages: 1,
  ...over,
});

function mount(resources: FieldResources, props: Partial<React.ComponentProps<typeof TemplateCombobox>> = {}) {
  const onChange = vi.fn();
  const fake = createFakeDataSource({ data: createEmptyEditorData(), resources });
  render(
    <FieldDataSourceProvider dataSource={fake}>
      <TemplateCombobox value="" onChange={onChange} {...props} />
    </FieldDataSourceProvider>,
  );
  return { onChange };
}

const open = () => fireEvent.click(screen.getAllByRole("button")[0]!);

describe("TemplateCombobox", () => {
  it("opens on the templates it was given, then replaces them with the first page after the debounce", async () => {
    const templateSearch = createFakeTemplateSearch(page(["Full inspection"]));
    mount({ templateSearch }, { initialTemplates: [{ id: "seed", name: "Seeded" }] });
    open();
    expect(screen.getByText("Seeded")).toBeTruthy();
    expect(templateSearch.searches).toEqual([]);
    await waitFor(() => expect(screen.getByText("Full inspection")).toBeTruthy());
    expect(screen.queryByText("Seeded")).toBeNull();
    expect(templateSearch.searches).toEqual([{ q: "", page: 1 }]);
  });

  it("searches the typed query from page 1", async () => {
    const templateSearch = createFakeTemplateSearch(page(["Condo"]));
    mount({ templateSearch });
    open();
    await waitFor(() => expect(templateSearch.searches.length).toBeGreaterThan(0));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "con" } });
    await waitFor(() => expect(templateSearch.searches.at(-1)).toEqual({ q: "con", page: 1 }));
  });

  it("loads the next page for the same query and appends it without repeating a template", async () => {
    const templateSearch = createFakeTemplateSearch(page(["A", "B"], { hasMore: true, totalPages: 2 }));
    mount({ templateSearch });
    open();
    await waitFor(() => expect(screen.getByText("A")).toBeTruthy());
    templateSearch.setResult(page(["B", "C"], { page: 2, totalPages: 2 }));
    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    await waitFor(() => expect(screen.getByText("C")).toBeTruthy());
    expect(screen.getAllByText("B")).toHaveLength(1);
    expect(templateSearch.searches.at(-1)).toEqual({ q: "", page: 2 });
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
  });

  it("drops the answer of a request that a newer one replaced", async () => {
    const resolvers: Array<(r: TemplateSearchResult) => void> = [];
    const templateSearch = { search: () => new Promise<TemplateSearchResult>((resolve) => { resolvers.push(resolve); }) };
    mount({ templateSearch });
    open();
    await waitFor(() => expect(resolvers).toHaveLength(1));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    await waitFor(() => expect(resolvers).toHaveLength(2));
    // The newer search answers first; the older one then arrives late and must not overwrite it.
    await act(async () => { resolvers[1]!(page(["Newer"])); });
    await act(async () => { resolvers[0]!(page(["Older"])); });
    expect(screen.getByText("Newer")).toBeTruthy();
    expect(screen.queryByText("Older")).toBeNull();
  });

  it("picks a template, and clears the selection", async () => {
    const templateSearch = createFakeTemplateSearch(page(["Full"]));
    const { onChange } = mount({ templateSearch }, { value: "id-Full" });
    open();
    await waitFor(() => expect(screen.getAllByText("Full").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("on a host with no template search it keeps showing what it was seeded with", async () => {
    mount({}, { initialTemplates: [{ id: "seed", name: "Seeded" }] });
    open();
    await new Promise((r) => setTimeout(r, 350));
    expect(screen.getByText("Seeded")).toBeTruthy();
  });
});
