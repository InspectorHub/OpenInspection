import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { BreadcrumbDropdown, type UnitScopeRow } from "~/components/editor/BreadcrumbDropdown";

const units: UnitScopeRow[] = [
  { id: "u1", name: "Unit 101", kind: "unit", type: "unit", parentUnitId: null, sortOrder: 1 },
  { id: "u2", name: "Unit 102", kind: "unit", type: "unit", parentUnitId: null, sortOrder: 0 },
  // A floor node is NOT a selectable scope — it must be filtered out.
  { id: "f1", name: "Floor 1", kind: "floor", type: "unit", parentUnitId: null, sortOrder: 5 },
];

test("shows the active scope on the trigger (Common when null)", () => {
  render(<BreadcrumbDropdown units={units} activeUnitId={null} onSelect={vi.fn()} />);
  expect(screen.getByRole("button", { name: /Inspection scope: Common/ })).toBeTruthy();
});

test("opening the switcher lists Common + only the unit rows (floors filtered)", () => {
  render(<BreadcrumbDropdown units={units} activeUnitId={null} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Switch scope/ }));

  const options = screen.getAllByRole("option");
  // Common + u1 + u2 = 3 (floor node excluded).
  expect(options).toHaveLength(3);
  expect(screen.getByText("Unit 101")).toBeTruthy();
  expect(screen.getByText("Unit 102")).toBeTruthy();
  expect(screen.queryByText("Floor 1")).toBeNull();
});

test("units are ordered by sortOrder", () => {
  render(<BreadcrumbDropdown units={units} activeUnitId={null} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Switch scope/ }));
  const labels = screen.getAllByRole("option").map((o) => o.textContent);
  // Common first, then u2 (sortOrder 0) before u1 (sortOrder 1).
  expect(labels[0]).toContain("Common");
  expect(labels[1]).toContain("Unit 102");
  expect(labels[2]).toContain("Unit 101");
});

test("selecting a unit fires onSelect with its id", () => {
  const onSelect = vi.fn();
  render(<BreadcrumbDropdown units={units} activeUnitId={null} onSelect={onSelect} />);
  fireEvent.click(screen.getByRole("button", { name: /Switch scope/ }));
  fireEvent.click(screen.getByText("Unit 101"));
  expect(onSelect).toHaveBeenCalledWith("u1");
});

test("selecting Common fires onSelect(null)", () => {
  const onSelect = vi.fn();
  render(<BreadcrumbDropdown units={units} activeUnitId="u1" onSelect={onSelect} />);
  fireEvent.click(screen.getByRole("button", { name: /Switch scope/ }));
  fireEvent.click(screen.getByText("Common"));
  expect(onSelect).toHaveBeenCalledWith(null);
});
