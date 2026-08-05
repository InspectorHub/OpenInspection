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
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { DispatchBoard } from "./DispatchBoard";
import {
  BOARD_START_HOUR,
  HOUR_HEIGHT_PX,
  bucketColumn,
  cardGeometry,
  closureItems,
  shiftCivilDate,
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

const BOARD: DispatchPayload = {
  date: "2027-03-15",
  conflictPolicy: "block",
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

function renderBoard(board: DispatchPayload = BOARD) {
  const Stub = createRoutesStub([
    { path: "/", Component: () => <DispatchBoard board={board} /> },
  ]);
  return render(<Stub initialEntries={["/"]} />);
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

describe("dispatch-helpers", () => {
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
