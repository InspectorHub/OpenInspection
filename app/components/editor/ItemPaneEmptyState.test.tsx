// @vitest-environment happy-dom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { ItemPaneEmptyState, firstItemToOpen } from "~/components/editor/ItemPaneEmptyState";

const items = [
  { id: "i1", label: "Roof covering" },
  { id: "i2", label: "Gutters" },
  { id: "i3", label: "Chimney" },
];

/** `i1` rated, the rest not — so the first UNRATED item is `i2`. */
const ratedFirst = (itemId: string) => itemId === "i1";
const ratedNone = () => false;
const ratedAll = () => true;

test("picks the first unrated item, not simply the first item", () => {
  expect(firstItemToOpen(items, ratedFirst)).toEqual({ item: items[1], unrated: true });
});

test("falls back to the first item when everything is rated", () => {
  expect(firstItemToOpen(items, ratedAll)).toEqual({ item: items[0], unrated: false });
});

test("has nothing to open when the section has no items", () => {
  expect(firstItemToOpen([], ratedNone)).toBeNull();
});

test("offers the first unrated item by name as the pane's action", () => {
  render(<ItemPaneEmptyState items={items} isRated={ratedFirst} onOpenItem={() => {}} />);
  expect(screen.getByRole("button", { name: /Gutters/ })).toBeTruthy();
});

test("clicking the action opens that item", async () => {
  const onOpenItem = vi.fn();
  render(<ItemPaneEmptyState items={items} isRated={ratedFirst} onOpenItem={onOpenItem} />);
  fireEvent.click(screen.getByRole("button", { name: /Gutters/ }));
  // React 19 flushes asynchronously — never read the result in the same turn.
  await waitFor(() => expect(onOpenItem).toHaveBeenCalledWith("i2"));
});

test("keeps the j / k hint but renders it BELOW the action", () => {
  render(<ItemPaneEmptyState items={items} isRated={ratedFirst} onOpenItem={() => {}} />);
  const action = screen.getByRole("button", { name: /Gutters/ });
  const hint = screen.getByText(/to navigate/);
  expect(action.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("offers the first item for review once every item is rated", async () => {
  const onOpenItem = vi.fn();
  render(<ItemPaneEmptyState items={items} isRated={ratedAll} onOpenItem={onOpenItem} />);
  expect(screen.getByText(/Every item in this section is rated/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Roof covering/ }));
  await waitFor(() => expect(onOpenItem).toHaveBeenCalledWith("i1"));
});

test("an empty section says so and points at Add item — with no dead button", () => {
  render(<ItemPaneEmptyState items={[]} isRated={ratedNone} onOpenItem={() => {}} />);
  expect(screen.getByText(/no items yet/)).toBeTruthy();
  expect(screen.getByText(/Add item/)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
  // Nothing to step through, so the navigation hint would be noise.
  expect(screen.queryByText(/to navigate/)).toBeNull();
});
