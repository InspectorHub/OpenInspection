// @vitest-environment happy-dom
/**
 * The units panel on the provider and a fake data source: every gesture issues ONE `unit` command,
 * all six ops share the panel's single guard, and an accepted write asks the data source to reload
 * (the editor's POSTs skip revalidation, so the switcher and progress dots would go stale).
 * The form posts those commands become are pinned by the web adapter tests.
 */
import { render, screen, fireEvent, act, waitFor, cleanup } from "@testing-library/react";
import { vi, beforeEach, afterEach } from "vitest";
import type { CommandResult } from "../../commands";
import { FieldDataSourceProvider } from "../../context";
import { createEmptyEditorData, createFakeDataSource } from "../../testing/fake-data-source";
import type { FakeDataSource } from "../../testing/fake-data-source";
import { UnitsManager, type UnitsManagerProps } from "./UnitsManager";
import type { UnitScopeRow } from "./BreadcrumbDropdown";

const units: UnitScopeRow[] = [
  { id: "u1", name: "Unit 101", kind: "unit", type: "unit", parentUnitId: null, sortOrder: 0 },
  { id: "u2", name: "Unit 102", kind: "unit", type: "unit", parentUnitId: null, sortOrder: 1 },
];

function renderManager(props: Partial<UnitsManagerProps> = {}) {
  const fake: FakeDataSource = createFakeDataSource({ data: createEmptyEditorData() });
  render(
    <FieldDataSourceProvider dataSource={fake}>
      <UnitsManager open onClose={vi.fn()} inspectionId="insp-1" units={units} mode="per_unit" {...props} />
    </FieldDataSourceProvider>,
  );
  return { fake };
}

/** The commands issued, without the inspection id and key. */
const sent = (fake: FakeDataSource) => fake.commands.map((c) => c.cmd);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

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
  cleanup();
});

test("bulk floors × stacks form issues a floors_stacks bulk-create", async () => {
  const { fake } = renderManager();
  // Default grid tab: 3 floors × 4 stacks = 12 units.
  fireEvent.click(screen.getByRole("button", { name: "Create units" }));
  await settle();

  expect(sent(fake)).toEqual([
    { type: "unit", op: "bulk-create", payload: { mode: "floors_stacks", floors: [1, 2, 3], stacks: 4, startAt: 1 } },
  ]);
  expect(fake.commands[0]!.inspectionId).toBe("insp-1");
  expect(confirmMock).not.toHaveBeenCalled();
});

test("CSV tab issues a csv bulk-create", async () => {
  const { fake } = renderManager();
  fireEvent.click(screen.getByRole("radio", { name: "CSV paste" }));
  fireEvent.change(screen.getByLabelText("CSV units"), { target: { value: "Lobby,\nGarage,B1" } });
  fireEvent.click(screen.getByRole("button", { name: "Create units" }));
  await settle();

  expect(sent(fake)).toEqual([{ type: "unit", op: "bulk-create", payload: { mode: "csv", csv: "Lobby,\nGarage,B1" } }]);
});

test("lossy per_unit → tagged opens the CUSTOM modal, never window.confirm", async () => {
  const { fake } = renderManager({ mode: "per_unit" });

  // The switch button does NOT write directly — it opens the confirm modal.
  fireEvent.click(screen.getByRole("button", { name: "Switch to tagged" }));
  expect(fake.commands).toHaveLength(0);
  expect(confirmMock).not.toHaveBeenCalled();

  // The custom DS modal is shown with a clear warning.
  expect(screen.getByText("Switch to tagged mode?")).toBeTruthy();

  // Confirming inside the modal issues the lossy switch.
  fireEvent.click(screen.getByRole("button", { name: /Switch & flatten/ }));
  await settle();
  expect(confirmMock).not.toHaveBeenCalled();
  expect(sent(fake)).toEqual([{ type: "unit", op: "mode-switch", mode: "tagged" }]);
});

test("the lossy modal closes once the switch lands, and stays up when it fails", async () => {
  const { fake } = renderManager({ mode: "per_unit" });
  fake.failExecute("unit", "refused");
  fireEvent.click(screen.getByRole("button", { name: "Switch to tagged" }));
  fireEvent.click(screen.getByRole("button", { name: /Switch & flatten/ }));
  await settle();
  // A refused switch leaves the question open and refreshes nothing.
  expect(screen.getByText("Switch to tagged mode?")).toBeTruthy();
  expect(fake.reloadCount).toBe(0);

  // The host recovers: the retry lands and the modal goes.
  vi.spyOn(fake, "execute").mockResolvedValue({ ok: true } as CommandResult<undefined>);
  fireEvent.click(screen.getByRole("button", { name: /Switch & flatten/ }));
  await waitFor(() => expect(screen.queryByText("Switch to tagged mode?")).toBeNull());
  expect(fake.reloadCount).toBe(1);
});

test("tagged → per_unit switches directly (non-lossy, no modal)", async () => {
  const { fake } = renderManager({ mode: "tagged" });
  fireEvent.click(screen.getByRole("button", { name: "Switch to per-unit" }));
  await settle();

  expect(screen.queryByText("Switch to tagged mode?")).toBeNull();
  expect(sent(fake)).toEqual([{ type: "unit", op: "mode-switch", mode: "per_unit" }]);
});

test("adding a single unit issues unit create with the trimmed name, and clears the field", async () => {
  const { fake } = renderManager();
  const field = screen.getByLabelText("New unit name") as HTMLInputElement;
  fireEvent.change(field, { target: { value: "  Roof " } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await settle();

  expect(sent(fake)).toEqual([{ type: "unit", op: "create", name: "Roof" }]);
  expect(field.value).toBe("");
});

test("deleting a unit issues unit delete with its id", async () => {
  const { fake } = renderManager();
  fireEvent.click(screen.getByRole("button", { name: "Remove Unit 101" }));
  await settle();
  expect(sent(fake)).toEqual([{ type: "unit", op: "delete", unitId: "u1" }]);
});

test("duplicating a unit issues unit duplicate with its id", async () => {
  const { fake } = renderManager();
  fireEvent.click(screen.getByRole("button", { name: "Duplicate Unit 102" }));
  await settle();
  expect(sent(fake)).toEqual([{ type: "unit", op: "duplicate", unitId: "u2" }]);
});

test("renaming on blur issues unit rename; an untouched or blank name issues nothing", async () => {
  const { fake } = renderManager();
  const field = screen.getByLabelText("Rename Unit 101");
  fireEvent.blur(field);
  fireEvent.change(field, { target: { value: "   " } });
  fireEvent.blur(field);
  await settle();
  expect(fake.commands).toHaveLength(0);

  fireEvent.change(field, { target: { value: " Suite A " } });
  fireEvent.blur(field);
  await settle();
  expect(sent(fake)).toEqual([{ type: "unit", op: "rename", unitId: "u1", name: "Suite A" }]);
});

test("every accepted write reloads the editor once; a refused one does not", async () => {
  const { fake } = renderManager();
  fireEvent.click(screen.getByRole("button", { name: "Remove Unit 101" }));
  await waitFor(() => expect(fake.reloadCount).toBe(1));

  fake.failExecute("unit", "no");
  fireEvent.click(screen.getByRole("button", { name: "Remove Unit 102" }));
  await settle();
  expect(fake.commands).toHaveLength(2);
  expect(fake.reloadCount).toBe(1);
});

// #106 - every one of these is a real unit mutation: two gestures in ONE frame must send ONE command,
// and that holds ACROSS ops (one guard for the whole panel), because a rename and a delete of the same
// unit must never overlap. The pending buttons only go inert after a render, too late for the second.
test("two same-frame presses of Delete send ONE command", async () => {
  const { fake } = renderManager();
  const del = screen.getByRole("button", { name: "Remove Unit 101" });
  act(() => { del.click(); del.click(); });
  await settle();
  expect(fake.commands).toHaveLength(1);
  expect(fake.reloadCount).toBe(1);
});

test("one guard covers every op: a delete and a duplicate in the same frame send ONE command", async () => {
  const { fake } = renderManager();
  const del = screen.getByRole("button", { name: "Remove Unit 101" });
  const dup = screen.getByRole("button", { name: "Duplicate Unit 102" });
  act(() => { del.click(); dup.click(); });
  await settle();
  expect(sent(fake)).toEqual([{ type: "unit", op: "delete", unitId: "u1" }]);
});

test("CONTROL - a later press goes through once the first has settled", async () => {
  const { fake } = renderManager();
  act(() => { screen.getByRole("button", { name: "Remove Unit 101" }).click(); });
  await settle();
  act(() => { screen.getByRole("button", { name: "Remove Unit 102" }).click(); });
  await settle();
  expect(sent(fake)).toEqual([
    { type: "unit", op: "delete", unitId: "u1" },
    { type: "unit", op: "delete", unitId: "u2" },
  ]);
});

test("the controls show pending while a write is out, and the answer releases them", async () => {
  const { fake } = renderManager();
  let settleWrite: (r: CommandResult<undefined>) => void = () => undefined;
  vi.spyOn(fake, "execute").mockImplementation((() =>
    new Promise<CommandResult<undefined>>((resolve) => { settleWrite = resolve; })) as FakeDataSource["execute"]);
  fireEvent.click(screen.getByRole("button", { name: "Remove Unit 101" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Remove Unit 102" }).getAttribute("aria-disabled")).toBe("true"));
  settleWrite({ ok: true });
  await waitFor(() => expect(screen.getByRole("button", { name: "Remove Unit 102" }).getAttribute("aria-disabled")).not.toBe("true"));
});
