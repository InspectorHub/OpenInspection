import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { UnitProgress } from "~/components/editor/UnitProgress";

const units = [
  { id: "u1", label: "Unit 101" },
  { id: "u2", label: "Unit 102" },
  { id: "u3", label: "Unit 103" },
];

test("renders completed / total units", () => {
  render(<UnitProgress units={units} completedUnitIds={["u1", "u3"]} />);
  expect(screen.getByText("2/3 units")).toBeTruthy();
});

test("shows zero completed when no unit is fully rated", () => {
  render(<UnitProgress units={units} completedUnitIds={[]} />);
  expect(screen.getByText("0/3 units")).toBeTruthy();
});

test("renders one dot per unit", () => {
  const { container } = render(<UnitProgress units={units} completedUnitIds={["u1"]} />);
  expect(container.querySelectorAll("span.rounded-full")).toHaveLength(3);
});

test("renders nothing when there are no units", () => {
  const { container } = render(<UnitProgress units={[]} completedUnitIds={[]} />);
  expect(container.firstChild).toBeNull();
});

test("clicking a unit dot fires onSelectUnit", () => {
  const onSelectUnit = vi.fn();
  render(<UnitProgress units={units} completedUnitIds={[]} onSelectUnit={onSelectUnit} />);
  fireEvent.click(screen.getByRole("button", { name: /Unit 102/ }));
  expect(onSelectUnit).toHaveBeenCalledWith("u2");
});
