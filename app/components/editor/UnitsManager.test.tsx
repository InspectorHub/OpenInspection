import { render, screen, fireEvent } from "@testing-library/react";
import { vi, beforeEach, afterEach } from "vitest";
import { UnitsManager, type UnitsManagerProps } from "~/components/editor/UnitsManager";
import type { UnitScopeRow } from "~/components/editor/BreadcrumbDropdown";

const units: UnitScopeRow[] = [
  { id: "u1", name: "Unit 101", kind: "unit", type: "unit", parentUnitId: null, sortOrder: 0 },
  { id: "u2", name: "Unit 102", kind: "unit", type: "unit", parentUnitId: null, sortOrder: 1 },
];

function makeFetcher(overrides: Partial<{ state: string; data: unknown }> = {}) {
  const submit = vi.fn();
  const fetcher = {
    submit,
    state: overrides.state ?? "idle",
    data: overrides.data,
  } as unknown as UnitsManagerProps["fetcher"];
  return { fetcher, submit };
}

function renderManager(props: Partial<UnitsManagerProps> = {}) {
  const { fetcher, submit } = makeFetcher();
  render(
    <UnitsManager
      open
      onClose={vi.fn()}
      inspectionId="insp-1"
      units={units}
      mode="per_unit"
      fetcher={fetcher}
      {...props}
    />,
  );
  return { submit };
}

// window.confirm must NEVER be used — the lossy switch is a custom DS modal.
// The DOM env may not define confirm at all, so assign a mock directly (spyOn
// requires an existing function) and assert it stays untouched.
const confirmMock = vi.fn(() => true);
const origConfirm = window.confirm;
beforeEach(() => {
  window.confirm = confirmMock;
  confirmMock.mockClear();
});
afterEach(() => {
  window.confirm = origConfirm;
});

test("bulk floors × stacks form submits a floors_stacks payload", () => {
  const { submit } = renderManager();
  // Default grid tab: 3 floors × 4 stacks = 12 units.
  fireEvent.click(screen.getByRole("button", { name: "Create units" }));

  expect(submit).toHaveBeenCalledTimes(1);
  const [fields] = submit.mock.calls[0];
  expect(fields.intent).toBe("unit-bulk-create");
  const payload = JSON.parse(fields.payload);
  expect(payload.mode).toBe("floors_stacks");
  expect(payload.floors).toEqual([1, 2, 3]);
  expect(payload.stacks).toBe(4);
  expect(confirmMock).not.toHaveBeenCalled();
});

test("CSV tab submits a csv payload", () => {
  const { submit } = renderManager();
  fireEvent.click(screen.getByRole("radio", { name: "CSV paste" }));
  fireEvent.change(screen.getByLabelText("CSV units"), { target: { value: "Lobby,\nGarage,B1" } });
  fireEvent.click(screen.getByRole("button", { name: "Create units" }));

  const [fields] = submit.mock.calls[0];
  expect(fields.intent).toBe("unit-bulk-create");
  const payload = JSON.parse(fields.payload);
  expect(payload.mode).toBe("csv");
  expect(payload.csv).toContain("Lobby");
});

test("lossy per_unit → tagged opens the CUSTOM modal, never window.confirm", () => {
  const { submit } = renderManager({ mode: "per_unit" });

  // The switch button does NOT submit directly — it opens the confirm modal.
  fireEvent.click(screen.getByRole("button", { name: "Switch to tagged" }));
  expect(submit).not.toHaveBeenCalled();
  expect(confirmMock).not.toHaveBeenCalled();

  // The custom DS modal is shown with a clear warning.
  expect(screen.getByText("Switch to tagged mode?")).toBeTruthy();

  // Confirming inside the modal submits the lossy switch.
  fireEvent.click(screen.getByRole("button", { name: /Switch & flatten/ }));
  expect(confirmMock).not.toHaveBeenCalled();
  const modeCall = submit.mock.calls.find((c) => c[0]?.intent === "unit-mode-switch");
  expect(modeCall?.[0].mode).toBe("tagged");
});

test("tagged → per_unit switches directly (non-lossy, no modal)", () => {
  const { submit } = renderManager({ mode: "tagged" });
  fireEvent.click(screen.getByRole("button", { name: "Switch to per-unit" }));

  expect(screen.queryByText("Switch to tagged mode?")).toBeNull();
  const [fields] = submit.mock.calls[0];
  expect(fields.intent).toBe("unit-mode-switch");
  expect(fields.mode).toBe("per_unit");
});

test("adding a single unit submits unit-create", () => {
  const { submit } = renderManager();
  fireEvent.change(screen.getByLabelText("New unit name"), { target: { value: "Roof" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  const [fields] = submit.mock.calls[0];
  expect(fields.intent).toBe("unit-create");
  expect(fields.name).toBe("Roof");
});

test("deleting a unit submits unit-delete with its id", () => {
  const { submit } = renderManager();
  fireEvent.click(screen.getByRole("button", { name: "Remove Unit 101" }));
  const [fields] = submit.mock.calls[0];
  expect(fields.intent).toBe("unit-delete");
  expect(fields.unitId).toBe("u1");
});
