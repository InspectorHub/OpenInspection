// @vitest-environment happy-dom
/**
 * A dispatch board is a claim about WHERE work is: which person owns it, and
 * what hour it sits at. Both halves are silent when wrong — a card in the wrong
 * column still looks like a card, and a job at 06:00 that the axis cannot show
 * simply is not there.
 *
 * So the assertions here are about placement, not about pixels being pretty:
 * a card lands under its owner and nowhere else, an unowned inspection lands in
 * the lane, a company holiday belongs to the whole board rather than to a
 * person, and an out-of-axis job is clamped into view rather than dropped.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { DispatchBoard } from "./DispatchBoard";
import {
  BOARD_START_HOUR,
  HOUR_HEIGHT_PX,
  bucketColumn,
  cardGeometry,
  closureItems,
  isDraggableItem,
  minuteFromOffsetY,
  shiftCivilDate,
  snapMinute,
  type DispatchItem,
  type DispatchPayload,
} from "./dispatch-helpers";

function item(over: Partial<DispatchItem> & { id: string }): DispatchItem {
  return {
    kind: "inspection",
    title: "Job",
    start: "2027-03-15",
    end: "2027-03-15",
    civilDate: "2027-03-15",
    allDay: false,
    ...over,
  };
}

const ROSTER = [
  { id: "u-ada", name: "Ada", email: "ada@example.com", role: "inspector" },
  { id: "u-bo", name: null, email: "bo@example.com", role: "manager" },
];

const DAY_START_MS = Date.UTC(2027, 2, 15, 4, 0, 0);

const BOARD: DispatchPayload = {
  date: "2027-03-15",
  conflictPolicy: "block",
  slotIntervalMin: 30,
  dayStartMs: DAY_START_MS,
  inspectors: ROSTER,
  items: [
    item({ id: "i-1", title: "Maple St", startTime: "09:00", endTime: "11:00", inspectionId: "insp-1", userId: "u-ada" }),
    item({ id: "i-2", title: "Oak Ave", startTime: "13:00", endTime: "14:00", inspectionId: "insp-2", userId: "u-bo" }),
    item({ id: "i-3", title: "Pine Rd", startTime: "10:00", inspectionId: "insp-3" }),
    item({ id: "h-1", kind: "company_holiday", title: "Founders Day", allDay: true }),
  ],
  unassigned: [
    item({ id: "i-3", title: "Pine Rd", startTime: "10:00", inspectionId: "insp-3" }),
  ],
};

function renderBoard(
  board: DispatchPayload = BOARD,
  action?: (args: { request: Request }) => unknown,
) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => <DispatchBoard board={board} />,
      ...(action ? { action } : {}),
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

/**
 * happy-dom reports a zero-origin rect, so clientY IS the axis offset here.
 *
 * The drop is dispatched as a real MouseEvent named "drop" rather than through
 * `fireEvent.drop`: happy-dom's DragEvent does not carry pointer coordinates,
 * and a drop with no clientY is exactly the case these tests exist to pin down.
 */
function dragCardTo(cardText: string, dropzone: Element, clientY: number) {
  const card = screen.getByText(cardText).closest("[data-item-id]") as HTMLElement;
  // A real dataTransfer, not a spy: the drop handler READS back what dragstart
  // wrote, which is the whole point of carrying the id through the gesture.
  const store: Record<string, string> = {};
  const dataTransfer = {
    setData: (key: string, value: string) => { store[key] = value; },
    getData: (key: string) => store[key] ?? "",
    effectAllowed: "",
  };
  fireEvent.dragStart(card, { dataTransfer });
  for (const type of ["dragover", "drop"]) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    fireEvent(dropzone, event);
  }
}

describe("DispatchBoard", () => {
  it("puts each card in its owner's column and nowhere else", () => {
    renderBoard();
    const columns = screen.getAllByTestId("dispatch-column");
    expect(columns).toHaveLength(2);

    expect(columns[0].getAttribute("data-inspector-id")).toBe("u-ada");
    expect(within(columns[0]).getByText("Maple St")).toBeTruthy();
    expect(within(columns[0]).queryByText("Oak Ave")).toBeNull();

    expect(columns[1].getAttribute("data-inspector-id")).toBe("u-bo");
    expect(within(columns[1]).getByText("Oak Ave")).toBeTruthy();
  });

  it("falls back to the email when an inspector has no name", () => {
    renderBoard();
    expect(screen.getByText("bo@example.com")).toBeTruthy();
  });

  it("keeps an unowned inspection in the lane and out of every column", () => {
    renderBoard();
    const lane = screen.getByTestId("dispatch-unassigned-lane");
    expect(within(lane).getByText("Pine Rd")).toBeTruthy();
    for (const column of screen.getAllByTestId("dispatch-column")) {
      expect(within(column).queryByText("Pine Rd")).toBeNull();
    }
  });

  it("shows a company closure once for the whole board, not per column", () => {
    renderBoard();
    expect(screen.getAllByText(/Founders Day/)).toHaveLength(1);
    for (const column of screen.getAllByTestId("dispatch-column")) {
      expect(within(column).queryByText(/Founders Day/)).toBeNull();
    }
  });

  it("renders an empty roster as an empty state rather than a bare axis", () => {
    renderBoard({ ...BOARD, inspectors: [], items: [], unassigned: [] });
    expect(screen.queryAllByTestId("dispatch-column")).toHaveLength(0);
    expect(screen.getByText("No inspectors yet")).toBeTruthy();
  });
});

describe("DispatchBoard drag-drop", () => {
  it("sends the dropped column AND the snapped instant in one write", async () => {
    const posted: Record<string, string>[] = [];
    renderBoard(BOARD, async ({ request }) => {
      const form = await request.formData();
      posted.push(Object.fromEntries(form) as Record<string, string>);
      return { ok: true, conflicts: [] };
    });

    const ada = screen.getAllByTestId("dispatch-column")[0];
    // 112px below the axis top = 09:00 on a 56px hour starting at 07:00.
    dragCardTo("Pine Rd", ada.querySelector("[data-dispatch-dropzone]")!, 112);

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      intent: "reschedule",
      inspectionId: "insp-3",
      leadInspectorId: "u-ada",
      scheduledStartMs: String(DAY_START_MS + 9 * 60 * 60_000),
    });
  });

  it("snaps a between-slots drop onto the tenant's booking lattice", async () => {
    const posted: Record<string, string>[] = [];
    renderBoard(BOARD, async ({ request }) => {
      const form = await request.formData();
      posted.push(Object.fromEntries(form) as Record<string, string>);
      return { ok: true, conflicts: [] };
    });

    const ada = screen.getAllByTestId("dispatch-column")[0];
    // 130px ≈ 09:19 — with a 30-minute interval the only honest answer is 09:30.
    dragCardTo("Pine Rd", ada.querySelector("[data-dispatch-dropzone]")!, 130);

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].scheduledStartMs).toBe(String(DAY_START_MS + (9 * 60 + 30) * 60_000));
  });

  it("unassigns with the time intact when a card is dropped on the lane", async () => {
    const posted: Record<string, string>[] = [];
    renderBoard(BOARD, async ({ request }) => {
      const form = await request.formData();
      posted.push(Object.fromEntries(form) as Record<string, string>);
      return { ok: true, conflicts: [] };
    });

    dragCardTo("Maple St", screen.getByTestId("dispatch-unassigned-lane"), 0);

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].leadInspectorId).toBe("");
    expect(posted[0].scheduledStartMs).toBe(String(DAY_START_MS + 9 * 60 * 60_000));
  });

  it("opens the conflict modal on a blocked drop instead of claiming success", async () => {
    renderBoard(BOARD, async () => ({
      ok: false,
      code: "SCHEDULE_CONFLICT",
      message: "blocked",
      conflicts: [{ inspectionId: "insp-9", propertyAddress: "77 Cedar Ln", date: "2027-03-15", inspectorId: "u-ada" }],
    }));

    const ada = screen.getAllByTestId("dispatch-column")[0];
    dragCardTo("Pine Rd", ada.querySelector("[data-dispatch-dropzone]")!, 112);

    await waitFor(() => expect(screen.getByText("77 Cedar Ln")).toBeTruthy());
    expect(screen.getByText("That slot is already taken")).toBeTruthy();
  });

  it("reads the dropped card from dataTransfer, not from a rendered state flush", async () => {
    // Found in Chrome: `dragstart` sets React state, and a drop that lands
    // before the re-render saw `null` and silently did nothing. Firing the drop
    // with NO preceding dragstart is that race, made deterministic.
    const posted: Record<string, string>[] = [];
    renderBoard(BOARD, async ({ request }) => {
      const form = await request.formData();
      posted.push(Object.fromEntries(form) as Record<string, string>);
      return { ok: true, conflicts: [] };
    });

    const ada = screen.getAllByTestId("dispatch-column")[0];
    const zone = ada.querySelector("[data-dispatch-dropzone]")!;
    const event = new MouseEvent("drop", { bubbles: true, cancelable: true, clientY: 112 });
    Object.defineProperty(event, "dataTransfer", { value: { getData: () => "i-3", setData: vi.fn() } });
    fireEvent(zone, event);

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].inspectionId).toBe("insp-3");
    expect(posted[0].leadInspectorId).toBe("u-ada");
  });

  it("does not offer a company closure as a drag source", () => {
    renderBoard();
    const closure = screen.getByText(/Founders Day/);
    expect(closure.closest("[draggable=true]")).toBeNull();
    expect(isDraggableItem(item({ id: "h", kind: "company_holiday", allDay: true }))).toBe(false);
    expect(isDraggableItem(item({ id: "b", kind: "calendar_block", startTime: "09:00", userId: "u-ada" }))).toBe(false);
  });
});

describe("dispatch-helpers", () => {
  it("snaps to the tenant interval, never to a prettier number", () => {
    expect(snapMinute(9 * 60 + 19, 30)).toBe(9 * 60 + 30);
    expect(snapMinute(9 * 60 + 14, 30)).toBe(9 * 60);
    expect(snapMinute(9 * 60 + 7, 15)).toBe(9 * 60);
    expect(snapMinute(9 * 60 + 8, 15)).toBe(9 * 60 + 15);
    // A zero/garbage interval must not divide by zero into NaN minutes.
    expect(snapMinute(9 * 60 + 19, 0)).toBe(9 * 60 + 30);
  });

  it("clamps a drop past either end of the axis back onto it", () => {
    expect(minuteFromOffsetY(-500, 30)).toBe(BOARD_START_HOUR * 60);
    expect(minuteFromOffsetY(99_999, 30)).toBe(19 * 60);
  });


  it("places a card at the pixel its start hour implies", () => {
    const geometry = cardGeometry(item({ id: "x", startTime: "09:00", endTime: "11:00" }));
    expect(geometry).not.toBeNull();
    expect(geometry?.topPx).toBe((9 - BOARD_START_HOUR) * HOUR_HEIGHT_PX);
    expect(geometry?.heightPx).toBe(2 * HOUR_HEIGHT_PX);
    expect(geometry?.clippedStart).toBe(false);
  });

  it("gives an end-less card a default span instead of a zero-height sliver", () => {
    const geometry = cardGeometry(item({ id: "x", startTime: "09:00" }));
    expect(geometry?.heightPx).toBe(HOUR_HEIGHT_PX);
  });

  it("clamps a pre-dawn job into view and says it is clipped", () => {
    const geometry = cardGeometry(item({ id: "x", startTime: "05:00", endTime: "06:00" }));
    expect(geometry).not.toBeNull();
    expect(geometry?.topPx).toBe(0);
    expect(geometry?.clippedStart).toBe(true);
  });

  it("has no geometry for an all-day item, so it cannot land at a random hour", () => {
    expect(cardGeometry(item({ id: "x", allDay: true, startTime: "09:00" }))).toBeNull();
    expect(cardGeometry(item({ id: "y" }))).toBeNull();
  });

  it("keeps a company holiday out of a person's column even when it has a userId", () => {
    const items = [item({ id: "h", kind: "company_holiday", title: "Closed", allDay: true, userId: "u-ada" })];
    expect(bucketColumn(items, "u-ada").untimed).toHaveLength(0);
    expect(closureItems(items)).toHaveLength(1);
  });

  it("sorts a column by start time, not by feed order", () => {
    const items = [
      item({ id: "late", startTime: "15:00", userId: "u-ada" }),
      item({ id: "early", startTime: "08:00", userId: "u-ada" }),
    ];
    expect(bucketColumn(items, "u-ada").timed.map((i) => i.id)).toEqual(["early", "late"]);
  });

  it("steps civil dates across a month boundary and a DST spring-forward without drifting", () => {
    expect(shiftCivilDate("2027-02-28", 1)).toBe("2027-03-01");
    expect(shiftCivilDate("2027-01-01", -1)).toBe("2026-12-31");
    // US DST begins 2027-03-14; a day step must still be exactly one day.
    expect(shiftCivilDate("2027-03-14", 1)).toBe("2027-03-15");
  });
});
