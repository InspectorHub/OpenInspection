// @vitest-environment happy-dom
/**
 * Find-a-Time makes a promise: "this start is free for the whole job".
 *
 * The failure mode is silent and expensive — offering 09:00 for a three-hour
 * inspection whose 10:00 is already taken sends someone to a house they will
 * have to leave halfway through. So the assertions here are about what is NOT
 * offered, and about the difference between "nothing is free" and "we could not
 * find out", which look identical if a failed load is rendered as an empty day.
 */
import { describe, it, expect } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { FindATimeModal } from "./FindATimeModal";
import { startsFittingDuration, type DaySlot } from "./dispatch-helpers";

const MEMBERS = [
  { id: "u-ada", name: "Ada" },
  { id: "u-bo", name: "Bo" },
];

function slot(time: string, available: boolean, inspectorIds: string[] = []): DaySlot {
  return { time, available, inspectorIds };
}

function renderModal(payload: unknown) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <FindATimeModal
          open
          onClose={() => {}}
          initialDate="2027-03-15"
          members={MEMBERS}
          onPick={() => {}}
        />
      ),
    },
    { path: "/resources/day-slots", loader: () => payload },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

const FULL_DAY = {
  failed: false,
  date: "2027-03-15",
  intervalMin: 30,
  slots: [
    slot("09:00", true, ["u-ada"]),
    slot("09:30", true, ["u-ada", "u-bo"]),
    slot("10:00", false),
    slot("10:30", true, ["u-bo"]),
    slot("11:00", true, ["u-bo"]),
  ],
  holidayAdvisory: null,
};

describe("FindATimeModal", () => {
  it("offers only starts where the whole duration fits", async () => {
    renderModal(FULL_DAY);
    await waitFor(() => expect(screen.getAllByTestId("find-a-time-slot").length).toBeGreaterThan(0));
    const offered = screen.getAllByTestId("find-a-time-slot").map((b) => b.textContent);
    // Default duration is 60 minutes = two consecutive free slots.
    // 09:00+09:30 fits; 09:30 does not (10:00 is taken); 10:30+11:00 fits.
    expect(offered.some((t) => t?.startsWith("09:00"))).toBe(true);
    expect(offered.some((t) => t?.startsWith("09:30"))).toBe(false);
    expect(offered.some((t) => t?.startsWith("10:30"))).toBe(true);
  });

  it("names the inspector when exactly one is free at that start", async () => {
    renderModal(FULL_DAY);
    await waitFor(() => expect(screen.getAllByTestId("find-a-time-slot").length).toBeGreaterThan(0));
    // Scoped to the results: "Ada" is also an option in the inspector filter.
    const results = screen.getByTestId("find-a-time-results");
    expect(within(results).getAllByText("Ada").length).toBeGreaterThan(0);
  });

  it("says a lookup FAILED rather than showing an empty day", async () => {
    renderModal({ failed: true, date: "2027-03-15", intervalMin: 30, slots: [], holidayAdvisory: null });
    await waitFor(() =>
      expect(screen.getByText("Availability could not be checked. Try again.")).toBeTruthy(),
    );
    expect(screen.queryAllByTestId("find-a-time-slot")).toHaveLength(0);
  });

  it("says nothing fits when the day really is full", async () => {
    renderModal({ failed: false, date: "2027-03-15", intervalMin: 30, slots: [slot("09:00", false)], holidayAdvisory: null });
    await waitFor(() =>
      expect(screen.getByText("No window that long is free on this day.")).toBeTruthy(),
    );
  });
});

describe("startsFittingDuration", () => {
  const slots = FULL_DAY.slots;

  it("needs every consecutive slot the duration spans", () => {
    expect([...startsFittingDuration(slots, 30, 30)]).toEqual(["09:00", "09:30", "10:30", "11:00"]);
    expect([...startsFittingDuration(slots, 30, 60)]).toEqual(["09:00", "10:30"]);
    expect([...startsFittingDuration(slots, 30, 90)]).toEqual([]);
  });

  it("refuses to step over a GAP in the grid", () => {
    // 09:00 and 12:00 are both free, but the hours between them are not slots
    // at all — a closed window. Index arithmetic alone would call this a
    // three-hour opening.
    const split = [slot("09:00", true, ["u-ada"]), slot("12:00", true, ["u-ada"])];
    expect([...startsFittingDuration(split, 30, 60)]).toEqual([]);
    expect([...startsFittingDuration(split, 30, 30)]).toEqual(["09:00", "12:00"]);
  });

  it("rounds a duration that is not a whole number of slots UP", () => {
    // 45 minutes on a 30-minute grid occupies two slots, not one.
    expect([...startsFittingDuration(slots, 30, 45)]).toEqual(["09:00", "10:30"]);
  });
});
