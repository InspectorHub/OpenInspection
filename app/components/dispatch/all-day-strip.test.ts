/**
 * The dispatch board's all-day strip.
 *
 * It was a fixed `h-10` — 40px — and a second entry already overflowed it
 * (measured in Chrome: height 40, scrollHeight 53). A board built to schedule a
 * day cannot clip the second job of the day behind a 13px scroll.
 *
 * The height has to be ONE number shared by the hour gutter and every column:
 * each is an independent vertical stack, so a strip that sizes itself per column
 * puts the taller column's axis an all-day row below its neighbour's and every
 * card then reads an hour off. That is why this is arithmetic over a count
 * rather than `h-auto`, and why the count is the MAX across the roster.
 */
import { describe, expect, it } from "vitest";
import {
  ALL_DAY_MAX_ENTRIES,
  ALL_DAY_MIN_PX,
  allDayStripPx,
  maxUntimedCount,
  type DispatchInspector,
  type DispatchItem,
} from "./dispatch-helpers";

function item(over: Partial<DispatchItem> & { id: string }): DispatchItem {
  return {
    kind: "inspection",
    title: "Job",
    start: "2026-09-10",
    end: "2026-09-10",
    civilDate: "2026-09-10",
    allDay: true,
    ...over,
  };
}

const ROSTER: DispatchInspector[] = [
  { id: "u-ada", name: "Ada", email: "ada@example.com", role: "inspector" },
  { id: "u-bo", name: "Bo", email: "bo@example.com", role: "manager" },
];

describe("all-day strip height", () => {
  it("keeps the 40px minimum when the strip is empty", () => {
    expect(allDayStripPx(0)).toBe(ALL_DAY_MIN_PX);
    expect(allDayStripPx(1)).toBe(ALL_DAY_MIN_PX);
  });

  it("grows past 40px at TWO entries — the measured clipping point", () => {
    // Chrome measured scrollHeight 53 for two entries against a 40px box. The
    // strip must be at least that tall, or the second card is behind a scroll.
    expect(allDayStripPx(2)).toBeGreaterThanOrEqual(53);
  });

  it("grows monotonically with the entry count", () => {
    const heights = [0, 1, 2, 3, 4, 5].map(allDayStripPx);
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeGreaterThanOrEqual(heights[i - 1]);
    }
    expect(allDayStripPx(5)).toBeGreaterThan(allDayStripPx(2));
  });

  it("stops growing at the cap so one busy column cannot push the axis off screen", () => {
    const capped = allDayStripPx(ALL_DAY_MAX_ENTRIES);
    expect(allDayStripPx(ALL_DAY_MAX_ENTRIES + 1)).toBe(capped);
    expect(allDayStripPx(40)).toBe(capped);
  });

  it("survives a negative or absurd count rather than returning a negative height", () => {
    expect(allDayStripPx(-3)).toBe(ALL_DAY_MIN_PX);
  });

  it("sizes on the BUSIEST column, so the gutter and every column agree", () => {
    const items = [
      item({ id: "a1", userId: "u-ada" }),
      item({ id: "a2", userId: "u-ada" }),
      item({ id: "a3", userId: "u-ada" }),
      item({ id: "b1", userId: "u-bo" }),
    ];
    expect(maxUntimedCount(items, ROSTER)).toBe(3);
    expect(allDayStripPx(maxUntimedCount(items, ROSTER))).toBe(allDayStripPx(3));
  });

  it("counts only UNTIMED work — a timed card lives on the axis, not in the strip", () => {
    const items = [
      item({ id: "timed", userId: "u-ada", allDay: false, startTime: "09:00" }),
      item({ id: "untimed", userId: "u-ada" }),
    ];
    expect(maxUntimedCount(items, ROSTER)).toBe(1);
  });

  it("ignores a company closure, which belongs to the whole board", () => {
    const items = [item({ id: "h", kind: "company_holiday", userId: "u-ada" })];
    expect(maxUntimedCount(items, ROSTER)).toBe(0);
  });

  it("POSITIVE CONTROL — an empty board still reports a real minimum height", () => {
    expect(maxUntimedCount([], ROSTER)).toBe(0);
    expect(allDayStripPx(0)).toBeGreaterThan(0);
  });

  it("gives a two-entry strip room for BOTH entries, not one and a scrollbar", () => {
    const items = [
      item({ id: "a1", userId: "u-ada" }),
      item({ id: "a2", userId: "u-ada" }),
    ];
    const px = allDayStripPx(maxUntimedCount(items, ROSTER));
    // 2 entries + their gap + the strip's own padding must all fit.
    expect(px).toBeGreaterThan(ALL_DAY_MIN_PX);
  });
});
